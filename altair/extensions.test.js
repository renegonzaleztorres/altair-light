import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { csrf } from 'hono/csrf';

import WebServer from './altair.js';
import { EXTENSION_API_VERSION, defineExtension } from './extensions.js';
import { createExtensionTestServer } from './test/helpers.js';

const PAGE = '<!doctype html><html><head><title>Page</title></head><body>@@VAR_marker</body></html>';

// extension : a valid definition whose setup is supplied by the test
const extension = (name, setup = () => ({}), configKey = name) =>
  defineExtension({ name, apiVersion: EXTENSION_API_VERSION, configKey, setup });

// withServer : run a test body against a prepared server and always clean up
const withServer = async (options, body) => {
  const fixture = await createExtensionTestServer(options);
  try {
    await body(fixture);
  } finally {
    await fixture.cleanup();
  }
};

const waitFor = async (predicate, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

test('defineExtension validates and freezes definitions', () => {
  assert.throws(() => defineExtension({ name: 'Bad Name', apiVersion: 1, configKey: 'x', setup() {} }), /kebab-case/);
  assert.throws(() => defineExtension({ name: 'future', apiVersion: 2, configKey: 'x', setup() {} }), /extension API 2/);
  assert.throws(() => defineExtension({ name: 'no-key', apiVersion: 1, setup() {} }), /configKey/);
  assert.throws(() => defineExtension({ name: 'no-setup', apiVersion: 1, configKey: 'x' }), /setup/);
  assert.throws(() => defineExtension(), /kebab-case/);
  const definition = extension('frozen');
  assert.ok(Object.isFrozen(definition));
});

test('only definitions from defineExtension are accepted', async () => {
  const plain = { name: 'plain', apiVersion: 1, configKey: 'plain', setup: () => ({}) };
  await assert.rejects(
    createExtensionTestServer({ extensions: [plain], config: { plain: {} } }),
    /created with defineExtension/
  );
});

test('an extension is active only when its config block is present', async () => {
  const calls = [];
  const configured = extension('configured', ({ config }) => { calls.push(['configured', config]); });
  const unconfigured = extension('unconfigured', () => { calls.push(['unconfigured']); });
  await withServer({ extensions: [configured, unconfigured], config: { configured: {} } }, async ({ server }) => {
    assert.deepEqual(calls, [['configured', {}]]);
    assert.deepEqual(server.extensionRunner.status, [
      { name: 'configured', active: true, env: [] },
      { name: 'unconfigured', active: false, reason: 'no extensions.unconfigured config' }
    ]);
  });

  await withServer({ extensions: [unconfigured] }, async ({ server }) => {
    assert.equal(server.extensionRunner.status[0].active, false);
  });
});

test('extension config blocks and the extensions setting must be objects', async () => {
  await assert.rejects(
    createExtensionTestServer({ extensions: [extension('flag')], config: { flag: true } }),
    /extensions\.flag must be an object/
  );
  await assert.rejects(
    createExtensionTestServer({ extensions: [extension('flag')], config: ['flag'] }),
    /extensions configuration must be an object/
  );
});

test('async setup is awaited in list order before routes are mounted', async () => {
  const order = [];
  const slow = extension('slow', async ({ addRoute }) => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    order.push('slow');
    addRoute('GET', '/slow', (context) => context.text('slow route'));
  });
  const fast = extension('fast', () => { order.push('fast'); });
  class App extends WebServer {
    onSettingsReady() { order.push('app'); }
  }
  await withServer({ extensions: [slow, fast], config: { slow: {}, fast: {} }, App }, async ({ request }) => {
    assert.deepEqual(order, ['slow', 'fast', 'app']);
    assert.equal(await (await request('/slow')).text(), 'slow route');
  });
});

