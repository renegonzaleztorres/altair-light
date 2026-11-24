// @ts-check
/**
 * AWS credentials for fetch-based clients
 *
 * Either fixed access keys, or the temporary credentials of the role the
 * server runs under, from:
 *
 * - the container credentials endpoint: ECS and Fargate task roles, App
 *   Runner, EKS Pod Identity (AWS_CONTAINER_CREDENTIALS_RELATIVE_URI or
 *   AWS_CONTAINER_CREDENTIALS_FULL_URI, set by the platform), or
 * - the EC2 instance metadata service (IMDSv2) for an instance role.
 *
 * Not supported: profiles in ~/.aws, SSO, and web identity (EKS IRSA); use
 * access keys there. Role credentials are fetched on first use, not at
 * startup, and fetched again 5 minutes before they expire.
 */

import { readFile } from 'node:fs/promises';

const ECS_ENDPOINT = 'http://169.254.170.2';
const IMDS_ENDPOINT = 'http://169.254.169.254';
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
// Hosts the SDK also accepts for a plain-http AWS_CONTAINER_CREDENTIALS_FULL_URI
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '169.254.170.2', '169.254.170.23', '[fd00:ec2::23]']);

/**
 * @typedef {import('./sigv4.js').AwsCredentials} AwsCredentials
 * @typedef {object} RoleSource Platform variables, read by the caller through its env reader
 * @property {string} [containerRelativeUri] AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
 * @property {string} [containerFullUri] AWS_CONTAINER_CREDENTIALS_FULL_URI
 * @property {string} [containerToken] AWS_CONTAINER_AUTHORIZATION_TOKEN
 * @property {string} [containerTokenFile] AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE
 */

/**
 * readRoleSource : the platform's container-credential variables, all optional
 * @param {(name: string, options?: { required?: boolean }) => string | undefined} readEnv
 * @returns {RoleSource}
 */
export const readRoleSource = (readEnv) => {

  const source = {
    containerRelativeUri: readEnv('AWS_CONTAINER_CREDENTIALS_RELATIVE_URI', { required: false }),
    containerFullUri: readEnv('AWS_CONTAINER_CREDENTIALS_FULL_URI', { required: false }),
    containerToken: readEnv('AWS_CONTAINER_AUTHORIZATION_TOKEN', { required: false }),
    containerTokenFile: readEnv('AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE', { required: false })
  };
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined));

} // readRoleSource

/**
 * parseCredentials : the JSON both endpoints return
 * @param {any} json
 * @returns {{ credentials: AwsCredentials, expiration?: number }}
 */
const parseCredentials = (json) => {

  if (typeof json?.AccessKeyId !== 'string' || typeof json?.SecretAccessKey !== 'string') {
    throw new Error('the credentials response has no AccessKeyId and SecretAccessKey');
  }
  const expiration = typeof json.Expiration === 'string' ? Date.parse(json.Expiration) : NaN;
  return {
    credentials: {
      accessKeyId: json.AccessKeyId,
      secretAccessKey: json.SecretAccessKey,
      ...(typeof json.Token === 'string' && json.Token ? { sessionToken: json.Token } : {})
    },
    ...(Number.isNaN(expiration) ? {} : { expiration })
  };

} // parseCredentials

/**
 * createCredentialProvider : a function returning current credentials
 * @param {{ credentials?: AwsCredentials, role?: RoleSource, fetch?: typeof globalThis.fetch, timeoutMs?: number, now?: () => number }} options
 * @returns {() => Promise<AwsCredentials>}
 */
export const createCredentialProvider = ({ credentials, role = {}, fetch = globalThis.fetch, timeoutMs = 2000, now = Date.now }) => {

  if (credentials) return async () => credentials;

  const get = async (/** @type {string} */ url, /** @type {RequestInit} */ init = {}) => {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url} answered ${response.status}`);
    return response;
  };

  const fromContainer = async () => {
    const url = role.containerRelativeUri ? `${ECS_ENDPOINT}${role.containerRelativeUri}` : /** @type {string} */ (role.containerFullUri);
    const target = new URL(url);
    if (target.protocol !== 'https:' && !(target.protocol === 'http:' && LOCAL_HOSTS.has(target.hostname))) {
      throw new Error(`AWS_CONTAINER_CREDENTIALS_FULL_URI must be https or a local container endpoint; got ${target.origin}`);
    }
    const token = role.containerToken ?? (role.containerTokenFile ? (await readFile(role.containerTokenFile, 'utf8')).trim() : undefined);
    return (await get(url, token ? { headers: { Authorization: token } } : {})).json();
  };

  const fromInstance = async () => {
    const token = await (await get(`${IMDS_ENDPOINT}/latest/api/token`, {
      method: 'PUT', headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '21600' }
    })).text();
    const headers = { 'X-aws-ec2-metadata-token': token };
    const base = `${IMDS_ENDPOINT}/latest/meta-data/iam/security-credentials/`;
    const roleName = (await (await get(base, { headers })).text()).split('\n')[0].trim();
    if (!roleName) throw new Error('the instance has no IAM role');
    return (await get(`${base}${encodeURIComponent(roleName)}`, { headers })).json();
  };

  /** @type {{ credentials: AwsCredentials, expiration?: number } | undefined} */
  let cached;
  /** @type {Promise<AwsCredentials> | undefined} */
  let pending;
  const load = async () => {
    const containerRole = Boolean(role.containerRelativeUri || role.containerFullUri);
    try {
      cached = parseCredentials(containerRole ? await fromContainer() : await fromInstance());
      return cached.credentials;
    } catch (error) {
      const where = containerRole ? 'the container credentials endpoint' : 'the EC2 instance metadata service';
      throw new Error(`no AWS credentials from ${where} (${error.message}). Set access keys, or run with an ECS task role or EC2 instance role`, { cause: error });
    }
  };

  return async () => {
    if (cached && (cached.expiration === undefined || cached.expiration - now() > REFRESH_MARGIN_MS)) return cached.credentials;
    pending ??= load().finally(() => { pending = undefined; });
    return pending;
  };

} // createCredentialProvider
