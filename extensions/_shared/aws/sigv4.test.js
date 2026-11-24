import assert from 'node:assert/strict';
import test from 'node:test';

import { amzDate, signRequest } from './sigv4.js';

const EXAMPLE = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };
const signatureOf = (headers) => headers.authorization.split('Signature=')[1];

test('matches the AWS Signature Version 4 test suite (get-vanilla)', () => {
  const headers = signRequest({
    method: 'GET', url: 'https://example.amazonaws.com/', region: 'us-east-1', service: 'service',
    credentials: EXAMPLE, date: new Date('2015-08-30T12:36:00Z')
  });
  assert.equal(headers.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, ' +
    'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  assert.equal(headers['x-amz-date'], '20150830T123600Z');
  assert.equal(headers.host, undefined); // fetch sends Host itself
});

// Expected signatures below were produced by the AWS SDK's signer (@smithy/signature-v4, without the
// optional x-amz-content-sha256 header) for the same request, and match this implementation.
const SES_REQUEST = {
  method: 'POST',
  url: 'https://email.us-east-1.amazonaws.com/v2/email/outbound-emails',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ FromEmailAddress: 'José <no-reply@example.com>', Content: { Simple: { Subject: { Data: 'Héllo · test', Charset: 'UTF-8' } } } }),
  region: 'us-east-1',
  service: 'ses',
  date: new Date('2026-11-21T14:05:09Z')
};

test('signs an SES SendEmail request like the AWS SDK, with UTF-8 in the body', () => {
  const headers = signRequest({ ...SES_REQUEST, credentials: EXAMPLE });
  assert.match(headers.authorization, /SignedHeaders=content-type;host;x-amz-date,/);
  assert.equal(signatureOf(headers), '2fd8b34c0f9ea061cdf0f2721bb63ea37b45fab72b0536c7ce1b0f15f67454da');
  assert.equal(headers['content-type'], 'application/json');
});

test('signs and sends the session token of temporary credentials', () => {
  const credentials = { accessKeyId: 'ASIAEXAMPLE', secretAccessKey: 'secret/with+chars', sessionToken: 'FwoGZXIvYXdzEJr//////////wEaDOexampletoken==' };
  const headers = signRequest({ ...SES_REQUEST, credentials });
  assert.equal(headers['x-amz-security-token'], credentials.sessionToken);
  assert.match(headers.authorization, /SignedHeaders=content-type;host;x-amz-date;x-amz-security-token,/);
  assert.equal(signatureOf(headers), '43170e2b97cd2a077619c8e8bf661280fbb3117b4d76e840fe2189db2f6f9709');
});

test('encodes and sorts the query string like the AWS SDK', () => {
  const headers = signRequest({
    method: 'GET', url: 'https://email.eu-west-2.amazonaws.com/v2/email/identities?PageSize=10&NextToken=a%2Bb c',
    region: 'eu-west-2', service: 'ses', credentials: { accessKeyId: 'AKID', secretAccessKey: 'x' }, date: SES_REQUEST.date
  });
  assert.equal(signatureOf(headers), '9404a2ae861f8754f11071586ce34589468c2314e399e4e2cd99b5a9d9e04c29');
});

test('refuses paths it would need to encode', () => {
  assert.throws(() => signRequest({ ...SES_REQUEST, url: 'https://example.amazonaws.com/a b', credentials: EXAMPLE }), /unsupported characters/);
  assert.equal(amzDate(new Date('2026-01-02T03:04:05.678Z')), '20260102T030405Z');
});
