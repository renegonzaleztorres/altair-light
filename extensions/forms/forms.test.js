import assert from 'node:assert/strict';
import test from 'node:test';

import { createExtensionTestServer } from '../../altair/test/helpers.js';
import { createFormsExtension, renderTemplate } from './forms.js';

const ORIGIN = 'http://altair.test';
const PAGE = '<!doctype html><html><head><title>Page</title></head><body>Content</body></html>';
const SECRET = '0x4AAAAAAAreal-secret';

const contactForm = (overrides = {}) => ({
  fields: {
    name: { type: 'text', label: 'Name', required: true, maxLength: 50 },
    email: { type: 'email', label: 'Email', required: true },
    topic: { type: 'select', label: 'Topic', options: ['sales', 'support'] },
    message: { type: 'textarea', label: 'Message', required: true },
    consent: { type: 'checkbox', label: 'Consent' }
  },
  honeypot: 'website',
  notification: {
    from: 'Site <no-reply@example.com>',
    to: ['owner@example.com'],
    replyToField: 'email',
    subject: 'Contact from {{name}}'
  },
  redirect: { success: '/contact?status=sent', error: '/contact' },
  ...overrides
});

const VALID = { name: 'Ann Lee', email: 'ann@example.com', topic: 'support', message: 'Hello\r\nthere', website: '' };

// withForms : a prepared server with a recording mail transport and a stand-in Cloudflare
const withForms = async ({ config, env = { MAIL_PROVIDER: 'log' }, files = {}, transport, turnstile }, body) => {
  const sent = [];
  const verifications = [];
  const extension = createFormsExtension({
    mailer: { transport: transport ?? (async (message) => { sent.push(message); return { messageId: `m${sent.length}` }; }) },
    fetch: async (url, init) => {
      verifications.push(Object.fromEntries(init.body));
      return new Response(JSON.stringify(turnstile ?? { success: true, hostname: 'altair.test', action: 'contact' }));
    }
  });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  let fixture;
  try {
    fixture = await createExtensionTestServer({
      extensions: [extension],
      config: config === undefined ? undefined : { forms: config },
      pages: { 'home.html': PAGE, 'contact.html': PAGE },
      files,
      env
    });
    await body({ ...fixture, sent, verifications, warnings });
  } finally {
    console.warn = originalWarn;
    await fixture?.cleanup();
  }
};

// post : submit fields the way a browser form (or fetch with FormData) does
const post = (request, fields, { path = '/forms/contact', json = false, origin = ORIGIN, headers = {} } = {}) => request(path, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    ...(origin ? { Origin: origin } : {}),
    ...(json ? { Accept: 'application/json' } : {}),
    Referer: `${ORIGIN}/contact`,
    ...headers
  },
  body: new URLSearchParams(fields).toString()
});

const setupError = async (config, env = { MAIL_PROVIDER: 'log' }, files = {}) => {
  try {
    await withForms({ config, env, files }, async () => {});
  } catch (error) {
    return error.message;
  }
  return 'no error';
};

test('without a forms block the extension stays inactive', async () => {
  await withForms({ config: {} }, async ({ request }) => {
    assert.equal((await request('/forms/contact')).status, 404);
  });
});

test('GET describes the form for page scripts, without recipients or secrets', async () => {
  await withForms({ config: { origin: ORIGIN, forms: { contact: contactForm() } } }, async ({ request }) => {
    const response = await request('/forms/contact');
    assert.equal(response.status, 200);
    const description = await response.json();
    assert.equal(description.action, '/forms/contact');
    assert.deepEqual(description.fields.topic, { type: 'select', label: 'Topic', required: false, maxLength: 200, options: ['sales', 'support'] });
    assert.deepEqual(description.fields.consent, { type: 'checkbox', label: 'Consent', required: false });
    assert.equal(description.honeypot, 'website');
    assert.equal(description.turnstile, null);
    assert.doesNotMatch(JSON.stringify(description), /owner@example\.com|no-reply/);
  });
});

