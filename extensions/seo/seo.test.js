import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createExtensionTestServer } from '../../altair/test/helpers.js';
import { resolveSeo, seo, setHeadTags } from './seo.js';

// The starter template's head: an empty canonical link and a fixed description
const STARTER = `<!doctype html><html><head>
<title>Home &amp; Garden</title>
<meta name="description" content="Altair-Light">
<link rel="canonical" href="">
</head><body>Content</body></html>`;
const BARE = '<!doctype html><html><head><title>About us</title></head><body>About</body></html>';

// withServer : run a test body against a prepared server and always clean up
const withServer = async ({ config, pages = { 'home.html': STARTER, 'about.html': BARE }, data = {}, settings }, body) => {
  const fixture = await createExtensionTestServer({
    extensions: [seo],
    config: config === undefined ? undefined : { seo: config },
    pages,
    data,
    settings
  });
  try {
    await body(fixture);
  } finally {
    await fixture.cleanup();
  }
};

const html = async (request, pathname) => (await request(pathname, { headers: { Accept: 'text/html' } })).text();
const count = (text, pattern) => text.split(pattern).length - 1;

test('sets the canonical link and replaces the template tags without duplicating them', async () => {
  await withServer({ config: { baseUrl: 'https://example.com', description: 'Site description' } }, async ({ request }) => {
    const home = await html(request, '/');
    assert.equal(count(home, 'rel="canonical"'), 1);
    assert.match(home, /<link rel="canonical" href="https:\/\/example.com\/">/);
    assert.equal(count(home, 'name="description"'), 1);
    assert.match(home, /<meta name="description" content="Site description">/);
    assert.match(home, /<meta property="og:title" content="Home &amp; Garden">/);
    assert.match(home, /<meta property="og:url" content="https:\/\/example.com\/">/);
    assert.ok(home.indexOf('og:url') < home.indexOf('</head>'));
  });
});

test('per-page values come from the seo object in DATA.json, keyed by path', async () => {
  const data = {
    seo: {
      '/about': {
        title: 'About "Us"',
        description: 'Who we are <and why>',
        image: '/media/about.jpg',
        type: 'article'
      }
    }
  };
  await withServer({ config: { baseUrl: 'https://example.com', description: 'Fallback', image: 'https://cdn.example.com/site.jpg', siteName: 'Example', twitterCard: 'summary_large_image' }, data }, async ({ request }) => {
    const about = await html(request, '/about');
    assert.match(about, /<meta name="description" content="Who we are &lt;and why&gt;">/);
    assert.match(about, /<meta property="og:title" content="About &quot;Us&quot;">/);
    assert.match(about, /<meta property="og:image" content="https:\/\/example.com\/media\/about.jpg">/);
    assert.match(about, /<meta property="og:type" content="article">/);
    assert.match(about, /<meta property="og:site_name" content="Example">/);
    assert.match(about, /<meta name="twitter:card" content="summary_large_image">/);
    assert.match(about, /<link rel="canonical" href="https:\/\/example.com\/about">/);

    const home = await html(request, '/');
    assert.match(home, /<meta name="description" content="Fallback">/);
    assert.match(home, /<meta property="og:image" content="https:\/\/cdn.example.com\/site.jpg">/);
    assert.doesNotMatch(home, /og:type/);
  });
});

test('a page can point its canonical link elsewhere', async () => {
  const data = { seo: { '/about': { canonical: 'https://partner.example.org/about' } } };
  await withServer({ config: { baseUrl: 'https://example.com' }, data }, async ({ request }) => {
    const about = await html(request, '/about');
    assert.match(about, /<link rel="canonical" href="https:\/\/partner.example.org\/about">/);
    assert.match(about, /<meta property="og:url" content="https:\/\/partner.example.org\/about">/);
  });
});

test('tags without a value are left as the template wrote them', async () => {
  await withServer({ config: { baseUrl: 'https://example.com' } }, async ({ request }) => {
    const home = await html(request, '/');
    assert.match(home, /<meta name="description" content="Altair-Light">/);
    assert.doesNotMatch(home, /og:description|og:image|og:site_name|twitter:card/);
  });
});

test('error pages are left alone', async () => {
  await withServer({ config: { baseUrl: 'https://example.com' }, pages: { 'home.html': STARTER, '_404.html': STARTER } }, async ({ request }) => {
    const missing = await request('/missing', { headers: { Accept: 'text/html' } });
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /<link rel="canonical" href="">/);
  });
});

test('does nothing without a config block or without a baseUrl', async () => {
  for (const config of [undefined, {}, { description: 'x' }]) {
    await withServer({ config }, async ({ request }) => {
      assert.equal(await html(request, '/'), STARTER);
    });
  }
});

test('updated DATA values appear after a reload, with the route cache on', async () => {
  await withServer({ config: { baseUrl: 'https://example.com' }, data: { seo: { '/about': { description: 'First' } } }, settings: { enableRouteCache: true } }, async ({ request, server, activePath }) => {
    assert.match(await html(request, '/about'), /content="First"/);
    assert.match(await html(request, '/about'), /content="First"/); // served from the route cache
    await writeFile(path.join(activePath, 'data', 'DATA.json'), JSON.stringify({ seo: { '/about': { description: 'Second' } } }));
    assert.equal(await server.reloadActiveSpace({ reason: 'test' }), true);
    assert.match(await html(request, '/about'), /content="Second"/);
  });
});

test('existing tags are matched in any attribute order and quoting', () => {
  const tags = new Map([
    ['canonical', '<link rel="canonical" href="https://example.com/">'],
    ['og:title', '<meta property="og:title" content="New">']
  ]);
  const input = "<html><head><meta content='Old' property=og:title><link href=x rel='canonical'><META PROPERTY=\"og:title\" CONTENT=\"Dup\"></head></html>";
  assert.equal(setHeadTags(input, tags), '<html><head><meta property="og:title" content="New"><link rel="canonical" href="https://example.com/"></head></html>');
  assert.equal(setHeadTags('<p>no head</p>', tags), '<p>no head</p>');
});

test('invalid settings stop startup with the setting named', () => {
  assert.throws(() => resolveSeo({ baseUrl: 'https://example.com/path' }), /extensions.seo.baseUrl/);
  assert.throws(() => resolveSeo({ baseUrl: 'https://example.com', twitterCard: 'large' }), /extensions.seo.twitterCard/);
  assert.throws(() => resolveSeo({ baseUrl: 'https://example.com', description: '' }), /extensions.seo.description must be a non-empty string/);
  assert.throws(() => resolveSeo({ baseUrl: 'https://example.com', image: 42 }), /extensions.seo.image/);
});
