import assert from 'node:assert/strict';
import test from 'node:test';

import { createExtensionTestServer } from '../../altair/test/helpers.js';
import { redirects, resolveRedirects } from './redirects.js';

const PAGE = '<!doctype html><html><head><title>Page</title></head><body>Content</body></html>';

// withServer : run a test body against a prepared server and always clean up
const withServer = async ({ config, pages = { 'home.html': PAGE, 'new-page.html': PAGE } }, body) => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  let fixture;
  try {
    fixture = await createExtensionTestServer({
      extensions: [redirects],
      config: config === undefined ? undefined : { redirects: config },
      pages
    });
  } finally {
    console.warn = originalWarn;
  }
  try {
    await body({ ...fixture, warnings });
  } finally {
    await fixture.cleanup();
  }
};

const redirectOf = async (request, pathname) => {
  const response = await request(pathname);
  return [response.status, response.headers.get('location')];
};

test('exact rules redirect permanently and keep the query string', async () => {
  await withServer({ config: { rules: { '/old-page': '/new-page', '/promo': 'https://shop.example.org/sale?src=site' } } }, async ({ request }) => {
    assert.deepEqual(await redirectOf(request, '/old-page'), [301, '/new-page']);
    assert.deepEqual(await redirectOf(request, '/old-page?ref=mail'), [301, '/new-page?ref=mail']);
    assert.deepEqual(await redirectOf(request, '/promo?x=1'), [301, 'https://shop.example.org/sale?src=site']);
    assert.equal((await request('/new-page')).status, 200);
  });
});

test('prefix rules move a whole section and keep the rest of the path', async () => {
  await withServer({ config: { rules: { '/old-blog/*': '/blog/*', '/legacy/*': '/' } } }, async ({ request }) => {
    assert.deepEqual(await redirectOf(request, '/old-blog/2024/post'), [301, '/blog/2024/post']);
    assert.deepEqual(await redirectOf(request, '/old-blog'), [301, '/blog']);
    assert.deepEqual(await redirectOf(request, '/legacy/anything/here'), [301, '/']);
    assert.equal((await request('/old-blogger')).status, 404);
  });
});

test('the most specific rule wins, whatever the order in config', async () => {
  const rules = { '/old-blog/*': '/blog/*', '/old-blog/archive/*': '/archive/*', '/old-blog/special': '/promo', '/old-blog': '/news' };
  await withServer({ config: { rules } }, async ({ request }) => {
    assert.deepEqual(await redirectOf(request, '/old-blog/special'), [301, '/promo']);
    assert.deepEqual(await redirectOf(request, '/old-blog/archive/2020'), [301, '/archive/2020']);
    assert.deepEqual(await redirectOf(request, '/old-blog/other'), [301, '/blog/other']);
    assert.deepEqual(await redirectOf(request, '/old-blog'), [301, '/news']);
  });
});

test('status can be set to 302, 307 or 308', async () => {
  await withServer({ config: { rules: { '/old-page': '/new-page' }, status: 308 } }, async ({ request }) => {
    assert.deepEqual(await redirectOf(request, '/old-page'), [308, '/new-page']);
  });
});

test('does nothing without a config block or without rules', async () => {
  for (const config of [undefined, {}, { status: 302 }]) {
    await withServer({ config }, async ({ request }) => {
      assert.equal((await request('/old-page')).status, 404);
    });
  }
});

test('warns when a rule hides an existing page', async () => {
  await withServer({ config: { rules: { '/new-page': '/' } } }, async ({ warnings }) => {
    assert.ok(warnings.some((line) => line.includes('"/new-page" is also a page')), warnings.join('\n'));
  });
});

test('invalid rules and redirect chains stop startup', () => {
  assert.throws(() => resolveRedirects({ rules: [] }), /rules must be an object/);
  assert.throws(() => resolveRedirects({ rules: { 'old': '/new' } }), /invalid source "old"/);
  assert.throws(() => resolveRedirects({ rules: { '/': '/home-new' } }), /invalid source "\/"/);
  assert.throws(() => resolveRedirects({ rules: { '/a?x=1': '/b' } }), /invalid source/);
  assert.throws(() => resolveRedirects({ rules: { '/a': 'ftp://example.com' } }), /target must be a path/);
  assert.throws(() => resolveRedirects({ rules: { '/a': '//evil.example.com' } }), /target must be a path/);
  assert.throws(() => resolveRedirects({ rules: { '/a': '/b/*' } }), /only a \/\* source/);
  assert.throws(() => resolveRedirects({ rules: { '/a': '/b' }, status: 303 }), /status must be 301, 302, 307 or 308/);
  assert.throws(() => resolveRedirects({ rules: { '/a': '/b', '/b': '/c' } }), /"\/a" → "\/b" is redirected again by "\/b"/);
  assert.throws(() => resolveRedirects({ rules: { '/a': '/a' } }), /redirected again/);
  assert.throws(() => resolveRedirects({ rules: { '/a': '/old/x', '/old/*': '/new/*' } }), /redirected again by "\/old\/\*"/);
});