test('the browser script is served with an ETag and revalidated', async () => {
  await withForms({ config: { origin: ORIGIN, forms: { contact: contactForm() } } }, async ({ request }) => {
    const response = await request('/forms/client.js');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/javascript/);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    assert.match(await response.text(), /form\[data-altair-form\]/);
    const etag = response.headers.get('etag');
    assert.equal((await request('/forms/client.js', { headers: { 'If-None-Match': etag } })).status, 304);
  });
});

test('a valid fetch submission emails the owner and answers JSON', async () => {
  await withForms({ config: { origin: ORIGIN, forms: { contact: contactForm() } } }, async ({ request, sent }) => {
    const response = await post(request, VALID, { json: true });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { ok, reference } = await response.json();
    assert.equal(ok, true);
    assert.equal(sent.length, 1);
    const [message] = sent;
    assert.equal(message.from.address, 'no-reply@example.com');
    assert.deepEqual(message.to, [{ address: 'owner@example.com' }]);
    assert.deepEqual(message.replyTo, [{ address: 'ann@example.com' }]);
    assert.equal(message.subject, 'Contact from Ann Lee');
    assert.match(message.text, /^New "contact" submission\n\nName: Ann Lee\nEmail: ann@example\.com\nTopic: support\nMessage:\nHello\nthere\n\nConsent: No\n/);
    assert.match(message.text, /Submitted: \w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT/);
    assert.match(message.text, /Page: \/contact\n/);
    assert.match(message.text, new RegExp(`Reference: ${reference}`));
  });
});

test('a plain HTML submission is answered with a 303 to the success page', async () => {
  await withForms({ config: { origin: ORIGIN, forms: { contact: contactForm() } } }, async ({ request, sent }) => {
    const response = await post(request, { ...VALID, consent: 'on' });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/contact?status=sent');
    assert.match(sent[0].text, /Consent: Yes/);
  });
});

test('invalid fields are reported per field and nothing is sent', async () => {
  await withForms({ config: { origin: ORIGIN, forms: { contact: contactForm() } } }, async ({ request, sent }) => {
    const fields = { ...VALID, email: 'not-an-email', message: '  ', topic: 'other', name: 'Ann\nBcc: x@example.com' };
    const response = await post(request, fields, { json: true });
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: 'invalid',
      fields: { name: 'invalid', email: 'invalid', topic: 'invalid', message: 'required' }
    });

    const redirect = await post(request, { ...VALID, name: 'x'.repeat(51) });
    assert.equal(redirect.status, 303);
    assert.equal(redirect.headers.get('location'), '/contact?status=invalid&fields=name');
    assert.equal(sent.length, 0);
  });
});

test('a filled honeypot looks like success but sends nothing', async () => {
  await withForms({ config: { origin: ORIGIN, forms: { contact: contactForm() } } }, async ({ request, sent }) => {
    const response = await post(request, { ...VALID, website: 'http://spam.example' }, { json: true });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    assert.equal(sent.length, 0);
  });
});

test('cross-site posts, other encodings and oversized bodies are refused', async () => {
  await withForms({ config: { origin: ORIGIN, maxBodyBytes: 1024, forms: { contact: contactForm() } } }, async ({ request, sent }) => {
    assert.equal((await post(request, VALID, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await post(request, VALID, { origin: null })).status, 403);
    assert.equal((await post(request, VALID, { origin: null, headers: { 'Sec-Fetch-Site': 'same-origin' } })).status, 303);
    const asJson = await request('/forms/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Accept: 'application/json' },
      body: JSON.stringify(VALID)
    });
    assert.equal(asJson.status, 415);
    assert.equal((await post(request, { ...VALID, message: 'x'.repeat(2000) })).status, 413);
    assert.equal(sent.length, 1);
  });
});

test('a delivery failure returns 502 with a reference and is logged', async () => {
  const transport = async () => { throw new Error('SES SendEmail failed (MessageRejected): not verified'); };
  await withForms({ config: { origin: ORIGIN, forms: { contact: contactForm() } }, transport }, async ({ request, warnings }) => {
    const response = await post(request, VALID, { json: true });
    assert.equal(response.status, 502);
    const { error, reference } = await response.json();
    assert.equal(error, 'delivery');
    assert.ok(warnings.some((line) => line.includes(reference) && line.includes('MessageRejected')));

    const redirect = await post(request, VALID);
    assert.match(redirect.headers.get('location'), /^\/contact\?status=delivery&reference=[0-9a-f-]{36}$/);
  });
});

