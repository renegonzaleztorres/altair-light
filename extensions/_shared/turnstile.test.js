import assert from 'node:assert/strict';
import test from 'node:test';

import { createTurnstileVerifier, isTurnstileTestSecret } from './turnstile.js';

const SECRET = '0x4AAAAAAAreal-secret';
const TEST_PASS_SECRET = '1x0000000000000000000000000000000AA';

// cloudflare : a fetch stand-in that answers siteverify with outcome and records the request
const cloudflare = (outcome, { status = 200 } = {}) => {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, body: Object.fromEntries(init.body) });
    if (outcome instanceof Error) throw outcome;
    return new Response(JSON.stringify(outcome), { status });
  };
  return { fetch, requests };
};

test('a valid token for the expected action and hostname passes', async () => {
  const { fetch, requests } = cloudflare({ success: true, hostname: 'example.com', action: 'contact', 'error-codes': [] });
  const { verify } = createTurnstileVerifier({ secret: SECRET, fetch });
  const result = await verify({ token: 'token', action: 'contact', hostnames: ['example.com'], remoteIp: '203.0.113.9', idempotencyKey: 'k1' });
  assert.equal(result.success, true);
  assert.equal(requests[0].url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.deepEqual(requests[0].body, { secret: SECRET, response: 'token', remoteip: '203.0.113.9', idempotency_key: 'k1' });
});

test('a token for another action or site is refused', async () => {
  const { fetch } = cloudflare({ success: true, hostname: 'other.example', action: 'signin' });
  const { verify } = createTurnstileVerifier({ secret: SECRET, fetch });
  assert.deepEqual((await verify({ token: 't', action: 'contact' })).errorCodes, ['action-mismatch']);
  assert.deepEqual((await verify({ token: 't', action: 'signin', hostnames: ['example.com'] })).errorCodes, ['hostname-mismatch']);
});

test('Cloudflare refusals, missing tokens and network failures do not pass', async () => {
  const refused = createTurnstileVerifier({ secret: SECRET, fetch: cloudflare({ success: false, 'error-codes': ['timeout-or-duplicate'] }).fetch });
  assert.deepEqual(await refused.verify({ token: 't' }), { success: false, errorCodes: ['timeout-or-duplicate'], hostname: undefined, action: undefined });

  const { fetch, requests } = cloudflare({ success: true });
  const verifier = createTurnstileVerifier({ secret: SECRET, fetch });
  assert.deepEqual((await verifier.verify({ token: '' })).errorCodes, ['missing-input-response']);
  assert.deepEqual((await verifier.verify({ token: ['a', 'b'] })).errorCodes, ['missing-input-response']);
  assert.deepEqual((await verifier.verify({ token: 'x'.repeat(2049) })).errorCodes, ['invalid-input-response']);
  assert.equal(requests.length, 0);

  const offline = createTurnstileVerifier({ secret: SECRET, fetch: cloudflare(new Error('ECONNRESET')).fetch });
  assert.deepEqual((await offline.verify({ token: 't' })).errorCodes, ['request-failed']);
  const failing = createTurnstileVerifier({ secret: SECRET, fetch: cloudflare({}, { status: 500 }).fetch });
  assert.deepEqual((await failing.verify({ token: 't' })).errorCodes, ['request-failed']);
});

test('Cloudflare test secrets skip the action and hostname checks', async () => {
  assert.equal(isTurnstileTestSecret(TEST_PASS_SECRET), true);
  assert.equal(isTurnstileTestSecret(SECRET), false);
  const { fetch } = cloudflare({ success: true, hostname: 'example.com', action: '' });
  const verifier = createTurnstileVerifier({ secret: TEST_PASS_SECRET, fetch });
  assert.equal(verifier.testing, true);
  assert.equal((await verifier.verify({ token: 'XXXX.DUMMY.TOKEN.XXXX', action: 'contact', hostnames: ['localhost'] })).success, true);
});

test('a secret is required', () => {
  assert.throws(() => createTurnstileVerifier({ secret: '' }), /secret key/);
});
