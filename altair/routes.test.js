import assert from 'node:assert/strict';
import test from 'node:test';

import WebServer from './altair.js';
import { createExtensionTestServer } from './test/helpers.js';

test('custom routes ending in .js or .css are reachable', async () => {
  class App extends WebServer {
    additionalRoutes() {
      this.app.get('/api/config.js', (context) => context.body('window.config = {};', 200, { 'Content-Type': 'application/javascript' }));
      this.app.get('/theme/custom.css', (context) => context.body('body{}', 200, { 'Content-Type': 'text/css' }));
    }
  }
  const { request, cleanup } = await createExtensionTestServer({ App, files: { 'js/site.js': 'const site = 1;' } });
  try {
    const config = await request('/api/config.js');
    assert.equal(config.status, 200);
    assert.equal(await config.text(), 'window.config = {};');
    assert.equal(await (await request('/theme/custom.css')).text(), 'body{}');
    // Files in the space are still served by the asset route
    assert.equal(await (await request('/js/site.js')).text(), 'const site = 1;');
  } finally {
    await cleanup();
  }
});

test('trailing slashes and /home redirect to one canonical URL', async () => {
  const { request, cleanup } = await createExtensionTestServer({
    pages: {
      'home.html': '<p>home @@VAR_currentpath</p>',
      'about.html': '<p>about @@VAR_currentpath</p>'
    },
    settings: { enableRouteCache: true }
  });
  try {
    const cases = [['/about/', '/about'], ['/about//', '/about'], ['/about/?ref=nav', '/about?ref=nav'], ['/home', '/'], ['/home/', '/']];
    for (const [from, to] of cases) {
      const response = await request(from);
      assert.equal(response.status, 301, from);
      assert.equal(response.headers.get('location'), to, from);
    }
    assert.equal(await (await request('/about')).text(), '<p>about /about</p>');
    assert.equal(await (await request('/')).text(), '<p>home /</p>');
  } finally {
    await cleanup();
  }
});
