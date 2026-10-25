import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import WebServer from './altair.js';
import RenderCache from './render-cache.js';
import Tarazed from './tarazed.js';

const createServer = async ({ customize } = {}) => {
  const appRootPath = await mkdtemp(path.join(os.tmpdir(), 'altair-route-cache-'));
  const activeSpace = 'kinetic';
  const activePath = path.join(appRootPath, activeSpace);
  await mkdir(path.join(activePath, 'pages'), { recursive: true });
  await writeFile(path.join(activePath, 'pages', 'home.html'), '<h1>Home @@VAR_YEAR</h1>');
  await writeFile(path.join(activePath, 'pages', 'about.html'), '<h1>About</h1>');
  await writeFile(path.join(activePath, 'pages', 'timed.html'), '<p>@@VAR_TIMESTAMP</p>');
  await writeFile(path.join(activePath, 'pages', 'error.html'), '<p>Error</p>');

  const server = new WebServer();
  Object.assign(server.settings, {
    appRootPath,
    activeSpace,
    pagesLocation: 'pages',
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

  let renders = 0;
  const renderHTMLBody = server.renderHTMLBody;
  server.renderHTMLBody = async (...args) => {
    renders += 1;
    return renderHTMLBody(...args);
  };
  if (customize) customize(server);
  server.routes();
  return { server, appRootPath, renders: () => renders };
};

test('core HTML routes populate lazily, return ETags, and revalidate with 304', async () => {
  const fixture = await createServer();
  try {
    const first = await fixture.server.app.request('http://altair.test/');
    const etag = first.headers.get('etag');
    assert.equal(first.status, 200);
    assert.match(await first.text(), /Home/);
    assert.ok(etag);
    assert.equal(first.headers.get('cache-control'), 'no-cache');

    const second = await fixture.server.app.request('http://altair.test/');
    assert.equal(second.status, 200);
    assert.equal(fixture.renders(), 1);

    const hardReload = await fixture.server.app.request('http://altair.test/', {
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
    });
    assert.equal(hardReload.status, 200);
    assert.equal(fixture.renders(), 1);

    const revalidated = await fixture.server.app.request('http://altair.test/', {
      headers: { 'If-None-Match': `"not-it", ${etag}` }
    });
    assert.equal(revalidated.status, 304);
    assert.equal(await revalidated.text(), '');
    assert.equal(fixture.renders(), 1);
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('generation changes during a render prevent stale cache admission', async () => {
  const fixture = await createServer();
  const renderHTMLBody = fixture.server.renderHTMLBody;
  let releaseRender;
  const renderStarted = new Promise((resolve) => {
    fixture.server.renderHTMLBody = async (...args) => {
      resolve();
      await new Promise((release) => {
        releaseRender = release;
      });
      return renderHTMLBody(...args);
    };
  });

  try {
    const request = fixture.server.app.request('http://altair.test/about');
    await renderStarted;
    fixture.server.invalidateRouteCache('render-race');
    releaseRender();
    assert.equal((await request).status, 200);
    assert.equal(fixture.server.renderCache.stats().entries, 0);
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('reloadActiveSpace reloads DATA and invalidates all route entries', async () => {
  const fixture = await createServer();
  try {
    await writeFile(fixture.server.dataFilePath, JSON.stringify({ title: 'Updated' }));
    await fixture.server.app.request('http://altair.test/about');
    assert.equal(fixture.server.renderCache.stats().entries, 1);

    assert.equal(await fixture.server.reloadActiveSpace({ reason: 'test-deployment' }), true);
    assert.deepEqual(fixture.server.getDataCache(), { title: 'Updated' });
    assert.equal(fixture.server.renderCache.stats().entries, 0);
    assert.equal(fixture.server.routeCacheAdmissionSuspended, false);
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('custom render routes, redirects, and errors never enter the core cache', async () => {
  const fixture = await createServer({
    customize: (server) => {
      const applyGlobalReplacements = server.applyGlobalReplacements;
      server.applyGlobalReplacements = async (options) => {
        if (options.routePath === '/error') throw new Error('test render failure');
        return applyGlobalReplacements(options);
      };
      server.additionalRoutes = () => {
        server.app.get('/custom', (context) => server.renderHTML('about', context));
      };
    }
  });

  try {
    assert.equal((await fixture.server.app.request('http://altair.test/custom')).status, 200);
    assert.equal((await fixture.server.app.request('http://altair.test/custom')).status, 200);
    assert.equal((await fixture.server.app.request('http://altair.test/missing')).status, 301);
    assert.equal((await fixture.server.app.request('http://altair.test/error')).status, 500);
    assert.equal(fixture.server.renderCache.stats().entries, 0);
    assert.equal(fixture.renders(), 4);
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

for (const scenario of [
  { name: 'Set-Cookie', header: 'Set-Cookie', value: 'visitor=private' },
  { name: 'private', header: 'Cache-Control', value: 'private' },
  { name: 'no-store', header: 'Cache-Control', value: 'no-store' }
]) {
  test(`${scenario.name} response policy bypasses route-cache lookup and storage`, async () => {
    const fixture = await createServer({
      customize: (server) => {
        server.app.use('*', async (context, next) => {
          context.header(scenario.header, scenario.value);
          await next();
        });
      }
    });

    try {
      await fixture.server.app.request('http://altair.test/about');
      await fixture.server.app.request('http://altair.test/about');
      assert.equal(fixture.server.renderCache.stats().entries, 0);
      assert.equal(fixture.renders(), 2);
    } finally {
      await rm(fixture.appRootPath, { recursive: true, force: true });
    }
  });
}

test('query strings, cookies, authorization, and timestamp variables bypass storage', async () => {
  const fixture = await createServer();
  try {
    await fixture.server.app.request('http://altair.test/about?ref=test');
    await fixture.server.app.request('http://altair.test/about?');
    await fixture.server.app.request('http://altair.test/about', { headers: { Cookie: 'session=private' } });
    await fixture.server.app.request('http://altair.test/about', { headers: { Authorization: 'Bearer private' } });
    await fixture.server.app.request('http://altair.test/timed');
    await fixture.server.app.request('http://altair.test/timed');

    assert.equal(fixture.server.renderCache.stats().entries, 0);
    assert.equal(fixture.renders(), 6);
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('concurrent cold requests share one render and invalidation forces a new render', async () => {
  const fixture = await createServer();
  const renderHTMLBody = fixture.server.renderHTMLBody;
  fixture.server.renderHTMLBody = async (...args) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return renderHTMLBody(...args);
  };

  try {
    const responses = await Promise.all([
      fixture.server.app.request('http://altair.test/about'),
      fixture.server.app.request('http://altair.test/about'),
      fixture.server.app.request('http://altair.test/about')
    ]);
    assert.deepEqual(responses.map((response) => response.status), [200, 200, 200]);
    assert.equal(fixture.renders(), 1);
    assert.equal(fixture.server.renderCache.stats().coalesced, 2);

    fixture.server.invalidateRouteCache('test-change');
    await fixture.server.app.request('http://altair.test/about');
    assert.equal(fixture.renders(), 2);
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('HEAD uses the GET cache entry without returning a body', async () => {
  const fixture = await createServer();
  try {
    await fixture.server.app.request('http://altair.test/about');
    const response = await fixture.server.app.request('http://altair.test/about', { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '');
    assert.ok(response.headers.get('etag'));
    assert.equal(fixture.renders(), 1);
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});
