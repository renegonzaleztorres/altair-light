import assert from 'node:assert/strict';
import test from 'node:test';

import { createExtensionTestServer } from '../../altair/test/helpers.js';
import { compileRoutePatterns, googleAnalytics } from './google-analytics.js';

const ID = 'G-TEST1234';
const PAGE = '<!doctype html><html><head><title>Page</title></head><body>Content</body></html>';
const OPT_OUT = PAGE.replace('<title>', '<meta name="altair-analytics" content="off"><title>');

const tagCount = (html) => html.split(`gtag/js?id=${ID}`).length - 1;

// withServer : run a test body against a prepared server and always clean up
const withServer = async ({ config, pages = { 'home.html': PAGE }, settings, files }, body) => {
  const fixture = await createExtensionTestServer({
    extensions: [googleAnalytics],
    config: config === undefined ? undefined : { googleAnalytics: config },
    pages,
    settings,
    files
  });
  try {
    await body(fixture);
  } finally {
    await fixture.cleanup();
  }
};

const html = async (request, pathname) =>
  (await request(pathname, { headers: { Accept: 'text/html' } })).text();

test('adds the tag once before </head> on pages and error pages, never to CSS', async () => {
  await withServer({
    config: { measurementId: ID },
    pages: { 'home.html': PAGE, '_404.html': PAGE },
    files: { 'css/site.css': 'body{}' }
  }, async ({ request }) => {
    const home = await html(request, '/');
    assert.equal(tagCount(home), 1);
    assert.ok(home.indexOf(`gtag('config', '${ID}')`) < home.indexOf('</head>'));
    assert.equal(tagCount(await html(request, '/missing')), 1);
    assert.equal(await (await request('/css/site.css')).text(), 'body{}');
  });
});

test('does nothing without a config block or without a measurementId', async () => {
  for (const config of [undefined, {}, { excludePaths: ['/admin/*'] }]) {
    await withServer({ config }, async ({ request }) => {
      assert.equal(tagCount(await html(request, '/')), 0);
    });
  }
});

test('does not double a hand-placed tag or touch pages without </head>', async () => {
  const handPlaced = `<html><head><script async src="https://www.googletagmanager.com/gtag/js?id=${ID}"></script></head></html>`;
  await withServer({
    config: { measurementId: ID },
    pages: { 'home.html': handPlaced, 'fragment.html': '<p>fragment</p>' }
  }, async ({ request }) => {
    assert.equal(tagCount(await html(request, '/')), 1);
    assert.equal(await html(request, '/fragment'), '<p>fragment</p>');
  });
});

test('skips excluded paths, error pages and pages that opt out', async () => {
  await withServer({
    config: { measurementId: ID, excludePaths: ['/admin/*', '/Thank-You/'], excludeErrorPages: true },
    pages: {
      'home.html': PAGE,
      'about.html': PAGE,
      'admin.html': PAGE,
      'admin/users.html': PAGE,
      'administrator.html': PAGE,
      'thank-you.html': PAGE,
      'embed.html': OPT_OUT,
      '_404.html': PAGE
    }
  }, async ({ request }) => {
    const tagged = async (pathname) => tagCount(await html(request, pathname));
    assert.equal(await tagged('/'), 1);
    assert.equal(await tagged('/about'), 1);
    assert.equal(await tagged('/administrator'), 1);
    assert.equal(await tagged('/admin'), 0);
    assert.equal(await tagged('/admin/users'), 0);
    assert.equal(await tagged('/thank-you'), 0);
    assert.equal(await tagged('/embed'), 0);
    assert.equal(await tagged('/missing'), 0);
  });
});

test('invalid settings stop startup with a clear message', async () => {
  for (const [config, message] of [
    [{ measurementId: 'UA-12345-1' }, /measurementId must be a GA4 Measurement ID/],
    [{ measurementId: ID, excludePaths: '/admin' }, /excludePaths must be an array/],
    [{ measurementId: ID, excludePaths: ['admin'] }, /invalid pattern "admin"/],
    [{ measurementId: ID, excludeErrorPages: 'yes' }, /excludeErrorPages must be true or false/]
  ]) {
    await assert.rejects(
      createExtensionTestServer({ extensions: [googleAnalytics], config: { googleAnalytics: config } }),
      message
    );
  }
});

test('route patterns match exact paths and whole sections', () => {
  const [exact, section, everything] = compileRoutePatterns(['/thank-you', '/admin/*', '/*']);
  assert.equal(exact('/thank-you'), true);
  assert.equal(exact('/thank-you/more'), false);
  assert.equal(section('/admin'), true);
  assert.equal(section('/admin/users'), true);
  assert.equal(section('/administrator'), false);
  assert.equal(everything('/anything'), true);
  for (const invalid of ['admin', '/admin*', '/a*b', '', 42]) {
    assert.throws(() => compileRoutePatterns([invalid]), /invalid pattern/);
  }
});

test('warns when route caching is on and GA cookies are not ignored', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  await withServer({ config: { measurementId: ID }, settings: { enableRouteCache: true } }, async () => {});
  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /ROUTE_CACHE_IGNORED_COOKIES="_ga,_ga_\*,_gid"/);

  await withServer({
    config: { measurementId: ID },
    settings: { enableRouteCache: true, routeCacheIgnoredCookies: '_ga,_ga_*,_gid' }
  }, async () => {});
  await withServer({ config: { measurementId: ID } }, async () => {});
  assert.equal(warn.mock.callCount(), 1);
});
