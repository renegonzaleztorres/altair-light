// @ts-check
/**
 * Mailer
 *
 * Sends plain-text (and optionally HTML) email through one transport chosen by
 * MAIL_PROVIDER. Shared by the forms extension and by any application code
 * that sends mail (a sign-in confirmation, a password reset). The transport
 * comes from the environment, because it is a property of the deployment;
 * what to send (from, to, subject, body) comes from the caller.
 *
 *   MAIL_PROVIDER               "ses" sends through Amazon SES; "log" prints the message instead
 *   MAIL_SES_REGION             required for "ses", e.g. us-east-1
 *   MAIL_SES_ACCESS_KEY_ID      optional, with MAIL_SES_SECRET_ACCESS_KEY: keys of an IAM user
 *   MAIL_SES_SECRET_ACCESS_KEY  allowed only ses:SendEmail. Leave both empty to use the role
 *                               the server runs under (ECS/Fargate task, App Runner, EKS Pod
 *                               Identity, EC2 instance); see ../aws/credentials.js
 *
 * Every message is checked before it reaches a transport: addresses must be
 * valid, and no header value (addresses, display names, subject) may contain
 * a line break, so user input can never add headers or recipients.
 */

import { randomUUID } from 'node:crypto';

import { readRoleSource } from '../aws/credentials.js';

export const MAIL_PROVIDERS = Object.freeze(['ses', 'log']);

const ADDRESS_PATTERN = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:".]+(?:\.[^\s@<>()[\]\\,;:".]+)+$/;
const DISPLAY_FORM = /^(.*?)\s*<([^<>]+)>$/;
const LINE_BREAK = /[\r\n]/;
const MAX_RECIPIENTS = 50;
const MAX_SUBJECT = 998;

/**
 * @typedef {{ name?: string, address: string }} Mailbox
 * @typedef {object} MailMessage
 * @property {string} from "Name <address>" or "address"
 * @property {string | string[]} to
 * @property {string | string[]} [cc]
 * @property {string | string[]} [bcc]
 * @property {string | string[]} [replyTo]
 * @property {string} subject
 * @property {string} text Plain-text body
 * @property {string} [html] Optional HTML body, sent alongside the text
 * @typedef {object} NormalizedMessage
 * @property {Mailbox} from
 * @property {Mailbox[]} to
 * @property {Mailbox[]} cc
 * @property {Mailbox[]} bcc
 * @property {Mailbox[]} replyTo
 * @property {string} subject
 * @property {string} text
 * @property {string} [html]
 * @typedef {{ provider: 'ses', region: string, credentials?: { accessKeyId: string, secretAccessKey: string },
 *   role?: import('../aws/credentials.js').RoleSource } | { provider: 'log' }} MailerOptions
 * @typedef {object} Mailer
 * @property {'ses' | 'log'} provider
 * @property {(message: MailMessage, options?: { signal?: AbortSignal }) => Promise<{ messageId: string }>} send
 * @property {() => Promise<void>} close
 * @typedef {(message: NormalizedMessage, options?: { signal?: AbortSignal }) => Promise<{ messageId: string }>} Transport
 */

/**
 * isEmailAddress : a bare address such as name@example.com (no display name)
 * @param {unknown} value
 */
export const isEmailAddress = (value) => typeof value === 'string' && value.length <= 254 && ADDRESS_PATTERN.test(value);

/**
 * parseMailbox : "Name <address>" or "address" into { name, address }; throws naming the setting
 * @param {unknown} value
 * @param {string} setting
 * @returns {Mailbox}
 */
