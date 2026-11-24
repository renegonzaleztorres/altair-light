// The starter files that `pnpm extension:add forms` installs must keep working
// with the extension: this serves them exactly as the installer lays them out.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createExtensionTestServer } from '../../altair/test/helpers.js';
import { createFormsExtension } from './forms.js';
import plan from './install.js';

const starter = (file) => readFile(new URL(file, import.meta.url), 'utf8');
const ORIGIN = 'http://localhost:3000';

test('the starter page, emails and config work together', async () => {
  const config = JSON.parse(await starter('starter/config.json'));
  assert.ok(config.origin.includes(ORIGIN));
  const files = {};
  for (const { from, to } of plan.files) files[to] = await starter(from);
  const { 'pages/contact-us.html': page, ...emails } = files;

  // The page posts every configured field (plus the honeypot) and nothing else
  const form = config.forms['contact-us'];
  const names = new Set([...page.matchAll(/\bname="([^"]+)"/g)].map((match) => match[1]));
  assert.deepEqual([...names].sort(), [...Object.keys(form.fields), form.honeypot].sort());
  assert.match(page, /action="\/forms\/contact-us"/);
  assert.match(page, /<script src="\/forms\/client\.js" defer><\/script>/);

  const sent = [];
  const extension = createFormsExtension({
    mailer: { transport: async (message) => { sent.push(message); return { messageId: `m${sent.length}` }; } },
    fetch: async () => new Response(JSON.stringify({ success: true }))
  });
  const originalWarn = console.warn;
  console.warn = () => {};
  let fixture;
  try {
    fixture = await createExtensionTestServer({
      extensions: [extension],
      config: { forms: config },
      pages: { 'home.html': '<p>Home</p>', 'contact-us.html': page },
      files: emails,
      env: { MAIL_PROVIDER: 'log', TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA' }
    });
    const { request } = fixture;
    assert.equal((await request('/contact-us')).status, 200);
    assert.equal((await request('/forms/client.js')).status, 200);

    const response = await request('/forms/contact-us', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN, Accept: 'application/json', Referer: `${ORIGIN}/contact-us` },
      body: new URLSearchParams({
        name: 'Ann Lee', email: 'ann@example.com', topic: 'support', message: 'Hello from the starter page',
        copy: 'on', website: '', 'cf-turnstile-response': 'token'
      }).toString()
    });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).ok, true);
    assert.equal(sent.length, 2, 'notification and confirmation');
    assert.equal(sent[0].subject, '[Contact · support] Ann Lee');
    assert.match(sent[0].text, /Hello from the starter page/);
    assert.equal(sent[1].to[0].address, 'ann@example.com');
  } finally {
    console.warn = originalWarn;
    await fixture?.cleanup();
  }
});

test('the environment block defines what the extension reads', async () => {
  const env = await starter('starter/env.txt');
  for (const name of ['MAIL_PROVIDER', 'MAIL_SES_REGION', 'MAIL_SES_ACCESS_KEY_ID', 'MAIL_SES_SECRET_ACCESS_KEY', 'TURNSTILE_SECRET_KEY']) {
    assert.match(env, new RegExp(`^${name}=`, 'm'));
  }
});
