// @ts-check
/**
 * Sitemap extension
 *
 * Serves /sitemap.xml listing the site's public pages, and optionally
 * /robots.txt pointing to it. Active only when the application lists it and
 * settings.extensions.sitemap holds a baseUrl. Both responses are built on each
 * request from the pages folder, so a page added while the server runs appears
 * without a restart or file watching, and nothing is kept in memory.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { defineExtension } from '../../altair/extensions.js';
import { compileRoutePatterns, resolveBaseUrl } from '../_shared/config.js';

const CACHE_CONTROL = 'public, max-age=3600';

/**
 * escapeXml : escape text for an XML element
 * @param {string} value
 */
const escapeXml = (value) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c);

/**
 * resolveSitemap : validate the config block; return the active settings or { inactive: reason }
 * @param {Readonly<Record<string, any>>} config
 */
export const resolveSitemap = (config) => {

  if (config.baseUrl === undefined) return { inactive: 'no baseUrl configured' };
  const baseUrl = resolveBaseUrl(config.baseUrl, 'extensions.sitemap.baseUrl');
  const exclude = compileRoutePatterns(config.exclude, 'extensions.sitemap.exclude');

  let robots = null;
  if (config.robots !== undefined) {
    const { disallow, disallowAll } = config.robots ?? {};
    if (config.robots === null || typeof config.robots !== 'object' || Array.isArray(config.robots)) {
      throw new Error('extensions.sitemap.robots must be an object; use {} to serve robots.txt with no rules');
    }
    if (disallowAll !== undefined && typeof disallowAll !== 'boolean') {
      throw new Error('extensions.sitemap.robots.disallowAll must be true or false');
    }
    if (disallow !== undefined && (!Array.isArray(disallow) || disallow.some((rule) => typeof rule !== 'string' || !/^\/\S*$/.test(rule)))) {
      throw new Error('extensions.sitemap.robots.disallow must be an array of paths starting with /, such as "/admin/"');
    }
    robots = { disallowAll: disallowAll === true, disallow: disallow ?? [] };
  }

  return { baseUrl, exclude, robots };

} // resolveSitemap

/**
 * createSitemapXml : the sitemaps.org urlset for a list of page routes
 * @param {string} baseUrl
 * @param {readonly string[]} pages
 */
export const createSitemapXml = (baseUrl, pages) => {

  const urls = pages.map((page) => `  <url><loc>${escapeXml(new URL(page, baseUrl).href)}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}${urls.length ? '\n' : ''}</urlset>\n`;

} // createSitemapXml

/**
 * createRobotsTxt : robots.txt for all crawlers, pointing to the sitemap
 * @param {string} baseUrl
 * @param {{ disallowAll: boolean, disallow: readonly string[] }} robots
 */
export const createRobotsTxt = (baseUrl, { disallowAll, disallow }) => {

  const rules = disallowAll ? ['Disallow: /'] : disallow.length > 0 ? disallow.map((rule) => `Disallow: ${rule}`) : ['Allow: /'];
  return ['User-agent: *', ...rules, '', `Sitemap: ${baseUrl}/sitemap.xml`, ''].join('\n');

} // createRobotsTxt

export const sitemap = defineExtension({
  name: 'sitemap',
  apiVersion: 1,
  configKey: 'sitemap',
  async setup({ config, settings, site, addRoute, log, warn }) {

    const resolved = resolveSitemap(config);
    if ('inactive' in resolved) {
      log(`inactive (${resolved.inactive})`);
      return {};
    }

    const { baseUrl, exclude, robots } = resolved;
    const listed = async () => (await site.listPages()).filter((page) => !exclude.some((matches) => matches(page.toLowerCase())));

    addRoute('GET', '/sitemap.xml', async (context) => context.body(createSitemapXml(baseUrl, await listed()), 200, {
      'Content-Type': 'application/xml; charset=UTF-8',
      'Cache-Control': CACHE_CONTROL
    }));
    if (robots) {
      addRoute('GET', '/robots.txt', (context) => context.body(createRobotsTxt(baseUrl, robots), 200, {
        'Content-Type': 'text/plain; charset=UTF-8',
        'Cache-Control': CACHE_CONTROL
      }));
    }

    // Static files are served before extension routes, so a file of the same name wins
    const publicPath = path.join(settings.appRootPath, settings.activeSpace, settings.publicLocation);
    for (const name of robots ? ['sitemap.xml', 'robots.txt'] : ['sitemap.xml']) {
      const exists = await fs.access(path.join(publicPath, name)).then(() => true, () => false);
      if (exists) warn(`${settings.publicLocation}/${name} exists and is served instead of the generated /${name}; delete it to use the extension`);
    }

    const count = (await listed()).length;
    log(`active (${baseUrl}; ${count} page${count === 1 ? '' : 's'}; robots.txt ${robots ? 'on' : 'off'})`);
    return {};

  } // setup
});
