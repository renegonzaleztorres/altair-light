// @ts-check
/**
 * AWS Signature Version 4
 *
 * Signs an HTTPS request to an AWS API so it can be sent with fetch, without
 * the AWS SDK. Used by the SES mail transport. Implements the "Authorization
 * header" form of
 * https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
 * for services other than S3, with these limits, which keep it short:
 *
 * - the path may contain only unreserved characters and "/" (no encoding
 *   rules to get wrong); anything else throws
 * - the body is a string (JSON for the APIs this library calls)
 */

import { createHash, createHmac } from 'node:crypto';

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SAFE_PATH = /^\/[A-Za-z0-9\-._~/]*$/;

/**
 * @typedef {{ accessKeyId: string, secretAccessKey: string, sessionToken?: string }} AwsCredentials
 */

const sha256Hex = (/** @type {string} */ data) => createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (/** @type {Buffer | string} */ key, /** @type {string} */ data) => createHmac('sha256', key).update(data, 'utf8').digest();

/**
 * encodeRfc3986 : percent-encode everything except unreserved characters
 * @param {string} value
 */
const encodeRfc3986 = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * amzDate : "20150830T123600Z" for a Date
 * @param {Date} date
 */
export const amzDate = (date) => date.toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/, '');

/**
 * signRequest : the headers to send, including Authorization, for one request
 * @param {object} request
 * @param {string} request.method
 * @param {string} request.url Absolute https URL
 * @param {Record<string, string>} [request.headers] Headers to sign and send (host and x-amz-date are added)
 * @param {string} [request.body]
 * @param {string} request.region
 * @param {string} request.service Signing name, e.g. "ses"
 * @param {AwsCredentials} request.credentials
 * @param {Date} [request.date] Signing time (tests); default now
 * @returns {Record<string, string>}
 */
export const signRequest = ({ method, url, headers = {}, body = '', region, service, credentials, date = new Date() }) => {

  const target = new URL(url);
  if (!SAFE_PATH.test(target.pathname)) throw new Error(`sigv4: unsupported characters in path ${target.pathname}`);

  const timestamp = amzDate(date);
  const day = timestamp.slice(0, 8);
  /** @type {Record<string, string>} */
  const signed = {};
  for (const [name, value] of Object.entries(headers)) signed[name.toLowerCase()] = String(value).trim().replace(/\s+/g, ' ');
  signed.host = target.host;
  signed['x-amz-date'] = timestamp;
  if (credentials.sessionToken) signed['x-amz-security-token'] = credentials.sessionToken;

  const names = Object.keys(signed).sort();
  const signedHeaders = names.join(';');
  const query = [...target.searchParams]
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)])
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const canonicalRequest = [
    method.toUpperCase(),
    target.pathname,
    query,
    names.map((name) => `${name}:${signed[name]}\n`).join(''),
    signedHeaders,
    sha256Hex(body)
  ].join('\n');

  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = [ALGORITHM, timestamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), region), service), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  const { host, ...send } = signed; // fetch sets Host itself
  return {
    ...send,
    authorization: `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  };

} // signRequest