test('Turnstile: the token is checked for this form and site before sending', async () => {
  const config = { origin: ORIGIN, turnstile: { siteKey: '0x4AAAAAAA-site' }, forms: { contact: contactForm({ turnstile: true }) } };
  const env = { MAIL_PROVIDER: 'log', TURNSTILE_SECRET_KEY: SECRET };
  await withForms({ config, env }, async ({ request, sent, verifications }) => {
    const description = await (await request('/forms/contact')).json();
    assert.deepEqual(description.turnstile, {
      siteKey: '0x4AAAAAAA-site', action: 'contact', script: 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    });
    const response = await post(request, { ...VALID, 'cf-turnstile-response': 'token-1' }, { json: true });
    assert.equal(response.status, 200);
    assert.equal(verifications[0].secret, SECRET);
    assert.equal(verifications[0].response, 'token-1');
    assert.equal(sent.length, 1);

    const missing = await post(request, VALID, { json: true });
    assert.equal(missing.status, 403);
    assert.equal((await missing.json()).error, 'challenge');
  });

  await withForms({ config, env, turnstile: { success: true, hostname: 'elsewhere.example', action: 'contact' } }, async ({ request, sent }) => {
    const response = await post(request, { ...VALID, 'cf-turnstile-response': 'token-2' });
    assert.equal(response.headers.get('location'), '/contact?status=challenge');
    assert.equal(sent.length, 0);
  });
});

test('a confirmation email goes to the sender, from a template in the active space', async () => {
  const config = {
    origin: ORIGIN,
    timeZone: 'America/New_York',
    turnstile: { siteKey: '0x4AAAAAAA-site' },
    forms: {
      contact: contactForm({
        turnstile: true,
        confirmation: {
          toField: 'email',
          replyTo: 'owner@example.com',
          subject: 'We received your message, {{name}}',
          template: '_emails/contact-confirmation.txt'
        }
      })
    }
  };
  const files = { '_emails/contact-confirmation.txt': 'Hi {{name}},\nReceived {{_submittedAtLocal}}.\n\n{{_fields}}\nRef {{_reference}}\n' };
  await withForms({ config, files, env: { MAIL_PROVIDER: 'log', TURNSTILE_SECRET_KEY: SECRET } }, async ({ request, sent }) => {
    const response = await post(request, { ...VALID, 'cf-turnstile-response': 't' }, { json: true });
    const { reference } = await response.json();
    assert.equal(sent.length, 2);
    const confirmation = sent[1];
    assert.deepEqual(confirmation.to, [{ address: 'ann@example.com' }]);
    assert.deepEqual(confirmation.replyTo, [{ address: 'owner@example.com' }]);
    assert.equal(confirmation.from.address, 'no-reply@example.com');
    assert.equal(confirmation.subject, 'We received your message, Ann Lee');
    assert.match(confirmation.text, /^Hi Ann Lee,\nReceived \w+day, \w+ \d+, \d{4} at .+ E[SD]T\./);
    assert.match(confirmation.text, new RegExp(`Ref ${reference}\\n$`));
  });
});

test('ifChecked sends the confirmation only when the visitor asks for a copy', async () => {
  const config = {
    origin: ORIGIN,
    turnstile: { siteKey: '0x4AAAAAAA-site' },
    forms: { contact: contactForm({ turnstile: true, confirmation: { toField: 'email', ifChecked: 'consent', subject: 'Your copy', text: '{{_fields}}' } }) }
  };
  await withForms({ config, env: { MAIL_PROVIDER: 'log', TURNSTILE_SECRET_KEY: SECRET } }, async ({ request, sent }) => {
    await post(request, { ...VALID, 'cf-turnstile-response': 't' });
    assert.equal(sent.length, 1);
    await post(request, { ...VALID, consent: 'on', 'cf-turnstile-response': 't' });
    assert.equal(sent.length, 3);
    assert.equal(sent[2].subject, 'Your copy');
  });
  assert.match(await setupError({ ...config, forms: { contact: contactForm({ turnstile: true, confirmation: { toField: 'email', ifChecked: 'name', subject: 'S', text: 'T' } }) } },
    { MAIL_PROVIDER: 'log', TURNSTILE_SECRET_KEY: SECRET }), /ifChecked must name a checkbox field/);
});

