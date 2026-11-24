import assert from 'node:assert/strict';
import test from 'node:test';

import { envReader } from '../config.js';
import { createMailer, formatMailbox, normalizeMessage, parseMailbox, resolveMailerOptions } from './mailer.js';
import { createSesTransport } from './ses.js';

const MESSAGE = {
  from: 'Site <no-reply@example.com>',
  to: 'owner@example.com',
  subject: 'Hello',
  text: 'Body'
};

test('parseMailbox accepts bare and display-name forms', () => {
  assert.deepEqual(parseMailbox('a@example.com', 's'), { address: 'a@example.com' });
  assert.deepEqual(parseMailbox('Ann Lee <a@example.com>', 's'), { name: 'Ann Lee', address: 'a@example.com' });
  assert.deepEqual(parseMailbox('"Lee, Ann" <a@example.com>', 's'), { name: 'Lee, Ann', address: 'a@example.com' });
  for (const bad of ['', 'not-an-address', 'a@b', 'a@example.com\r\nBcc: x@example.com', 'a@example.com, b@example.com', 'x <y>']) {
    assert.throws(() => parseMailbox(bad, 'mail to'), /mail to/);
  }
});

test('formatMailbox quotes special names and encodes non-ASCII ones', () => {
  assert.equal(formatMailbox({ address: 'a@example.com' }), 'a@example.com');
  assert.equal(formatMailbox({ name: 'Ann', address: 'a@example.com' }), 'Ann <a@example.com>');
  assert.equal(formatMailbox({ name: 'Lee, Ann', address: 'a@example.com' }), '"Lee, Ann" <a@example.com>');
  assert.equal(formatMailbox({ name: 'José', address: 'j@example.com' }), `=?UTF-8?B?${Buffer.from('José').toString('base64')}?= <j@example.com>`);
});

test('normalizeMessage refuses anything that could add headers or recipients', () => {
  assert.equal(normalizeMessage(MESSAGE).to[0].address, 'owner@example.com');
  assert.throws(() => normalizeMessage({ ...MESSAGE, subject: 'Hi\r\nBcc: x@example.com' }), /subject/);
  assert.throws(() => normalizeMessage({ ...MESSAGE, replyTo: 'x@example.com\nBcc: y@example.com' }), /replyTo/);
  assert.throws(() => normalizeMessage({ ...MESSAGE, to: [] }), /at least one/);
  assert.throws(() => normalizeMessage({ ...MESSAGE, text: '' }), /text/);
});

