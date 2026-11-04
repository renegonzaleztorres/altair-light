// @ts-check
/**
 * Config helpers shared by the extensions in this library. Each one validates
 * a setting and throws a message naming it, so a typo stops startup.
 */

/**
 * compileRoutePatterns : turn "/exact" and "/prefix/*" patterns into matchers for normalized, lowercased paths
 * @param {unknown} patterns
 * @param {string} setting Full setting name for error messages, e.g. "extensions.sitemap.exclude"
 * @returns {Array<(path: string) => boolean>}
 */
export const compileRoutePatterns = (patterns, setting) => {

  if (patterns === undefined) return [];
  if (!Array.isArray(patterns)) {
    throw new Error(`${setting} must be an array of route patterns`);
  }

  return patterns.map((pattern) => {
    const prefix = typeof pattern === 'string' && pattern.endsWith('/*');
    const base = prefix ? pattern.slice(0, -2) : pattern;
    if (typeof pattern !== 'string' || !/^(?:\/[^*\s]*)?$/.test(base) || (!prefix && base === '')) {
      throw new Error(`${setting}: invalid pattern ${JSON.stringify(pattern)}; use /exact or /prefix/*`);
    }
    const key = base.replace(/\/+$/, '').toLowerCase();
    if (prefix) return key === '' ? () => true : (path) => path === key || path.startsWith(`${key}/`);
    return (path) => path === (key || '/');
  });

} // compileRoutePatterns

/**
 * resolveBaseUrl : validate a site's public origin ("https://example.com") and return it without a trailing slash
 * @param {unknown} value
 * @param {string} setting Full setting name for error messages, e.g. "extensions.seo.baseUrl"
 */
export const resolveBaseUrl = (value, setting) => {

  let url;
  try {
    url = typeof value === 'string' ? new URL(value) : null;
  } catch {
    url = null;
  }
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error(`${setting} must be the site's origin, such as https://example.com (no path, query or trailing text)`);
  }
  return url.origin;

} // resolveBaseUrl

/**
 * optionalString : a non-empty string setting, or undefined when absent
 * @param {unknown} value
 * @param {string} setting
 */
export const optionalString = (value, setting) => {

  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${setting} must be a non-empty string`);
  return value;

} // optionalString