test('configuration mistakes stop startup with the setting named', async () => {
  const base = { origin: ORIGIN, forms: { contact: contactForm() } };
  assert.match(await setupError({ forms: { contact: contactForm() } }), /extensions\.forms\.origin is required/);
  assert.match(await setupError({ ...base, origin: 'https://example.com/contact' }), /must be the site's origin/);
  assert.match(await setupError(base, {}), /MAIL_PROVIDER is required/);
  assert.match(await setupError({ origin: ORIGIN, forms: { contact: contactForm({ notification: { ...contactForm().notification, subject: 'Hi {{nmae}}' } }) } }),
    /notification\.subject: unknown placeholder \{\{nmae\}\}/);
  assert.match(await setupError({ origin: ORIGIN, forms: { contact: contactForm({ notification: { ...contactForm().notification, text: 'At {{_submittedAtLocal}}' } }) } }),
    /set extensions\.forms\.timeZone/);
  assert.match(await setupError({ origin: ORIGIN, forms: { contact: contactForm({ notification: { ...contactForm().notification, replyToField: 'name' } }) } }),
    /replyToField must name an email field/);
  assert.match(await setupError({ origin: ORIGIN, forms: { contact: contactForm({ notification: { ...contactForm().notification, to: 'owner' } }) } }),
    /notification\.to: "owner" is not a valid email address/);
  assert.match(await setupError({ origin: ORIGIN, forms: { contact: contactForm({ fields: { topic: { type: 'select' } } }) } }),
    /fields\.topic\.options must be a non-empty array/);
  assert.match(await setupError({ origin: ORIGIN, forms: { contact: contactForm({ confirmation: { toField: 'email', subject: 'Thanks', text: 'Thanks' } }) } }),
    /confirmation needs turnstile: true/);
  assert.match(await setupError({ ...base, turnstile: { siteKey: 'k' }, forms: { contact: contactForm({ turnstile: true }) } }),
    /TURNSTILE_SECRET_KEY is required/);
  assert.match(await setupError({ origin: ORIGIN, forms: { contact: contactForm({ notification: { ...contactForm().notification, template: '_emails/missing.txt' } }) } }),
    /template \(_emails\/missing\.txt\): cannot read the template \(ENOENT\)/);
  assert.match(await setupError({ origin: ORIGIN, forms: { contact: contactForm({ notification: { ...contactForm().notification, template: 'emails/contact.txt' } }) } }),
    /notification\.template must be in a folder or file whose name starts with "_"/);
  assert.equal(await setupError({ origin: ORIGIN, forms: { contact: contactForm({ notification: { ...contactForm().notification, template: 'emails/_contact.txt' } }) } }, undefined, { 'emails/_contact.txt': 'Hi' }),
    'no error', 'a private file name is enough');
  assert.match(await setupError({ origin: ORIGIN, forms: { contact: contactForm({ notification: { ...contactForm().notification, template: 'public/_emails/contact.txt' } }) } }),
    /must not be in the public folder/);
  assert.match(await setupError({ origin: ORIGIN, forms: { contact: contactForm({ notification: { ...contactForm().notification, template: '../outside.txt' } }) } }),
    /must stay inside the active space/);
  assert.match(await setupError({ origin: ORIGIN, forms: { Contact: contactForm() } }), /invalid form name "Contact"/);
});

test('renderTemplate keeps subjects on one line', () => {
  assert.equal(renderTemplate('Re: {{ name }}', { name: 'Ann\n\tLee' }, { singleLine: true }), 'Re: Ann Lee');
  assert.equal(renderTemplate('{{a}}\n{{b}}', { a: '1', b: 'two\nlines' }), '1\ntwo\nlines');
});
