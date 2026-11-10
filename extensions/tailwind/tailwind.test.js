import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createExtensionTestServer } from '../../altair/test/helpers.js';
import { CSS_ROUTE, IMMUTABLE, createTailwind, findCli, injectStylesheet, tailwind } from './tailwind.js';

const PAGE = '<!doctype html><html><head><title>Page</title><link href="/css/styles.css" rel="stylesheet"></head><body></body></html>';
const PAGES = { 'home.html': PAGE, 'about.html': PAGE, 'admin/panel.html': PAGE, '_404.html': PAGE };
const CSS = '.flex{display:flex}';
const OUTPUT = 'public/build/tailwind.css';
const FILES = { [OUTPUT]: CSS, 'public/other.css': '.other{color:red}' };
const PRODUCTION = { nodeEnv: 'production' };

const version = (css) => createHash('sha256').update(css).digest('hex').slice(0, 12);

// withServer : run a test body against a prepared server, capturing warnings, and always clean up
const withServer = async ({ config = {}, pages = PAGES, files = FILES, settings = PRODUCTION, extension = tailwind }, body) => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const fixture = await createExtensionTestServer({ extensions: [extension], config: { tailwind: config }, pages, files, settings });
    try {
      await body({ ...fixture, warnings, output: path.join(fixture.activePath, OUTPUT) });
    } finally {
      await fixture.cleanup();
    }
  } finally {
    console.warn = originalWarn;
  }
};

const html = async (request, route) => (await request(route)).text();

// createFakeCli : a stand-in for the spawned Tailwind process
const createFakeCli = () => {
  const child = Object.assign(new EventEmitter(), { stdin: new EventEmitter(), stderr: new EventEmitter(), killed: false });
  child.kill = () => {
    child.killed = true;
    child.emit('exit', null, 'SIGTERM');
    return true;
  };
  const calls = [];
  const spawnProcess = (...args) => {
    calls.push(args);
    return child;
  };
  return { child, calls, spawnProcess };
};

test('does nothing without its config block', async () => {
  const { request, server, cleanup } = await createExtensionTestServer({ extensions: [tailwind], pages: PAGES, settings: PRODUCTION });
  try {
    assert.equal(server.extensionRunner.status[0].active, false);
    assert.doesNotMatch(await html(request, '/'), /build\/tailwind/);
  } finally {
    await cleanup();
  }
});

test('links the stylesheet with a content version, before the page\'s first stylesheet', async () => {
  await withServer({}, async ({ request }) => {
    const page = await html(request, '/about');
    const link = `<link rel="stylesheet" href="${CSS_ROUTE}?v=${version(CSS)}">`;
    assert.ok(page.includes(link));
    assert.ok(page.indexOf(link) < page.indexOf('/css/styles.css'));
  });
});

test('caches the current version as immutable and anything else as no-cache', async () => {
  await withServer({}, async ({ request }) => {
    const current = await request(`${CSS_ROUTE}?v=${version(CSS)}`);
    assert.equal(current.status, 200);
    assert.equal(current.headers.get('cache-control'), IMMUTABLE);
    assert.match(current.headers.get('content-type'), /text\/css/);
    assert.equal(await current.text(), CSS);

    assert.equal((await request(`${CSS_ROUTE}?v=stale`)).headers.get('cache-control'), 'no-cache');
    assert.equal((await request(CSS_ROUTE)).headers.get('cache-control'), 'no-cache');
  });
});

