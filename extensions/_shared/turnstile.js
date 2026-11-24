// @ts-check
/**
 * Cloudflare Turnstile verification
 *
 * Server-side check of the token the Turnstile widget adds to a form (as the
 * field "cf-turnstile-response"). Shared by the forms extension and by any
 * application code that protects a POST route (sign-in, sign-up, comments).
 * Uses fetch; no npm package.
 *
 *   TURNSTILE_SECRET_KEY  the widget's secret key (server only). The public
 *                         site key belongs in config or the page, never here.
 *
 * Besides "success", a token is accepted only when the widget's action and
 * the page's hostname match what the caller expects, so a token solved on
 * another site or for another form is refused. Tokens are single use and
 * expire after 300 seconds. Cloudflare's test secrets (1x…AA, 2x…AA, 3x…AA)
 * answer with placeholder action and hostname, so those two checks are
 * skipped for them.
 */

export const TURNSTILE_RESPONSE_FIELD = 'cf-turnstile-response';
export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048;
const TEST_SECRET = /^[123]x0+AA$/;

/**
 * isTurnstileTestSecret : one of Cloudflare's published testing secrets
 * @param {string} secret
 */
export const isTurnstileTestSecret = (secret) => TEST_SECRET.test(secret);

/**
 * @typedef {object} TurnstileResult
 * @property {boolean} success
 * @property {string[]} errorCodes Cloudflare's error codes, plus "action-mismatch",
 *   "hostname-mismatch" or "request-failed" (Cloudflare could not be reached)
 * @property {string} [hostname]
 * @property {string} [action]
 */

/**
 * createTurnstileVerifier : verify tokens with one secret
 * @param {{ secret: string, fetch?: typeof globalThis.fetch, timeoutMs?: number }} options
 *   fetch: replaces global fetch (tests)
 */
export const createTurnstileVerifier = ({ secret, fetch = globalThis.fetch, timeoutMs = 10000 }) => {

  if (typeof secret !== 'string' || secret.trim() === '') throw new Error('Turnstile needs a secret key');
  const testing = isTurnstileTestSecret(secret);

  /**
   * verify : check one token
   * @param {{ token: unknown, action?: string, hostnames?: string[], remoteIp?: string, idempotencyKey?: string }} input
   * @returns {Promise<TurnstileResult>}
   */
  const verify = async ({ token, action, hostnames, remoteIp, idempotencyKey }) => {

    if (typeof token !== 'string' || token === '') return { success: false, errorCodes: ['missing-input-response'] };
    if (token.length > MAX_TOKEN_LENGTH) return { success: false, errorCodes: ['invalid-input-response'] };

    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);
    if (idempotencyKey) body.set('idempotency_key', idempotencyKey);

    let outcome;
    try {
      const response = await fetch(SITEVERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) return { success: false, errorCodes: ['request-failed'] };
      outcome = await response.json();
    } catch {
      return { success: false, errorCodes: ['request-failed'] };
    }

    const result = {
      success: outcome?.success === true,
      errorCodes: Array.isArray(outcome?.['error-codes']) ? outcome['error-codes'].map(String) : [],
      hostname: typeof outcome?.hostname === 'string' ? outcome.hostname : undefined,
      action: typeof outcome?.action === 'string' ? outcome.action : undefined
    };
    if (!result.success || testing) return result;
    if (action !== undefined && result.action !== action) return { ...result, success: false, errorCodes: ['action-mismatch'] };
    if (hostnames?.length && !hostnames.includes(result.hostname ?? '')) {
      return { ...result, success: false, errorCodes: ['hostname-mismatch'] };
    }
    return result;

  }; // verify

  return Object.freeze({ verify, testing });

} // createTurnstileVerifier
