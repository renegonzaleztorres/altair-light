// @ts-check
/**
 * Redirects extension
 *
 * Answers old URLs with a redirect to their new location, from a map in
 * settings.extensions.redirects.rules. Active only when the application lists
 * it and the rules map is present. Rules are exact ("/old": "/new") or prefix
 * ("/old-blog/*": "/blog/*", which keeps the rest of the path). Targets are
 * paths on this site or absolute http(s) URLs; the request's query string is
 * kept unless the target has its own.
 */

import { defineExtension } from '../../altair/extensions.js';

const STATUSES = new Set([301, 302, 307, 308]);
const SOURCE_PATTERN = /^\/[^\s?#*]*(?:\/\*)?$/;

/**
 * parseTarget : validate one target; a site path or an absolute http(s) URL, optionally ending in /*
 * @param {string} source
 * @param {unknown} target
 */
const parseTarget = (source, target) => {

  const invalid = () => new Error(`extensions.redirects.rules["${source}"]: target must be a path starting with / or an http(s) URL`);
  if (typeof target !== 'string' || target === '' || /\s/.test(target)) throw invalid();
  const prefix = target.endsWith('/*');
  const base = prefix ? target.slice(0, -2) : target;
  if (base.startsWith('/') && !base.startsWith('//')) return { base, prefix };
  try {
    const url = new URL(base);
    if (url.protocol === 'http:' || url.protocol === 'https:') return { base, prefix };
  } catch {}
  throw invalid();

} // parseTarget

/**
 * resolveRedirects : validate the config block; return the rules or { inactive: reason }
 * @param {Readonly<Record<string, any>>} config
 */
export const resolveRedirects = (config) => {

  if (config.rules === undefined) return { inactive: 'no rules configured' };
  if (config.rules === null || typeof config.rules !== 'object' || Array.isArray(config.rules)) {
    throw new Error('extensions.redirects.rules must be an object mapping old paths to new ones');
  }
  if (config.status !== undefined && !STATUSES.has(config.status)) {
    throw new Error('extensions.redirects.status must be 301, 302, 307 or 308');
  }

  const rules = Object.entries(config.rules).map(([source, target]) => {
    if (!SOURCE_PATTERN.test(source) || source === '/' || source === '/*') {
      throw new Error(`extensions.redirects.rules: invalid source ${JSON.stringify(source)}; use /old-path or /old-section/* (not / or /*)`);
    }
    const prefix = source.endsWith('/*');
    const parsed = parseTarget(source, target);
    if (parsed.prefix && !prefix) {
      throw new Error(`extensions.redirects.rules["${source}"]: only a /* source can redirect to a /* target`);
    }
    return { source, base: prefix ? source.slice(0, -2) : source, prefix, target: parsed };
  });

  // matches : the rule a site path would hit, if any (the most specific, as at runtime)
  const matches = (/** @type {string} */ path) => rules.find((rule) => !rule.prefix && path === rule.source)
    ?? rules.filter((rule) => rule.prefix && (path === rule.base || path.startsWith(`${rule.base}/`)))
      .sort((a, b) => b.base.length - a.base.length)[0];
  for (const rule of rules) {
    const { base, prefix } = rule.target;
    if (!base.startsWith('/') || prefix) continue;
    const next = matches(base.split('?')[0]);
    if (next) {
      throw new Error(`extensions.redirects.rules: "${rule.source}" → "${base}" is redirected again by "${next.source}"; point "${rule.source}" straight at the final URL`);
    }
  }

  return { rules, status: /** @type {301 | 302 | 307 | 308} */ (config.status ?? 301) };

} // resolveRedirects

/**
 * redirectLocation : where a request for path (with search, e.g. "?a=1") goes under one rule
 * @param {{ base: string, prefix: boolean, target: { base: string, prefix: boolean } }} rule
 * @param {string} path
 * @param {string} search
 */
export const redirectLocation = (rule, path, search) => {

  const rest = rule.prefix ? path.slice(rule.base.length) : '';
  const location = rule.target.prefix ? `${rule.target.base}${rest}` : rule.target.base;
  return location.includes('?') ? location : `${location}${search}`;

} // redirectLocation

export const redirects = defineExtension({
  name: 'redirects',
  apiVersion: 1,
  configKey: 'redirects',
  async setup({ config, site, addRoute, log, warn }) {

    const resolved = resolveRedirects(config);
    if ('inactive' in resolved) {
      log(`inactive (${resolved.inactive})`);
      return {};
    }

    const { rules, status } = resolved;
    const pages = new Set(await site.listPages());
    // The most specific rule wins: routes match in registration order, so exact
    // rules go first, then sections from the longest path to the shortest
    const ordered = [...rules].sort((a, b) => Number(a.prefix) - Number(b.prefix) || b.base.length - a.base.length);
    const exactSources = new Set(rules.filter((rule) => !rule.prefix).map((rule) => rule.source));
    for (const rule of ordered) {
      const handler = (/** @type {import('hono').Context} */ context) =>
        context.redirect(redirectLocation(rule, context.req.path, new URL(context.req.url).search), status);
      if (rule.prefix) {
        if (!exactSources.has(rule.base)) addRoute('GET', rule.base, handler);
        addRoute('GET', `${rule.base}/*`, handler);
      } else {
        addRoute('GET', rule.source, handler);
      }
      if (!rule.prefix && pages.has(rule.source)) warn(`"${rule.source}" is also a page; the redirect hides it`);
    }

    log(`active (${rules.length} rules, status ${status})`);
    return {};

  } // setup
});