export const parseMailbox = (value, setting) => {

  if (typeof value !== 'string' || value.trim() === '' || LINE_BREAK.test(value)) {
    throw new Error(`${setting} must be an email address on one line`);
  }
  const display = value.trim().match(DISPLAY_FORM);
  const name = display ? display[1].replace(/^"(.*)"$/, '$1').trim() : undefined;
  const address = (display ? display[2] : value).trim();
  if (!isEmailAddress(address)) throw new Error(`${setting}: ${JSON.stringify(value)} is not a valid email address`);
  if (name !== undefined && /["<>]/.test(name)) throw new Error(`${setting}: the display name may not contain quotes or angle brackets`);
  return name ? { name, address } : { address };

} // parseMailbox

/**
 * parseMailboxes : one address or a list into Mailbox[]
 * @param {unknown} value
 * @param {string} setting
 * @param {{ required?: boolean }} [options]
 */
export const parseMailboxes = (value, setting, { required = false } = {}) => {

  if (value === undefined) {
    if (required) throw new Error(`${setting} needs at least one address`);
    return [];
  }
  const list = Array.isArray(value) ? value : [value];
  if (required && list.length === 0) throw new Error(`${setting} needs at least one address`);
  return list.map((entry, index) => parseMailbox(entry, Array.isArray(value) ? `${setting}[${index}]` : setting));

} // parseMailboxes

/**
 * formatMailbox : a Mailbox as a header value; non-ASCII display names use MIME encoded-words
 * @param {Mailbox} mailbox
 */
export const formatMailbox = ({ name, address }) => {

  if (!name) return address;
  if (/[^\x20-\x7e]/.test(name)) return `=?UTF-8?B?${Buffer.from(name, 'utf8').toString('base64')}?= <${address}>`;
  return /[()<>[\]:;@\\,."]/.test(name) ? `"${name}" <${address}>` : `${name} <${address}>`;

} // formatMailbox

/**
 * normalizeMessage : validate a message and resolve its addresses; throws on anything unsafe
 * @param {MailMessage} message
 * @returns {NormalizedMessage}
 */
export const normalizeMessage = (message) => {

  if (!message || typeof message !== 'object') throw new Error('mail message must be an object');
  const from = parseMailbox(message.from, 'mail from');
  const to = parseMailboxes(message.to, 'mail to', { required: true });
  const cc = parseMailboxes(message.cc, 'mail cc');
  const bcc = parseMailboxes(message.bcc, 'mail bcc');
  const replyTo = parseMailboxes(message.replyTo, 'mail replyTo');
  if (to.length + cc.length + bcc.length > MAX_RECIPIENTS) throw new Error(`mail may have at most ${MAX_RECIPIENTS} recipients`);
  const { subject, text, html } = message;
  if (typeof subject !== 'string' || subject.trim() === '' || LINE_BREAK.test(subject) || subject.length > MAX_SUBJECT) {
    throw new Error('mail subject must be a non-empty line of text');
  }
  if (typeof text !== 'string' || text === '') throw new Error('mail text must be a non-empty string');
  if (html !== undefined && typeof html !== 'string') throw new Error('mail html must be a string');
  return { from, to, cc, bcc, replyTo, subject, text, ...(html === undefined ? {} : { html }) };

} // normalizeMessage

/**
 * resolveMailerOptions : read the MAIL_* environment variables through an env reader
 * (an extension's api.env, or envReader() from ../config.js in application code)
 * @param {(name: string, options?: { required?: boolean }) => string | undefined} readEnv
 * @returns {MailerOptions}
 */
export const resolveMailerOptions = (readEnv) => {

  const provider = readEnv('MAIL_PROVIDER');
  if (provider === 'log') return { provider };
  if (provider !== 'ses') throw new Error(`MAIL_PROVIDER must be one of ${MAIL_PROVIDERS.join(', ')}; got ${JSON.stringify(provider)}`);

  const region = /** @type {string} */ (readEnv('MAIL_SES_REGION'));
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region)) throw new Error(`MAIL_SES_REGION must be an AWS region such as us-east-1; got ${JSON.stringify(region)}`);
  const accessKeyId = readEnv('MAIL_SES_ACCESS_KEY_ID', { required: false });
  const secretAccessKey = readEnv('MAIL_SES_SECRET_ACCESS_KEY', { required: false });
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error('Set both MAIL_SES_ACCESS_KEY_ID and MAIL_SES_SECRET_ACCESS_KEY, or neither to use the server\'s AWS role');
  }
  return accessKeyId && secretAccessKey
    ? { provider, region, credentials: { accessKeyId, secretAccessKey } }
    : { provider, region, role: readRoleSource(readEnv) };

} // resolveMailerOptions

/**
 * renderForLog : the readable form of a message the "log" transport prints
 * @param {NormalizedMessage} message
 */
export const renderForLog = (message) => {

  const list = (/** @type {Mailbox[]} */ mailboxes) => mailboxes.map(formatMailbox).join(', ');
  const lines = [
    `From: ${formatMailbox(message.from)}`,
    `To: ${list(message.to)}`,
    ...(message.cc.length ? [`Cc: ${list(message.cc)}`] : []),
    ...(message.bcc.length ? [`Bcc: ${list(message.bcc)}`] : []),
    ...(message.replyTo.length ? [`Reply-To: ${list(message.replyTo)}`] : []),
    `Subject: ${message.subject}`,
    '',
    message.text
  ];
  return lines.join('\n');

} // renderForLog

/**
 * createMailer : a mailer for the resolved options. The SES transport loads only when provider is "ses".
 * @param {MailerOptions} options
 * @param {{ write?: (text: string) => void, transport?: Transport }} [overrides]
 *   write: where the "log" transport prints (default console.log); transport: replaces the provider (tests)
 * @returns {Promise<Mailer>}
 */
export const createMailer = async (options, { write = console.log, transport } = {}) => {

  let send = transport;
  let close = async () => {};
  if (!send && options.provider === 'ses') {
    const { createSesTransport } = await import('./ses.js');
    ({ send, close } = await createSesTransport(options));
  }
  if (!send) {
    send = async (message) => {
      write(`[Mail] MAIL_PROVIDER=log, message not sent:\n${renderForLog(message)}\n[Mail] end of message`);
      return { messageId: `log-${randomUUID()}` };
    };
  }

  const transportSend = send;
  return Object.freeze({
    provider: options.provider,
    send: async (message, sendOptions) => transportSend(normalizeMessage(message), sendOptions),
    close
  });

} // createMailer
