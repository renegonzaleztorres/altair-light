import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createExtensionTestServer } from '../../altair/test/helpers.js';
import { createRobotsTxt, createSitemapXml, resolveSitemap, sitemap } from './sitemap.js';

const PAGE = '<!doctype html><html><head><title>Page</title></head><body>Content</body></html>';
const PAGES = {
  'home.html': PAGE,
  'about.html': PAGE,
  'blog/post-1.html': PAGE,
  'blog/_draft.html': PAGE,
  'admin/panel.html': PAGE,
  '_404.html': PAGE
};

// withServer : run a test body against a prepared server and always clean up
const withServer = async ({ config, pages = PAGES, files }, body) => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  let fixture;
  try {
    fixture = await createExtensionTestServer({
      extensions: [sitemap],
      config: config === undefined ? undefined : { sitemap: config },
      pages,
      files
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

const locations = (xml) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);

test('serves every public page in /sitemap.xml with an hour of caching', async () => {
  await withServer({ config: { baseUrl: 'https://example.com' } }, async ({ request }) => {
    const response = await request('/sitemap.xml');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/xml; charset=UTF-8');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=3600');
    const xml = await response.text();
    assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
    assert.deepEqual(locations(xml), [
      'https://example.com/',
      'https://example.com/about',
      'https://example.com/admin/panel',
      'https://example.com/blog/post-1'
    ]);
  });
});

test('exclude patterns leave pages out', async () => {
  await withServer({ config: { baseUrl: 'https://example.com', exclude: ['/admin/*', '/About'] } }, async ({ request }) => {
    assert.deepEqual(locations(await (await request('/sitemap.xml')).text()), ['https://example.com/', 'https://example.com/blog/post-1']);
  });
});

test('a page added while the server runs appears on the next request', async () => {
  await withServer({ config: { baseUrl: 'https://example.com' } }, async ({ request, activePath }) => {
    assert.equal(locations(await (await request('/sitemap.xml')).text()).length, 4);
    await writeFile(path.join(activePath, 'pages', 'new.html'), PAGE);
    assert.ok(locations(await (await request('/sitemap.xml')).text()).includes('https://example.com/new'));
  });
});

test('robots.txt is served only when configured, pointing to the sitemap', async () => {
  await withServer({ config: { baseUrl: 'https://example.com' } }, async ({ request }) => {
    assert.equal((await request('/robots.txt')).status, 404);
  });
  await withServer({ config: { baseUrl: 'https://example.com', robots: {} } }, async ({ request }) => {
    const response = await request('/robots.txt');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=3600');
    assert.equal(await response.text(), 'User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml\n');
  });
});

test('robots rules: disallow paths, or block everything for staging', () => {
  assert.equal(createRobotsTxt('https://example.com', { disallowAll: false, disallow: ['/admin/', '/preview/'] }),
    'User-agent: *\nDisallow: /admin/\nDisallow: /preview/\n\nSitemap: https://example.com/sitemap.xml\n');
  assert.equal(createRobotsTxt('https://staging.example.com', { disallowAll: true, disallow: ['/admin/'] }),
    'User-agent: *\nDisallow: /\n\nSitemap: https://staging.example.com/sitemap.xml\n');
});

test('does nothing without a config block or without a baseUrl', async () => {
  for (const config of [undefined, {}, { exclude: ['/admin/*'], robots: {} }]) {
    await withServer({ config }, async ({ request }) => {
      assert.equal((await request('/sitemap.xml')).status, 404);
      assert.equal((await request('/robots.txt')).status, 404);
    });
  }
});

test('invalid settings stop startup with the setting named', () => {
  assert.throws(() => resolveSitemap({ baseUrl: 'example.com' }), /extensions.sitemap.baseUrl must be the site's origin/);
  assert.throws(() => resolveSitemap({ baseUrl: 'https://example.com/blog' }), /extensions.sitemap.baseUrl/);
  assert.throws(() => resolveSitemap({ baseUrl: 'https://example.com', exclude: ['admin'] }), /extensions.sitemap.exclude: invalid pattern "admin"/);
  assert.throws(() => resolveSitemap({ baseUrl: 'https://example.com', robots: true }), /extensions.sitemap.robots must be an object/);
  assert.throws(() => resolveSitemap({ baseUrl: 'https://example.com', robots: { disallow: ['admin'] } }), /robots.disallow/);
  assert.throws(() => resolveSitemap({ baseUrl: 'https://example.com', robots: { disallowAll: 'yes' } }), /robots.disallowAll/);
  assert.equal(resolveSitemap({ baseUrl: 'https://example.com/' }).baseUrl, 'https://example.com');
});

test('page URLs are encoded and XML-escaped', () => {
  assert.equal(locations(createSitemapXml('https://example.com', ['/a b', '/r&d'])).join(' '), 'https://example.com/a%20b https://example.com/r&amp;d');
  assert.equal(createSitemapXml('https://example.com', []), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n');
});

test('warns when a static file of the same name would be served instead', async () => {
  await withServer({
    config: { baseUrl: 'https://example.com', robots: {} },
    files: { 'public/robots.txt': 'User-agent: *\n' }
  }, async ({ request, warnings }) => {
    assert.ok(warnings.some((line) => line.includes('public/robots.txt exists')), warnings.join('\n'));
    assert.equal(await (await request('/robots.txt')).text(), 'User-agent: *\n');
  });
});
