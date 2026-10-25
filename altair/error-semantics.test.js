import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import WebServer from './altair.js';
import RenderCache from './render-cache.js';
import Tarazed from './tarazed.js';

const createFixture = async ({ custom404, custom500, customize } = {}) => {
  const appRootPath = await mkdtemp(path.join(os.tmpdir(), 'altair-http-errors-'));
  const activeSpace = 'kinetic';
  const activePath = path.join(appRootPath, activeSpace);
  await mkdir(path.join(activePath, 'pages'), { recursive: true });
  await mkdir(path.join(activePath, 'css'), { recursive: true });
  await mkdir(path.join(activePath, 'js'), { recursive: true });
  await mkdir(path.join(activePath, 'public', 'images'), { recursive: true });
  await writeFile(path.join(activePath, 'pages', 'home.html'), '<h1>Home</h1>');
  await writeFile(path.join(activePath, 'pages', 'about.html'), '<h1>About</h1>');
  await writeFile(path.join(activePath, 'pages', 'broken.html'), '<h1>Broken</h1>');
  await writeFile(path.join(activePath, 'css', 'site.css'), 'body { color: red; }');
  await writeFile(path.join(activePath, 'js', 'site.js'), 'globalThis.site = true;');
  if (custom404) await writeFile(path.join(activePath, 'pages', '_404.html'), custom404);
  if (custom500) await writeFile(path.join(activePath, 'pages', '_500.html'), custom500);

  const server = new WebServer();
  Object.assign(server.settings, {
    appRootPath,
    activeSpace,
    pagesLocation: 'pages',
    publicLocation: 'public',
    enableRouteCache: true,
    routeCacheMaxEntries: 20,
    routeCacheDebug: false,
    debug: false,
    minify: false
  });
  server.activeSpacePath = activePath;
  server.publicPath = path.join(activePath, 'public');
  server.dataFilePath = path.join(activePath, 'DATA.json');
  server.tarazed = new Tarazed({ appPath: activePath, readoutCallback: server.readout });
  server.renderCache = new RenderCache({ enabled: true, maxEntries: 20 });
  if (customize) customize(server);
  server.routes();
  return { server, appRootPath, activePath };
};

const request = (server, pathname, options) =>
  server.app.request(`http://altair.test${pathname}`, options);