test('addRoute, addMiddleware and env are only available during setup', async () => {
  let api;
  const late = extension('late', (setupApi) => { api = setupApi; });
  await withServer({ extensions: [late], config: { late: {} } }, async () => {
    assert.throws(() => api.addRoute('GET', '/late', () => {}), /only available during setup/);
    assert.throws(() => api.addMiddleware(() => {}), /only available during setup/);
    assert.throws(() => api.env('LATE'), /only available during setup/);
    assert.equal(typeof api.site.listPages, 'function');
  });
});

test('startup rejects unknown hooks, duplicate names, colliding routes and Altair-owned routes', async () => {
  const typo = extension('typo', () => ({ vars: () => ({}), transformHtml: (input) => input.content }));
  await assert.rejects(
    createExtensionTestServer({ extensions: [typo], config: { typo: {} } }),
    /returned unknown hook transformHtml/
  );

  const first = extension('twin');
  const second = extension('twin', () => ({}), 'twinAgain');
  await assert.rejects(
    createExtensionTestServer({ extensions: [first, second], config: { twin: {}, twinAgain: {} } }),
    /twin is listed twice/
  );

  const routeA = extension('route-a', ({ addRoute }) => { addRoute('get', '/shared', (context) => context.text('a')); });
  const routeB = extension('route-b', ({ addRoute }) => { addRoute('GET', '/shared', (context) => context.text('b')); });
  await assert.rejects(
    createExtensionTestServer({ extensions: [routeA, routeB], config: { 'route-a': {}, 'route-b': {} } }),
    /route-a and route-b both register GET \/shared/
  );

  for (const reserved of ['/', '*', '/*']) {
    const claimer = extension('claimer', ({ addRoute }) => { addRoute('GET', reserved, (context) => context.text('x')); });
    await assert.rejects(
      createExtensionTestServer({ extensions: [claimer], config: { claimer: {} } }),
      /route belongs to Altair/
    );
  }
});

test('transforms run in list order, before the application\'s applyGlobalReplacements', async () => {
  const append = (label) => extension(label, () => ({
    transformHTML: ({ content }) => content.replace('</body>', `[${label}]</body>`),
    transformCSS: ({ content }) => `${content}/*${label}*/`,
    transformJS: async ({ content }) => `${content}//${label}`
  }));
  class App extends WebServer {
    // Deliberately no super call: the app hook cannot switch extensions off
    async applyGlobalReplacements({ content }) {
      return content.replace('[first][second]', '[first][second][app]');
    }
  }
  await withServer({
    extensions: [append('first'), append('second')],
    config: { first: {}, second: {} },
    files: { 'css/site.css': 'body{}', 'js/site.js': 'void 0;' },
    App
  }, async ({ request }) => {
    assert.match(await (await request('/')).text(), /\[first\]\[second\]\[app\]<\/body>/);
    assert.equal(await (await request('/css/site.css')).text(), 'body{}/*first*//*second*/');
    assert.equal(await (await request('/js/site.js')).text(), 'void 0;//first//second');
  });
});

test('transformHTML receives page and error-page details', async () => {
  const seen = [];
  const recorder = extension('recorder', () => ({
    transformHTML: ({ content, path: routeKey, routePath, kind }) => {
      seen.push({ path: routeKey, routePath, kind });
      return content;
    }
  }));
  await withServer({
    extensions: [recorder],
    config: { recorder: {} },
    pages: { 'home.html': PAGE, 'blog/post.html': PAGE, '_404.html': PAGE }
  }, async ({ request }) => {
    await request('/');
    await request('/blog/post');
    assert.equal((await request('/missing', { headers: { Accept: 'text/html' } })).status, 404);
    assert.deepEqual(seen, [
      { path: '/', routePath: 'home', kind: 'page' },
      { path: '/blog/post', routePath: '/blog/post', kind: 'page' },
      { path: '/_404', routePath: '_404', kind: 'error' }
    ]);
  });
});