test('leaves other static files alone', async () => {
  await withServer({}, async ({ request }) => {
    const response = await request(`/other.css?v=${version(CSS)}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), null);
  });
});

test('picks up a stylesheet replaced without a restart', async () => {
  const replacement = '.grid{display:grid;gap:1px}';
  await withServer({}, async ({ request, output }) => {
    await html(request, '/');
    await writeFile(output, replacement);

    assert.ok((await html(request, '/')).includes(`?v=${version(replacement)}`));
    assert.equal((await request(`${CSS_ROUTE}?v=${version(replacement)}`)).headers.get('cache-control'), IMMUTABLE);
    assert.equal((await request(`${CSS_ROUTE}?v=${version(CSS)}`)).headers.get('cache-control'), 'no-cache');
  });
});

test('route-cached pages keep their link until the cache is cleared, and the ETag then changes', async () => {
  const replacement = '.grid{display:grid;gap:1px}';
  await withServer({ settings: { ...PRODUCTION, enableRouteCache: true, routeCacheWatch: false } }, async ({ request, server, output }) => {
    const first = await request('/');
    const etag = first.headers.get('etag');
    assert.ok((await first.text()).includes(`?v=${version(CSS)}`));

    await writeFile(output, replacement);
    const cached = await request('/');
    assert.equal(cached.headers.get('etag'), etag);
    assert.ok((await cached.text()).includes(`?v=${version(CSS)}`));
    assert.equal((await request(`${CSS_ROUTE}?v=${version(CSS)}`)).headers.get('cache-control'), 'no-cache');

    server.invalidateRouteCache('test');
    const refreshed = await request('/', { headers: { 'If-None-Match': etag } });
    assert.equal(refreshed.status, 200);
    assert.notEqual(refreshed.headers.get('etag'), etag);
    assert.ok((await refreshed.text()).includes(`?v=${version(replacement)}`));
  });
});

test('excludes pages by path, by error kind and by a page\'s meta tag', async () => {
  const optedOut = PAGE.replace('</head>', '<meta name="altair-tailwind" content="off"></head>');
  await withServer({
    config: { excludePaths: ['/admin/*'], excludeErrorPages: true },
    pages: { ...PAGES, 'opted-out.html': optedOut }
  }, async ({ request }) => {
    assert.doesNotMatch(await html(request, '/admin/panel'), /build\/tailwind/);
    assert.doesNotMatch(await html(request, '/opted-out'), /build\/tailwind/);
    assert.doesNotMatch(await html(request, '/no-such-page'), /build\/tailwind/);
    assert.match(await html(request, '/about'), /build\/tailwind/);
  });
});

test('links error pages by default', async () => {
  await withServer({}, async ({ request }) => {
    const response = await request('/no-such-page');
    assert.equal(response.status, 404);
    assert.match(await response.text(), /build\/tailwind/);
  });
});

test('rejects invalid settings at startup', async () => {
  await assert.rejects(withServer({ config: { excludeErrorPages: 'yes' } }, async () => {}), /excludeErrorPages must be true or false/);
  await assert.rejects(withServer({ config: { excludePaths: 'admin' } }, async () => {}), /excludePaths must be an array/);
});

test('in production a missing stylesheet stops startup and says how to build it', async () => {
  await assert.rejects(withServer({ files: {} }, async () => {}), /is missing; run pnpm css:build/);
});

test('in production Tailwind never runs', async () => {
  const { calls, spawnProcess } = createFakeCli();
  let looked = false;
  const extension = createTailwind({ spawnProcess, findCli: async () => { looked = true; return '/cli.mjs'; } });
  await withServer({ extension }, async () => {
    assert.equal(calls.length, 0);
    assert.equal(looked, false);
  });
});

test('in development it watches, links without a version, and stops on shutdown', async () => {
  const { child, calls, spawnProcess } = createFakeCli();
  const extension = createTailwind({ spawnProcess, findCli: async () => '/cli.mjs' });
  await withServer({
    extension,
    settings: { nodeEnv: 'development' },
    files: { ...FILES, 'css/_tailwind.css': '@import "tailwindcss";' }
  }, async ({ request, server, activePath }) => {
    const [command, args, options] = calls[0];
    assert.equal(command, process.execPath);
    assert.equal(args[0], '/cli.mjs');
    assert.ok(args.includes('--watch') && args.includes('--minify'));
    assert.equal(args[args.indexOf('--input') + 1], path.join(activePath, 'css', '_tailwind.css'));
    assert.equal(args[args.indexOf('--output') + 1], path.join(activePath, OUTPUT));
    assert.equal(options.stdio[0], 'pipe');
    assert.equal('DEBUG' in options.env, false);

    assert.ok((await html(request, '/')).includes(`href="${CSS_ROUTE}">`));
    assert.equal((await request(CSS_ROUTE)).headers.get('cache-control'), 'no-store');

    await server.shutdown();
    assert.equal(child.killed, true);
  });
});

test('development reports CLI errors and an unexpected exit, but not routine output', async () => {
  const { child, spawnProcess } = createFakeCli();
  const extension = createTailwind({ spawnProcess, findCli: async () => '/cli.mjs' });
  await withServer({
    extension,
    settings: { nodeEnv: 'development' },
    files: { ...FILES, 'css/_tailwind.css': '' }
  }, async ({ warnings }) => {
    child.stderr.emit('data', '≈ tailwindcss v4\n\nDone in 10ms\n');
    assert.equal(warnings.length, 0);
    child.stderr.emit('data', '\u001b[2m┌\u001b[22m\n\u001b[2m│\u001b[22m Error: Cannot apply unknown utility class\n\u001b[2m└\u001b[22m\n');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /tailwind: Error: Cannot apply unknown utility class$/);
    child.emit('exit', 1, null);
    assert.match(warnings[1], /exit code 1/);
  });
});

test('development without the CLI warns and serves the existing stylesheet', async () => {
  await withServer({ settings: { nodeEnv: 'development' } }, async ({ request, warnings }) => {
    assert.match(warnings.join('\n'), /CLI is not installed/);
    assert.equal((await request(CSS_ROUTE)).status, 200);
  });
});

test('development with the CLI but no entry file stops startup', async () => {
  const { spawnProcess } = createFakeCli();
  const extension = createTailwind({ spawnProcess, findCli: async () => '/cli.mjs' });
  await assert.rejects(withServer({ extension, settings: { nodeEnv: 'development' } }, async () => {}), /entry file .* is missing/);
});

test('injectStylesheet handles the shapes a page can take', () => {
  const href = `${CSS_ROUTE}?v=1`;
  const link = `<link rel="stylesheet" href="${href}">\n`;
  assert.equal(injectStylesheet('<head><title>x</title></head>', href), `<head><title>x</title>${link}</head>`);
  assert.equal(injectStylesheet('<p>fragment</p>', href), '<p>fragment</p>');
  assert.equal(injectStylesheet(`<head><link rel="stylesheet" href="${href}"></head>`, href), `<head><link rel="stylesheet" href="${href}"></head>`);
  assert.equal(
    injectStylesheet('<head><!-- <link rel="stylesheet" href="/old.css"> --><link rel=stylesheet href="/a.css"></head>', href),
    `<head><!-- <link rel="stylesheet" href="/old.css"> -->${link}<link rel=stylesheet href="/a.css"></head>`
  );
  assert.equal(
    injectStylesheet('<head></head><body><link rel="stylesheet" href="/late.css"></body>', href),
    `<head>${link}</head><body><link rel="stylesheet" href="/late.css"></body>`
  );
});

test('findCli returns null when the CLI is not installed', async () => {
  await withServer({}, async ({ appRootPath }) => {
    assert.equal(await findCli(appRootPath), null);
  });
});

test('a stylesheet deleted after startup keeps the last known version', async () => {
  await withServer({}, async ({ request, output }) => {
    assert.equal(await readFile(output, 'utf8'), CSS);
    await rm(output);
    assert.ok((await html(request, '/')).includes(`?v=${version(CSS)}`));
    assert.equal((await request(CSS_ROUTE)).status, 404);
  });
});
