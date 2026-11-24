// @ts-check
/**
 * Amazon SES transport for the mailer: the SES API v2 SendEmail call
 * (simple content), sent with fetch and signed with Signature Version 4.
 * No AWS SDK: with @aws-sdk/client-sesv2 this cost about 3 MB more heap.
 * Loaded on demand by createMailer() only when MAIL_PROVIDER=ses.
 *
 * SES requirements: the From address (or its domain) must be a verified
 * identity in MAIL_SES_REGION, and while the account is in the SES sandbox
 * every recipient must be verified too.
 */

import { createCredentialProvider } from '../aws/credentials.js';
import { signRequest } from '../aws/sigv4.js';
import { formatMailbox } from './mailer.js';

const SEND_TIMEOUT_MS = 10000;
const RETRIES = 2;
const RETRYABLE_TYPES = new Set(['TooManyRequestsException', 'ThrottlingException', 'LimitExceededException']);

/**
 * sesError : SES's error name and message from a failed response
 * @param {Response} response
 */
const sesError = async (response) => {

  const text = await response.text();
  let json = {};
  try { json = JSON.parse(text); } catch {}
  const type = response.headers.get('x-amzn-errortype')?.split(':')[0]
    || (typeof json.__type === 'string' ? json.__type.split('#').pop() : undefined)
    || (typeof json.code === 'string' ? json.code : undefined)
    || `HTTP ${response.status}`;
  const message = json.message ?? json.Message ?? (text.slice(0, 200) || response.statusText);
  return { type, message };

} // sesError

/**
 * createSesTransport : a send function for one region and set of credentials
 * @param {{ region: string, credentials?: import('../aws/sigv4.js').AwsCredentials, role?: import('../aws/credentials.js').RoleSource }} options
 * @param {{ fetch?: typeof globalThis.fetch, now?: () => Date, retryDelayMs?: number }} [overrides] stand-ins (tests)
 */
export const createSesTransport = async ({ region, credentials, role }, { fetch = globalThis.fetch, now = () => new Date(), retryDelayMs = 200 } = {}) => {

  const getCredentials = createCredentialProvider({ credentials, role, fetch });
  const url = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;
  const list = (/** @type {import('./mailer.js').Mailbox[]} */ mailboxes) => mailboxes.map(formatMailbox);
  const utf8 = (/** @type {string} */ data) => ({ Data: data, Charset: 'UTF-8' });

  /** @type {import('./mailer.js').Transport} */
  const send = async (message, { signal } = {}) => {

    const body = JSON.stringify({
      FromEmailAddress: formatMailbox(message.from),
      Destination: {
        ToAddresses: list(message.to),
        ...(message.cc.length ? { CcAddresses: list(message.cc) } : {}),
        ...(message.bcc.length ? { BccAddresses: list(message.bcc) } : {})
      },
      ...(message.replyTo.length ? { ReplyToAddresses: list(message.replyTo) } : {}),
      Content: {
        Simple: {
          Subject: utf8(message.subject),
          Body: { Text: utf8(message.text), ...(message.html ? { Html: utf8(message.html) } : {}) }
        }
      }
    });
    const timeout = AbortSignal.timeout(SEND_TIMEOUT_MS);
    const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const fail = (/** @type {string} */ type, /** @type {string} */ detail, /** @type {unknown} */ cause) =>
      new Error(`SES SendEmail failed (${type}): ${detail}`, { cause });
    const wait = (/** @type {number} */ attempt) => new Promise((resolve) => setTimeout(resolve, retryDelayMs * 2 ** attempt));

    for (let attempt = 0; ; attempt += 1) {
      let signingCredentials;
      try {
        signingCredentials = await getCredentials();
      } catch (error) {
        throw fail('CredentialsError', error.message, error);
      }
      const headers = signRequest({
        method: 'POST', url, headers: { 'content-type': 'application/json' }, body,
        region, service: 'ses', credentials: signingCredentials, date: now()
      });

      let response;
      try {
        response = await fetch(url, { method: 'POST', headers, body, signal: abort });
      } catch (error) {
        if (abort.aborted || attempt >= RETRIES) throw fail(abort.aborted ? 'Timeout' : 'NetworkError', error.message, error);
        await wait(attempt);
        continue;
      }

      if (response.ok) {
        const result = await response.json().catch(() => ({}));
        return { messageId: typeof result.MessageId === 'string' ? result.MessageId : '' };
      }
      const { type, message: detail } = await sesError(response);
      if ((response.status >= 500 || RETRYABLE_TYPES.has(type)) && attempt < RETRIES && !abort.aborted) {
        await wait(attempt);
        continue;
      }
      throw fail(type, detail);
    }

  }; // send

  return { send, close: async () => {} };

} // createSesTransport