test('template variables: core, then extensions, then the app, then DATA', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const early = extension('early', () => ({ vars: () => ({ Marker: 'early', clash: 'early', year: 'extension-year' }) }));
  const late = extension('late', () => ({ vars: () => ({ clash: 'late', app: 'late', data: 'late' }) }));
  class App extends WebServer {
    additionalVarDefinitions() { return { app: 'app' }; }
  }
  await withServer({
    extensions: [early, late],
    config: { early: {}, late: {} },
    pages: { 'home.html': '@@VAR_marker|@@VAR_clash|@@VAR_year|@@VAR_app|@@VAR_data' },
    data: { data: 'data' },
    App
  }, async ({ request }) => {
    assert.equal(await (await request('/')).text(), 'early|late|extension-year|app|data');
    await request('/');
    assert.equal(warn.mock.callCount(), 1);
    assert.match(warn.mock.calls[0].arguments[0], /late and early both define @@VAR_clash; late wins/);
  });
});

test('transformed pages are route-cached and middleware still runs on cached responses', async () => {
  let transforms = 0;
  const counted = extension('counted', ({ addMiddleware }) => {
    addMiddleware(async (context, next) => {
      await next();
      context.res.headers.set('X-Extension', 'on');
    });
    return { transformHTML: ({ content }) => { transforms += 1; return content; } };
  });
  await withServer({
    extensions: [counted],
    config: { counted: {} },
    settings: { enableRouteCache: true, routeCacheDebug: false }
  }, async ({ request }) => {
    const first = await request('/');
    const second = await request('/');
    assert.equal(first.headers.get('x-extension'), 'on');
    assert.equal(second.headers.get('x-extension'), 'on');
    assert.equal(transforms, 1);
  });
});

test('route-level middleware runs before an extension handler', async () => {
  const form = extension('form', ({ addRoute }) => {
    addRoute('POST', '/contact', csrf(), (context) => context.text('received'));
  });
  await withServer({ extensions: [form], config: { form: {} } }, async ({ request }) => {
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const sameSite = await request('/contact', { method: 'POST', headers: { ...headers, Origin: 'http://altair.test' }, body: 'a=1' });
    assert.equal(sameSite.status, 200);
    const crossSite = await request('/contact', { method: 'POST', headers: { ...headers, Origin: 'https://other.example' }, body: 'a=1' });
    assert.equal(crossSite.status, 403);
  });
});

test('a failing transform returns Altair\'s safe 500 response', async (t) => {
  t.mock.method(console, 'error', () => {});
  const broken = extension('broken', () => ({ transformHTML: () => 42 }));
  await withServer({ extensions: [broken], config: { broken: {} } }, async ({ request }) => {
    const response = await request('/');
    assert.equal(response.status, 500);
    assert.match(await response.text(), /Reference: [0-9a-f-]{36}/);
  });
});

test('a setup failure rejects start() and shuts down the extensions already set up', async () => {
  const events = [];
  const ready = extension('ready', () => ({ shutdown: () => { events.push('ready shutdown'); } }));
  const failing = extension('failing', async () => { throw new Error('cannot reach service'); });
  const { server, cleanup } = await createExtensionTestServer();
  try {
    class App extends WebServer {
      static extensions = [ready, failing];
    }
    const app = new App({ settings: { ...server.settings, extensions: { ready: {}, failing: {} } } });
    await assert.rejects(app.start(), /Extension failing failed to set up: cannot reach service/);
    assert.deepEqual(events, ['ready shutdown']);
  } finally {
    await cleanup();
  }
});

