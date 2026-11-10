import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createTestSettings } from '../altair/test/helpers.js';
import defaults from '../config/default.json' with { type: 'json' };
import { CSS_ROUTE, IMMUTABLE, findCli } from '../extensions/tailwind/tailwind.js';
import WebApp from '../web-app/web-app.js';

// Checks this project's real Tailwind setup. Both tests skip themselves when
// the project has turned Tailwind off by removing extensions.tailwind.

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tailwindConfig = defaults.extensions?.tailwind;
const notConfigured = tailwindConfig === undefined && 'extensions.tailwind is not configured';
const cli = await findCli(projectRoot);

test('the generated stylesheet matches its sources', { skip: notConfigured || (!cli && 'the Tailwind CLI is not installed') }, () => {
  const { status, stdout, stderr } = spawnSync(process.execPath, ['extensions/tailwind/build.js', '--check'], {
    cwd: projectRoot,
    encoding: 'utf8'
  });
  assert.equal(status, 0, `${stdout}${stderr}`);
});

test('production pages link the generated stylesheet with a long-lived version', { skip: notConfigured }, async (t) => {
  const app = new WebApp({ settings: createTestSettings({
    nodeEnv: 'production',
    enableDataWatch: false,
    debug: false,
    extensions: { tailwind: tailwindConfig }
  }) });
  await app.setupExtensions();
  await app.prepare();
  try {
    const request = (pathname) => app.app.request(`http://altair.test${pathname}`);
    const html = await (await request('/')).text();
    const href = html.match(new RegExp(`${CSS_ROUTE}\\?v=[0-9a-f]{12}`))?.[0];
    if (!href) return t.skip('the home page is excluded from Tailwind');

    const response = await request(href);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), IMMUTABLE);
    assert.match(await response.text(), /tailwindcss/);
  } finally {
    await app.shutdown();
  }
});
