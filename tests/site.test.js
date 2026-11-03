import assert from 'node:assert/strict';
import test from 'node:test';

import { createTestSettings } from '../altair/test/helpers.js';
import WebApp from '../web-app/web-app.js';

// Application tests live in tests/ and run with `pnpm test:app` (part of `pnpm test`).
// This smoke test renders the real active space through the real WebApp, in
// process and without a port. Add tests for your own pages and routes here.

// createSite : the web app prepared exactly as start() prepares it
const createSite = async (settings = {}) => {
  const app = new WebApp({ settings: createTestSettings({ enableDataWatch: false, debug: false, ...settings }) });
  await app.setupExtensions();
  await app.prepare();
  const request = (pathname) => app.app.request(`http://altair.test${pathname}`);
  return { app, request, close: () => app.shutdown() };
};

test('the home page renders with every template tag resolved', async () => {
  const site = await createSite();
  try {
    const response = await site.request('/');
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<html/i);
    assert.doesNotMatch(html, /UNDEFINED|@@(ELEM|REPEAT|DATA|VAR|PARAM)_/);
  } finally {
    await site.close();
  }
});

test('the stylesheet and script are served', async () => {
  const site = await createSite();
  try {
    for (const pathname of ['/css/styles.css', '/js/scripts.js']) {
      const response = await site.request(pathname);
      assert.equal(response.status, 200, pathname);
      assert.doesNotMatch(await response.text(), /UNDEFINED/, pathname);
    }
  } finally {
    await site.close();
  }
});

test('an unknown page returns the 404 page', async () => {
  const site = await createSite();
  try {
    const response = await site.request('/no-such-page');
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  } finally {
    await site.close();
  }
});
