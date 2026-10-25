import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { serveStatic } from '@hono/node-server/serve-static';

import WebServer from './altair.js';
import RenderCache from './render-cache.js';
import Tarazed from './tarazed.js';

const createServer = async ({ fallback = true, baseUrl = 'https://media.example.com' } = {}) => {
  const appRootPath = await mkdtemp(path.join(os.tmpdir(), 'altair-media-fallback-'));
  const activeSpace = 'spaces/custom';
  const activePath = path.join(appRootPath, activeSpace);
  await mkdir(path.join(activePath, 'public', 'media', 'images'), { recursive: true });
  await mkdir(path.join(activePath, 'pages'), { recursive: true });
  await writeFile(path.join(activePath, 'public', 'media', 'images', 'local.png'), 'local-media');
  await writeFile(path.join(activePath, 'pages', 'home.html'), '<h1>Home</h1>');

  const server = new WebServer();
  Object.assign(server.settings, {
    appRootPath,
    activeSpace,
    publicLocation: 'public',
    pagesLocation: 'pages',
    mediaLocation: 'media',
    mediaCdnFallback: fallback,
    mediaCdnBaseUrl: baseUrl,
    enableRouteCache: false,
    debug: false,
    minify: false
  });
  server.tarazed = new Tarazed({ appPath: activePath, readoutCallback: server.readout });
  server.renderCache = new RenderCache({ enabled: false, maxEntries: 1 });
  server.initializeMediaConfiguration();
  server.app.use('*', serveStatic({ root: server.publicPath }));
  server.app.use('*', (context, next) => server.mediaFallback(context) || next());
  server.routes();
  return { server, appRootPath };
};

test('local media wins and missing media redirects to the same CDN path and query', async () => {
  const fixture = await createServer();
  try {
    const local = await fixture.server.app.request('http://altair.test/media/images/local.png');
    assert.equal(local.status, 200);
    assert.equal(await local.text(), 'local-media');
    assert.equal(local.headers.get('location'), null);

    const missing = await fixture.server.app.request('http://altair.test/media/images/missing.png?v=2');
    assert.equal(missing.status, 307);
    assert.equal(missing.headers.get('location'), 'https://media.example.com/media/images/missing.png?v=2');
    assert.equal(missing.headers.get('cache-control'), 'no-store');
    assert.equal(await missing.text(), '');

    const head = await fixture.server.app.request('http://altair.test/media/video.mp4', { method: 'HEAD' });
    assert.equal(head.status, 307);
    assert.equal(await head.text(), '');
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});

test('disabled fallback, non-media paths, unsupported methods, and unsafe paths retain 404 behavior', async () => {
  const enabled = await createServer();
  const disabled = await createServer({ fallback: false, baseUrl: '' });
  try {
    assert.equal((await disabled.server.app.request('http://altair.test/media/missing.png')).status, 404);
    assert.equal((await enabled.server.app.request('http://altair.test/images/missing.png')).status, 404);
    assert.equal((await enabled.server.app.request('http://altair.test/media/missing.png', { method: 'POST' })).status, 404);
    assert.equal((await enabled.server.app.request('http://altair.test/media/_private.png')).status, 404);
    assert.equal((await enabled.server.app.request('http://altair.test/media/%252e%252e/secret.png')).status, 404);
  } finally {
    await rm(enabled.appRootPath, { recursive: true, force: true });
    await rm(disabled.appRootPath, { recursive: true, force: true });
  }
});

test('invalid fallback configuration is rejected before server startup', async () => {
  const fixture = await createServer({ fallback: false });
  try {
    fixture.server.settings.mediaCdnFallback = true;
    fixture.server.settings.mediaCdnBaseUrl = 'http://media.example.com';
    assert.throws(() => fixture.server.initializeMediaConfiguration(), /must use HTTPS/);
  } finally {
    await rm(fixture.appRootPath, { recursive: true, force: true });
  }
});
