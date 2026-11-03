import assert from 'node:assert/strict';
import test from 'node:test';

import { createTestSettings } from '../altair/test/helpers.js';
import WebApp from '../web-app/web-app.js';

// Application tests live in tests/ and run with `pnpm test:app` (part of `pnpm test`).
// This smoke test renders the real active space through the real WebApp, in
// process and without a port. It discovers what to check instead of naming
// files, so it works unchanged whatever pages and asset layout a project has:
// every public page, and every local stylesheet and script those pages use.
// Add tests for your own pages and routes in other files under tests/.

const ORIGIN = 'http://altair.test';

// Pages that intentionally do not answer 200 (for example, a page that a
// custom route redirects or protects). Use route paths: '/account'.
const SKIP_PAGES = new Set([]);

// Text that means a template tag failed or was never resolved
const UNRESOLVED = /\bUNDEFINED\b|@@(?:ELEM|REPEAT|DATA|VAR|PARAM)_/;

// createSite : the web app prepared exactly as start() prepares it
const createSite = async (settings = {}) => {
  const app = new WebApp({ settings: createTestSettings({ enableDataWatch: false, debug: false, ...settings }) });
  await app.setupExtensions();
  await app.prepare();
  const request = (pathname) => app.app.request(`${ORIGIN}${pathname}`);
  return { app, request, close: () => app.shutdown() };
};

// renderPages : every public page from pages/, rendered once
const renderPages = async (site) => {
  const pages = (await site.app.listPublicPages()).filter((page) => !SKIP_PAGES.has(page));
  const rendered = [];
  for (const page of pages) {
    const response = await site.request(page);
    rendered.push({ page, status: response.status, html: await response.text() });
  }
  return rendered;
};

// attribute : one attribute value from an HTML tag, quoted or not
const attribute = (tag, name) => {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? match.slice(1).find((value) => value !== undefined) : undefined;
};

// localAssets : stylesheet and script URLs on this site that a page references;
// external URLs (CDNs, analytics) and commented-out tags are skipped
const localAssets = (html, page) => {
  const markup = html.replace(/<!--[\s\S]*?-->/g, '');
  const references = [];
  for (const [tag] of markup.matchAll(/<link\b[^>]*>/gi)) {
    if (/\bstylesheet\b/i.test(attribute(tag, 'rel') ?? '')) references.push(attribute(tag, 'href'));
  }
  for (const [tag] of markup.matchAll(/<script\b[^>]*>/gi)) references.push(attribute(tag, 'src'));

  const assets = [];
  for (const reference of references) {
    if (!reference) continue;
    try {
      const url = new URL(reference, `${ORIGIN}${page}`);
      if (url.origin === ORIGIN) assets.push(`${url.pathname}${url.search}`);
    } catch {
      assets.push(reference); // an unparseable URL fails below as a missing asset
    }
  }
  return assets;
};

test('every public page renders with every template tag resolved', async (t) => {
  const site = await createSite();
  try {
    const pages = await renderPages(site);
    assert.ok(pages.length > 0, 'no public pages found in pages/');
    for (const { page, status, html } of pages) {
      await t.test(page, () => {
        assert.equal(status, 200);
        assert.match(html, /<html/i);
        assert.doesNotMatch(html, UNRESOLVED);
      });
    }
  } finally {
    await site.close();
  }
});

test('every local stylesheet and script the pages reference is served', async (t) => {
  const site = await createSite();
  try {
    const usedBy = new Map(); // asset URL → first page that references it
    for (const { page, html } of await renderPages(site)) {
      for (const asset of localAssets(html, page)) if (!usedBy.has(asset)) usedBy.set(asset, page);
    }
    for (const [asset, page] of usedBy) {
      await t.test(`${asset} (from ${page})`, async () => {
        const response = await site.request(asset);
        assert.equal(response.status, 200);
        assert.doesNotMatch(await response.text(), UNRESOLVED);
      });
    }
  } finally {
    await site.close();
  }
});

test('an unknown page returns the 404 page', async () => {
  const site = await createSite();
  try {
    const response = await site.request('/no-such-page-altair-smoke-test');
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  } finally {
    await site.close();
  }
});