test('contentChanged follows each route-cache invalidation source', async () => {
  const reasons = [];
  const watcher = extension('watcher', () => ({ contentChanged: ({ reason }) => { reasons.push(reason); } }));
  await withServer({
    extensions: [watcher],
    config: { watcher: {} },
    data: { version: 1 },
    settings: { enableRouteCache: true, routeCacheDebug: false, routeCacheQuietMs: 25, routeCacheMaxBatchMs: 200 }
  }, async ({ server, activePath }) => {
    await writeFile(path.join(activePath, 'data', 'DATA.json'), JSON.stringify({ version: 2 }));
    server.dataReloadDebounce = 0;
    server.scheduleDataReload();
    await waitFor(() => reasons.includes('data-change'));

    assert.equal(await server.reloadActiveSpace({ reason: 'manual' }), true);
    assert.ok(reasons.includes('active-space-reload-manual'));

    await server.startChangeObservation();
    await writeFile(path.join(activePath, 'pages', 'added.html'), PAGE);
    await waitFor(() => reasons.some((reason) => reason.startsWith('kinetic-') || reason === 'active-space-root-change'));
  });
});

test('shutdown runs in reverse order and continues past a failing extension', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  const events = [];
  const closing = (name, fail = false) => extension(name, () => ({
    shutdown: async () => {
      events.push(name);
      if (fail) throw new Error('flush failed');
    }
  }));
  const fixture = await createExtensionTestServer({
    extensions: [closing('first'), closing('second', true), closing('third')],
    config: { first: {}, second: {}, third: {} }
  });
  await fixture.cleanup();
  assert.deepEqual(events, ['third', 'second', 'first']);
  assert.match(error.mock.calls[0].arguments[0], /second shutdown failed: flush failed/);
});

test('site gives read-only access to public pages and DATA', async () => {
  let site;
  const reader = extension('reader', ({ site: siteApi }) => { site = siteApi; });
  await withServer({
    extensions: [reader],
    config: { reader: {} },
    pages: {
      'home.html': PAGE,
      'about.html': PAGE,
      'blog/first-post.html': PAGE,
      '_404.html': PAGE,
      '_drafts/secret.html': PAGE,
      'blog/_partial.html': PAGE
    },
    data: { site: { title: 'Example' } }
  }, async ({ server }) => {
    assert.deepEqual(await site.listPages(), ['/', '/about', '/blog/first-post']);
    const data = site.data();
    assert.equal(data.site.title, 'Example');
    assert.throws(() => { data.site.title = 'Changed'; }, TypeError);
    assert.equal(server.getDataCache().site.title, 'Example');
    assert.equal(site.data(), data);
  });
});

test('env reads secrets during setup without adding them to settings', async () => {
  let secret;
  let optional;
  const mailer = extension('mailer', ({ env }) => {
    secret = env('MAILER_API_KEY');
    optional = env('MAILER_REPLY_TO', { required: false });
  });
  await withServer({
    extensions: [mailer],
    config: { mailer: {} },
    env: { MAILER_API_KEY: 'test-secret-value' }
  }, async ({ server }) => {
    assert.equal(secret, 'test-secret-value');
    assert.equal(optional, undefined);
    assert.doesNotMatch(JSON.stringify(server.settings), /test-secret-value/);
    assert.deepEqual(server.extensionRunner.status[0].env, ['MAILER_API_KEY']);
  });

  await assert.rejects(
    createExtensionTestServer({ extensions: [mailer], config: { mailer: {} }, env: {} }),
    /environment variable MAILER_API_KEY is required/
  );
  const lowercase = extension('lowercase', ({ env }) => { env('mailer_key'); });
  await assert.rejects(
    createExtensionTestServer({ extensions: [lowercase], config: { lowercase: {} } }),
    /invalid environment variable name mailer_key/
  );
});

test('api.settings is the application settings object and api.config is frozen', async () => {
  let api;
  const inspector = extension('inspector', (setupApi) => { api = setupApi; });
  await withServer({ extensions: [inspector], config: { inspector: { option: 'value' } } }, async ({ server }) => {
    assert.equal(api.settings, server.settings);
    assert.deepEqual(api.config, { option: 'value' });
    assert.ok(Object.isFrozen(api.config));
    assert.ok(Object.isFrozen(api));
    assert.equal(api.name, 'inspector');
  });
});
