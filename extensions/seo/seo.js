// @ts-check
/**
 * SEO extension
 *
 * Sets the canonical link, description and Open Graph tags in the <head> of
 * rendered pages. Active only when the application lists it and
 * settings.extensions.seo holds a baseUrl. Per-page values come from the "seo"
 * object in DATA.json, keyed by route path; config supplies site-wide
 * fallbacks. A tag whose value is missing is left as the template wrote it.
 * Existing tags are replaced, never duplicated. Error pages are left alone.
 */

import { defineExtension } from '../../altair/extensions.js';
import { optionalString, resolveBaseUrl } from '../_shared/config.js';

const TWITTER_CARDS = new Set(['summary', 'summary_large_image']);

/**
 * escapeAttribute : escape text for a double-quoted HTML attribute
 * @param {string} value
 */
export const escapeAttribute = (value) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/**
 * attribute : one attribute value from an HTML tag, quoted or not
 * @param {string} tag
 * @param {string} name
 */
const attribute = (tag, name) => {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? match.slice(1).find((value) => value !== undefined) : undefined;
};

/**
 * tagKey : which head tag this is ("canonical", "description", "og:title", ...) or null
 * @param {string} tag
 */
const tagKey = (tag) => {
  if (/^<link\b/i.test(tag)) return (attribute(tag, 'rel') ?? '').toLowerCase().split(/\s+/).includes('canonical') ? 'canonical' : null;
  const key = attribute(tag, 'property') ?? attribute(tag, 'name');
  return key ? key.toLowerCase() : null;
};

/**
 * resolveSeo : validate the config block; return the active settings or { inactive: reason }
 * @param {Readonly<Record<string, any>>} config
 */
export const resolveSeo = (config) => {

  if (config.baseUrl === undefined) return { inactive: 'no baseUrl configured' };
  const baseUrl = resolveBaseUrl(config.baseUrl, 'extensions.seo.baseUrl');
  if (config.twitterCard !== undefined && !TWITTER_CARDS.has(config.twitterCard)) {
    throw new Error('extensions.seo.twitterCard must be "summary" or "summary_large_image"');
  }
  return {
    baseUrl,
    siteName: optionalString(config.siteName, 'extensions.seo.siteName'),
    description: optionalString(config.description, 'extensions.seo.description'),
    image: optionalString(config.image, 'extensions.seo.image'),
    type: optionalString(config.type, 'extensions.seo.type'),
    twitterCard: config.twitterCard
  };

} // resolveSeo

/**
 * pageValues : the head tag values for one page; tags without a value are omitted
 * @param {{ baseUrl: string, siteName?: string, description?: string, image?: string, type?: string, twitterCard?: string }} options
 * @param {{ path: string, html: string, entry: unknown }} page
 * @returns {Map<string, string>} tag key → complete tag
 */
export const pageValues = (options, { path, html, entry }) => {

  const own = entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? /** @type {Record<string, unknown>} */ (entry) : {};
  const text = (/** @type {string} */ key) => (typeof own[key] === 'string' && own[key] !== '' ? /** @type {string} */ (own[key]) : undefined);
  const absolute = (/** @type {string | undefined} */ value) => (value === undefined ? undefined : new URL(value, options.baseUrl).href);

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const pageTitle = titleMatch ? titleMatch[1].trim() : '';
  const canonical = absolute(text('canonical') ?? path);
  const description = text('description') ?? options.description;
  const values = /** @type {Array<[string, string | undefined]>} */ ([
    ['description', description],
    ['og:title', text('title') ?? (pageTitle || undefined)],
    ['og:description', description],
    ['og:url', canonical],
    ['og:image', absolute(text('image') ?? options.image)],
    ['og:type', text('type') ?? options.type],
    ['og:site_name', options.siteName],
    ['twitter:card', options.twitterCard]
  ]);

  const tags = new Map([['canonical', `<link rel="canonical" href="${escapeAttribute(/** @type {string} */ (canonical))}">`]]);
  for (const [key, value] of values) {
    if (value === undefined) continue;
    // og:title may come from the page's own <title>, which is already HTML text: decode nothing, escape quotes only
    const content = key === 'og:title' && text('title') === undefined ? value.replace(/"/g, '&quot;') : escapeAttribute(value);
    const attributeName = key.startsWith('og:') ? 'property' : 'name';
    tags.set(key, `<meta ${attributeName}="${key}" content="${content}">`);
  }
  return tags;

} // pageValues

/**
 * setHeadTags : replace each existing tag with the same key, remove duplicates,
 * and insert missing tags before </head>; pages without </head> are unchanged
 * @param {string} html
 * @param {Map<string, string>} tags
 */
export const setHeadTags = (html, tags) => {

  const headEnd = html.search(/<\/head\s*>/i);
  if (headEnd === -1) return html;
  const headStart = Math.max(0, html.search(/<head\b[^>]*>/i));
  const placed = new Set();
  const head = html.slice(headStart, headEnd).replace(/<(?:link|meta)\b[^>]*>/gi, (tag) => {
    const key = tagKey(tag);
    if (key === null || !tags.has(key)) return tag;
    if (placed.has(key)) return '';
    placed.add(key);
    return /** @type {string} */ (tags.get(key));
  });
  // New tags take the indentation of the head's first indented line
  const indent = head.match(/\n([ \t]+)</)?.[1] ?? '';
  const missing = [...tags].filter(([key]) => !placed.has(key)).map(([, tag]) => `${indent}${tag}\n`);
  return `${html.slice(0, headStart)}${head}${missing.join('')}${html.slice(headEnd)}`;

} // setHeadTags

export const seo = defineExtension({
  name: 'seo',
  apiVersion: 1,
  configKey: 'seo',
  setup({ config, site, log }) {

    const resolved = resolveSeo(config);
    if ('inactive' in resolved) {
      log(`inactive (${resolved.inactive})`);
      return {};
    }
    log(`active (${resolved.baseUrl})`);

    return {
      // Route-cached: the output depends only on path, content, config and DATA,
      // and a DATA change clears the route cache
      transformHTML: ({ content, path, kind }) => {
        if (kind === 'error') return content;
        const entries = site.data().seo;
        const entry = entries !== null && typeof entries === 'object' && Object.hasOwn(entries, path) ? entries[path] : undefined;
        return setHeadTags(content, pageValues(resolved, { path, html: content, entry }));
      }
    };

  } // setup
});