test('root and rendered assets keep successful response semantics', async () => {
  const fixture = await createFixture();
  try {
    assert.equal((await request(fixture.server, '/')).status, 200);
    assert.equal((await request(fixture.server, '/about')).status, 200);
    assert.equal((await request(fixture.server, '/css/site.css')).status, 200);
    assert.equal((await request(fixture.server, '/js/site.js')).status, 200);
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('missing, private, malformed, asset, and API requests return conservative 404 responses', async () => {
  const fixture = await createFixture();
  try {
    for (const pathname of [
      '/missing', '/_404', '/private/_page', '/%2e%2e/secret',
      '/css/missing.css', '/js/missing.js', '/images/missing.png', '/api/missing'
    ]) {
      const response = await request(fixture.server, pathname);
      assert.equal(response.status, 404, pathname);
      assert.equal(response.headers.get('location'), null, pathname);
      assert.equal(response.headers.get('cache-control'), 'no-store', pathname);
    }

    const htmlResponse = await request(fixture.server, '/missing?source=test');
    assert.equal(htmlResponse.headers.get('x-robots-tag'), 'noindex');
    assert.equal(htmlResponse.headers.get('etag'), null);

    const headResponse = await request(fixture.server, '/missing', { method: 'HEAD' });
    assert.equal(headResponse.status, 404);
    assert.equal(await headResponse.text(), '');

    await unlink(path.join(fixture.activePath, 'pages', 'home.html'));
    const missingRoot = await request(fixture.server, '/');
    assert.equal(missingRoot.status, 404);
    assert.equal(missingRoot.headers.get('location'), null);
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('optional private error pages render with their error status and safe variables', async () => {
  const fixture = await createFixture({
    custom404: '<h1>Custom missing</h1><p>@@VAR_currentpath</p>',
    custom500: '<h1>Custom failure</h1><p>@@VAR_errorreference</p>',
    customize: (server) => {
      const applyGlobalReplacements = server.applyGlobalReplacements;
      server.applyGlobalReplacements = async (options) => {
        if (options.routePath === '/broken') throw new Error('private render detail');
        return applyGlobalReplacements(options);
      };
    }
  });
  try {
    const missing = await request(fixture.server, '/not-present?<unsafe>');
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /Custom missing/);
    assert.equal(missing.headers.get('x-robots-tag'), 'noindex');

    const failed = await request(fixture.server, '/broken');
    const failedBody = await failed.text();
    assert.equal(failed.status, 500);
    assert.match(failedBody, /Custom failure/);
    assert.match(failedBody, /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    assert.doesNotMatch(failedBody, /private render detail|altair-http-errors/);
    assert.equal(failed.headers.get('cache-control'), 'no-store');
    assert.equal(failed.headers.get('x-robots-tag'), 'noindex');
    assert.equal(fixture.server.renderCache.stats().entries, 0);
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('a broken custom 500 page falls back safely without recursive rendering', async () => {
  const fixture = await createFixture({
    custom500: '<h1>Also broken</h1>',
    customize: (server) => {
      const applyGlobalReplacements = server.applyGlobalReplacements;
      server.applyGlobalReplacements = async (options) => {
        if (options.routePath === '/broken' || options.routePath === '_500') {
          throw new Error('must remain private');
        }
        return applyGlobalReplacements(options);
      };
    }
  });
  try {
    const response = await request(fixture.server, '/broken');
    const body = await response.text();
    assert.equal(response.status, 500);
    assert.match(body, /^Server Error\nReference: /);
    assert.doesNotMatch(body, /must remain private/);

    const headResponse = await request(fixture.server, '/broken', { method: 'HEAD' });
    assert.equal(headResponse.status, 500);
    assert.equal(await headResponse.text(), '');
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('an application can redirect only missing HTML pages to root with 307', async () => {
  const fixture = await createFixture({
    customize: (server) => {
      server.handleMissingPage = function(context, { path: requestPath }) {
        if (requestPath === '/') {
          return this.notFound(context, {
            path: requestPath,
            reason: 'root-page-missing',
            resourceType: 'html'
          });
        }
        context.header('Cache-Control', 'no-store');
        return this.redirects(307, '/', context);
      };
    }
  });
  try {
    const missingPage = await request(fixture.server, '/unknown');
    assert.equal(missingPage.status, 307);
    assert.equal(missingPage.headers.get('location'), '/');
    assert.equal(missingPage.headers.get('cache-control'), 'no-store');
    assert.equal((await request(fixture.server, '/images/missing.png')).status, 404);
    assert.equal((await request(fixture.server, '/api/missing')).status, 404);
    assert.equal(fixture.server.renderCache.stats().entries, 0);

    await unlink(path.join(fixture.activePath, 'pages', 'home.html'));
    assert.equal((await request(fixture.server, '/')).status, 404);
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('unhandled route errors are safe and intentional redirects preserve status', async () => {
  const fixture = await createFixture({
    customize: (server) => {
      server.additionalRoutes = () => {
        server.app.get('/throw', () => { throw new Error('internal custom-route detail'); });
        for (const status of [301, 302, 303, 307, 308]) {
          server.app.get(`/redirect-${status}`, (context) => server.redirects(status, '/about', context));
        }
        server.app.get('/api/expected', (context) => context.json({ error: 'expected' }, 422));
      };
    }
  });
  try {
    const failed = await request(fixture.server, '/throw');
    const body = await failed.text();
    assert.equal(failed.status, 500);
    assert.doesNotMatch(body, /internal custom-route detail|altair\.js/);
    assert.equal(failed.headers.get('cache-control'), 'no-store');

    for (const status of [301, 302, 303, 307, 308]) {
      const redirect = await request(fixture.server, `/redirect-${status}`);
      assert.equal(redirect.status, status);
      assert.equal(redirect.headers.get('location'), '/about');
    }

    const expected = await request(fixture.server, '/api/expected');
    assert.equal(expected.status, 422);
    assert.deepEqual(await expected.json(), { error: 'expected' });
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('an unhandled HTML route error can use the private 500 page', async () => {
  const fixture = await createFixture({
    custom500: '<h1>Application failure</h1><p>@@VAR_errorreference</p>',
    customize: (server) => {
      server.additionalRoutes = () => {
        server.app.get('/throw-html', () => { throw new Error('private application detail'); });
      };
    }
  });
  try {
    const response = await request(fixture.server, '/throw-html', {
      headers: { Accept: 'text/html' }
    });
    const body = await response.text();
    assert.equal(response.status, 500);
    assert.match(body, /Application failure/);
    assert.doesNotMatch(body, /private application detail/);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex');
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('CSS and JavaScript transformation failures return safe 500 responses', async () => {
  const fixture = await createFixture({
    customize: (server) => {
      const applyGlobalReplacements = server.applyGlobalReplacements;
      server.applyGlobalReplacements = async (options) => {
        if (options.type === 'css' || options.type === 'js') throw new Error('asset transform detail');
        return applyGlobalReplacements(options);
      };
    }
  });
  try {
    for (const pathname of ['/css/site.css', '/js/site.js']) {
      const response = await request(fixture.server, pathname);
      const body = await response.text();
      assert.equal(response.status, 500, pathname);
      assert.doesNotMatch(body, /asset transform detail|altair-http-errors/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-robots-tag'), null);
    }
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('a page created after a 404 is immediately renderable and cacheable', async () => {
  const fixture = await createFixture();
  try {
    assert.equal((await request(fixture.server, '/new-page')).status, 404);
    assert.equal(fixture.server.renderCache.stats().entries, 0);
    await writeFile(path.join(fixture.activePath, 'pages', 'new-page.html'), '<h1>New</h1>');
    const response = await request(fixture.server, '/new-page');
    assert.equal(response.status, 200);
    assert.equal(fixture.server.renderCache.stats().entries, 1);
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});
