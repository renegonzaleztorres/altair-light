// @ts-check
/**
 * Google Analytics extension
 *
 * Adds the Google tag (gtag.js) before </head> on rendered HTML pages. Active
 * only when the application lists it and settings.extensions.googleAnalytics
 * holds a measurementId; put that block in config/production.json to limit it
 * to production. Routes are excluded by config (excludePaths,
 * excludeErrorPages) or by a page's <meta name="altair-analytics" content="off">.
 */

import { defineExtension } from '../../altair/extensions.js';

const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,20}$/;
const PAGE_OPT_OUT = /<meta\s+name=["']altair-analytics["']\s+content=["']off["']\s*\/?>/i;

/**
 * compileRoutePatterns : turn "/exact" and "/prefix/*" patterns into matchers for normalized, lowercased paths
 * @param {unknown} patterns
 * @returns {Array<(path: string) => boolean>}
 */
export const compileRoutePatterns = (patterns) => {

  if (patterns === undefined) return [];
  if (!Array.isArray(patterns)) {
    throw new Error('extensions.googleAnalytics.excludePaths must be an array of route patterns');
  }

  return patterns.map((pattern) => {
    const prefix = typeof pattern === 'string' && pattern.endsWith('/*');
    const base = prefix ? pattern.slice(0, -2) : pattern;
    if (typeof pattern !== 'string' || !/^(?:\/[^*\s]*)?$/.test(base) || (!prefix && base === '')) {
      throw new Error(
        `extensions.googleAnalytics.excludePaths: invalid pattern ${JSON.stringify(pattern)}; use /exact or /prefix/*`
      );
    }
    const key = base.replace(/\/+$/, '').toLowerCase();
    if (prefix) return key === '' ? () => true : (path) => path === key || path.startsWith(`${key}/`);
    return (path) => path === (key || '/');
  });

} // compileRoutePatterns

/**
 * resolveGoogleAnalytics : validate the config block; return the active settings or { inactive: reason }
 * @param {Readonly<Record<string, any>>} config
 */
export const resolveGoogleAnalytics = (config) => {

  const { measurementId, excludePaths, excludeErrorPages } = config;
  if (measurementId === undefined) return { inactive: 'no measurementId configured' };
  if (typeof measurementId !== 'string' || !MEASUREMENT_ID_PATTERN.test(measurementId)) {
    throw new Error('extensions.googleAnalytics.measurementId must be a GA4 Measurement ID such as G-XXXXXXXXXX');
  }
  if (excludeErrorPages !== undefined && typeof excludeErrorPages !== 'boolean') {
    throw new Error('extensions.googleAnalytics.excludeErrorPages must be true or false');
  }

  return {
    measurementId,
    excludePaths: compileRoutePatterns(excludePaths),
    excludeErrorPages: excludeErrorPages === true
  };

} // resolveGoogleAnalytics

/**
 * createGoogleTag : Google's gtag.js snippet for one Measurement ID
 * @param {string} measurementId
 */
export const createGoogleTag = (measurementId) => `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '${measurementId}');
</script>`;

/**
 * injectGoogleTag : insert the tag before the first </head>, once; pages without </head> are unchanged
 * @param {string} html
 * @param {{ measurementId: string, tag: string }} options
 */
export const injectGoogleTag = (html, { measurementId, tag }) => {

  if (html.includes(`googletagmanager.com/gtag/js?id=${measurementId}`)) return html;
  const index = html.search(/<\/head\s*>/i);
  if (index === -1) return html;
  return `${html.slice(0, index)}${tag}\n${html.slice(index)}`;

} // injectGoogleTag

/**
 * coversCookie : whether ROUTE_CACHE_IGNORED_COOKIES patterns (exact or trailing "*") ignore a cookie name
 * @param {readonly string[]} patterns
 * @param {string} name
 */
const coversCookie = (patterns, name) =>
  patterns.some((pattern) => (pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern));

export const googleAnalytics = defineExtension({
  name: 'google-analytics',
  apiVersion: 1,
  configKey: 'googleAnalytics',
  setup({ config, settings, log, warn }) {

    const resolved = resolveGoogleAnalytics(config);
    if ('inactive' in resolved) {
      log(`inactive (${resolved.inactive})`);
      return {};
    }

    const { measurementId, excludePaths, excludeErrorPages } = resolved;
    const tag = createGoogleTag(measurementId);
    log(`active (${measurementId}; ${excludePaths.length} excluded path patterns)`);

    // GA sets _ga and _ga_<id> cookies; unless ignored they make every returning visitor bypass the route cache
    const ignored = settings.routeCacheIgnoredCookies ?? [];
    const gaCookies = ['_ga', `_ga_${measurementId.slice(2)}`];
    if (settings.enableRouteCache && !gaCookies.every((name) => coversCookie(ignored, name))) {
      warn('set ROUTE_CACHE_IGNORED_COOKIES="_ga,_ga_*,_gid" in .env; otherwise returning visitors bypass the route cache');
    }

    return {
      // Route-cached: the decision depends only on path, kind, content and config
      transformHTML: ({ content, path, kind }) => {
        if (kind === 'error' && excludeErrorPages) return content;
        const route = path.toLowerCase();
        if (excludePaths.some((matches) => matches(route))) return content;
        if (PAGE_OPT_OUT.test(content)) return content;
        return injectGoogleTag(content, { measurementId, tag });
      }
    };

  } // setup
});