test('resolveMailerOptions reads MAIL_* through an env reader', () => {
  assert.deepEqual(resolveMailerOptions(envReader({ MAIL_PROVIDER: 'log' })), { provider: 'log' });
  assert.deepEqual(resolveMailerOptions(envReader({ MAIL_PROVIDER: 'ses', MAIL_SES_REGION: 'us-east-1' })), { provider: 'ses', region: 'us-east-1', role: {} });
  assert.deepEqual(resolveMailerOptions(envReader({ MAIL_PROVIDER: 'ses', MAIL_SES_REGION: 'us-east-1', AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/x' })),
    { provider: 'ses', region: 'us-east-1', role: { containerRelativeUri: '/v2/credentials/x' } });
  assert.deepEqual(
    resolveMailerOptions(envReader({ MAIL_PROVIDER: 'ses', MAIL_SES_REGION: 'eu-west-2', MAIL_SES_ACCESS_KEY_ID: 'AKIA', MAIL_SES_SECRET_ACCESS_KEY: 'secret' })),
    { provider: 'ses', region: 'eu-west-2', credentials: { accessKeyId: 'AKIA', secretAccessKey: 'secret' } }
  );
  assert.throws(() => resolveMailerOptions(envReader({})), /MAIL_PROVIDER is required/);
  assert.throws(() => resolveMailerOptions(envReader({ MAIL_PROVIDER: 'smtp' })), /must be one of ses, log/);
  assert.throws(() => resolveMailerOptions(envReader({ MAIL_PROVIDER: 'ses' })), /MAIL_SES_REGION is required/);
  assert.throws(() => resolveMailerOptions(envReader({ MAIL_PROVIDER: 'ses', MAIL_SES_REGION: 'virginia' })), /AWS region/);
  assert.throws(() => resolveMailerOptions(envReader({ MAIL_PROVIDER: 'ses', MAIL_SES_REGION: 'us-east-1', MAIL_SES_ACCESS_KEY_ID: 'AKIA' })), /both/);
});

test('the log provider prints the message instead of sending it', async () => {
  const printed = [];
  const mailer = await createMailer({ provider: 'log' }, { write: (text) => printed.push(text) });
  const { messageId } = await mailer.send({ ...MESSAGE, replyTo: 'visitor@example.com' });
  assert.match(messageId, /^log-/);
  assert.match(printed[0], /From: Site <no-reply@example.com>\nTo: owner@example.com\nReply-To: visitor@example.com\nSubject: Hello\n\nBody/);
  await assert.rejects(mailer.send({ ...MESSAGE, to: 'bad' }), /not a valid email address/);
  await mailer.close();
});

// ses : a fetch stand-in for the SES endpoint; answers are consumed in order, the last one repeats
const ses = (...answers) => {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body) });
    const answer = answers[Math.min(requests.length - 1, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status ?? 200, headers: answer.headers ?? {} });
  };
  return { fetch, requests };
};
const KEYS = { region: 'us-east-1', credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' } };

test('the SES transport posts one signed SendEmail request with UTF-8 simple content', async () => {
  const { fetch, requests } = ses({ body: { MessageId: 'ses-123' } });
  const { send, close } = await createSesTransport(KEYS, { fetch, now: () => new Date('2026-11-21T14:05:09Z') });
  const result = await send(normalizeMessage({ ...MESSAGE, cc: 'cc@example.com', replyTo: 'Visitor <v@example.com>' }));
  assert.deepEqual(result, { messageId: 'ses-123' });
  const [request] = requests;
  assert.equal(request.url, 'https://email.us-east-1.amazonaws.com/v2/email/outbound-emails');
  assert.equal(request.method, 'POST');
  assert.equal(request.headers['content-type'], 'application/json');
  assert.equal(request.headers['x-amz-date'], '20261121T140509Z');
  assert.match(request.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261121\/us-east-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.deepEqual(request.body, {
    FromEmailAddress: 'Site <no-reply@example.com>',
    Destination: { ToAddresses: ['owner@example.com'], CcAddresses: ['cc@example.com'] },
    ReplyToAddresses: ['Visitor <v@example.com>'],
    Content: { Simple: {
      Subject: { Data: 'Hello', Charset: 'UTF-8' },
      Body: { Text: { Data: 'Body', Charset: 'UTF-8' } }
    } }
  });
  await close();
});

test('SES errors are reported with their name; only throttling and server errors are retried', async () => {
  const rejected = ses({ status: 400, headers: { 'x-amzn-errortype': 'MessageRejected:http://internal.amazon.com/coral/com.amazon.ses/' }, body: { message: 'Email address is not verified.' } });
  const transport = await createSesTransport(KEYS, { fetch: rejected.fetch, retryDelayMs: 1 });
  await assert.rejects(transport.send(normalizeMessage(MESSAGE)), /SES SendEmail failed \(MessageRejected\): Email address is not verified/);
  assert.equal(rejected.requests.length, 1);

  const flaky = ses({ status: 503, body: { message: 'busy' } }, { status: 429, headers: { 'x-amzn-errortype': 'TooManyRequestsException' }, body: { message: 'slow down' } }, { body: { MessageId: 'ok' } });
  const retrying = await createSesTransport(KEYS, { fetch: flaky.fetch, retryDelayMs: 1 });
  assert.deepEqual(await retrying.send(normalizeMessage(MESSAGE)), { messageId: 'ok' });
  assert.equal(flaky.requests.length, 3);

  const down = ses(new Error('getaddrinfo ENOTFOUND'));
  const offline = await createSesTransport(KEYS, { fetch: down.fetch, retryDelayMs: 1 });
  await assert.rejects(offline.send(normalizeMessage(MESSAGE)), /SES SendEmail failed \(NetworkError\): getaddrinfo ENOTFOUND/);
  assert.equal(down.requests.length, 3);
});

test('without keys the transport signs with the role credentials and their session token', async () => {
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url, headers: init.headers });
    if (url.startsWith('http://169.254.170.2/')) {
      return new Response(JSON.stringify({ AccessKeyId: 'ASIAROLE', SecretAccessKey: 's', Token: 'session', Expiration: '2999-01-01T00:00:00Z' }));
    }
    return new Response(JSON.stringify({ MessageId: 'm' }));
  };
  const { send } = await createSesTransport({ region: 'us-east-1', role: { containerRelativeUri: '/v2/credentials/x' } }, { fetch });
  await send(normalizeMessage(MESSAGE));
  await send(normalizeMessage(MESSAGE));
  assert.deepEqual(requests.map((request) => request.url), [
    'http://169.254.170.2/v2/credentials/x',
    'https://email.us-east-1.amazonaws.com/v2/email/outbound-emails',
    'https://email.us-east-1.amazonaws.com/v2/email/outbound-emails'
  ]);
  assert.equal(requests[1].headers['x-amz-security-token'], 'session');
  assert.match(requests[1].headers.authorization, /Credential=ASIAROLE\//);
});
