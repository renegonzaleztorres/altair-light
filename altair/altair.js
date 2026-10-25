/**
 * Web server
 */

import { fs, path, minify, CleanCSS } from './dependencies.js'
import { createHash } from 'node:crypto';
import HTTPServer from './http-server.js';
import RenderCache from './render-cache.js';
import Tarazed from './tarazed.js';

class WebServer extends HTTPServer {

  constructor() {

    super();
    this.tarazed = new Tarazed({ appPath: path.join(this.settings.appRootPath, this.settings.activeSpace), readoutCallback: this.readout });
    this.renderCache = new RenderCache({
      enabled: this.settings.enableRouteCache,
      maxEntries: this.settings.routeCacheMaxEntries,
      readoutCallback: this.settings.routeCacheDebug ? (message) => this.routeCacheReadout(message) : null
    });

  } // constructor

  // routes : definitions (override when needed or override additionalRoutes() to add custom routes)
  routes = () => {

    // Root
    this.app.get('/', (context) => {
      this.readout(`path: ${context.req.path}`, 'Request-Root');
      return this.renderHTML('home', context, { coreRoute: true });
    });

    // CSS and JS scripts
    this.app.get('*', (context, next) => {
      const requestPath = context.req.path;
      if (requestPath.endsWith('.css')) {
        this.readout(`path: ${requestPath}`, 'Request-CSS');
        return this.renderCSS(requestPath, context);
      }
      if (requestPath.endsWith('.js')) {
        this.readout(`path: ${requestPath}`, 'Request-JS');
        return this.renderJS(requestPath, context);
      }
      return next();
    }); // get

    // Additional routes definitions
    this.additionalRoutes();

    // HTML pages and "catch all"
    this.app.get('*', (context) => {
      this.readout(`path: ${context.req.path}`, 'Request-CatchAll');
      return this.renderHTML(context.req.path, context, { coreRoute: true });
    }); // get

    return;

  } // routes

  // additionalRoutes : definitions (override as needed)
  additionalRoutes = () => {
    
    return;

  } // additionalRoutes

  // renderHTML : render html pages
  renderHTML = async (p, context, { coreRoute = false, bypassCache = false } = {}) => {

    try{
      if (!this.pageNameValidation(p)) return this.redirects(301, '/', context);
      const eligibility = this.routeCacheEligibility(context, { coreRoute, bypassCache });
      if (!eligibility.eligible) {
        this.renderCache.recordBypass();
        this.routeCacheReadout(`bypass path=${this.normalizeRouteCacheKey(p)} reason=${eligibility.reason}`);
        const result = await this.renderHTMLBody(p);
        return this.createHTMLResponse(result.body, context);
      }

      const cacheKey = this.normalizeRouteCacheKey(p);
      let cached = this.renderCache.get(cacheKey);
      if (cached) {
        this.routeCacheReadout(`hit path=${cacheKey}`);
        return this.createCachedHTMLResponse(cached, context);
      }
      this.routeCacheReadout(`miss path=${cacheKey}`);

      let renderPromise = this.renderCache.getInFlight(cacheKey);
      if (!renderPromise) {
        const generationAtStart = this.renderCache.generation;
        renderPromise = (async () => {
          const result = await this.renderHTMLBody(p);
          if (!result.cacheable) return result;

          try {
            result.etag = this.createETag(result.body);
            if (this.routeCacheAdmissionAllowed()) {
              const stored = this.renderCache.set(cacheKey, result, generationAtStart);
              if (stored) this.routeCacheReadout(`stored path=${cacheKey}`);
            }
          } catch (error) {
            this.routeCacheReadout(`ETag unavailable path=${cacheKey}`);
          }
          return result;
        })();
        this.renderCache.setInFlight(cacheKey, renderPromise);
        void renderPromise.then(
          () => this.renderCache.deleteInFlight(cacheKey, renderPromise),
          () => this.renderCache.deleteInFlight(cacheKey, renderPromise)
        );
      } else {
        this.routeCacheReadout(`coalesced path=${cacheKey}`);
      }

      const result = await renderPromise;
      if (!result.cacheable || !result.etag) return this.createHTMLResponse(result.body, context);
      cached = { body: result.body, etag: result.etag };
      return this.createCachedHTMLResponse(cached, context);
    }
    catch (err) {
      if (err.code === 'ENOENT') // “Error NO ENTry” or “No such file or directory”
        return this.redirects(301, '/', context);
      else // Other errors
        return this.serverError(context, err.message, 'renderHTML()', p);
    } // try

    return;

  } // renderHTML

  // renderHTMLBody : render a page without constructing a response
  renderHTMLBody = async (p) => {

    let filePath = path.join(this.settings.appRootPath, this.settings.activeSpace, this.settings.pagesLocation, (this.trimSlashes(p) + '.html'));
    let data = await fs.readFile(filePath, 'utf8');
    data = await this.tarazed.replaceElemTags(data);
    data = await this.tarazed.replaceRepeatTags(data);
    data = await this.tarazed.replaceDataTags(data);
    const timeSensitive = /@@VAR_(?:TIMESTAMP|TS)(?![\w-])/i.test(data);
    data = this.tarazed.replaceVarTags(data, this.varDefinitions({ currentPath: p }));
    if (this.settings.minify) data = data.replace(/<!--[\s\S]*?-->/g, '');
    data = await this.applyGlobalReplacements({ content: data, type: 'html', routePath: p });
    return {
      body: data,
      contentType: 'text/html; charset=UTF-8',
      cacheable: !timeSensitive,
      timeSensitive
    };

  } // renderHTMLBody

  routeCacheEligibility(context, { coreRoute = false, bypassCache = false } = {}) {

    if (!this.settings.enableRouteCache || !this.renderCache.enabled) return { eligible: false, reason: 'disabled' };
    if (!coreRoute) return { eligible: false, reason: 'custom-route' };
    if (bypassCache) return { eligible: false, reason: 'application-bypass' };
    const method = context.req.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return { eligible: false, reason: 'method' };
    if (context.req.url.includes('?')) return { eligible: false, reason: 'query-present' };
    if (context.req.header('Authorization')) return { eligible: false, reason: 'authorization' };
    if (context.req.header('Cookie')) return { eligible: false, reason: 'cookie' };
    const responseHeaders = context.res?.headers;
    const cacheControl = responseHeaders?.get('Cache-Control')?.toLowerCase() || '';
    if (responseHeaders?.has('Set-Cookie')) return { eligible: false, reason: 'set-cookie' };
    if (cacheControl.includes('private')) return { eligible: false, reason: 'private' };
    if (cacheControl.includes('no-store')) return { eligible: false, reason: 'no-store' };
    if (!this.routeCacheLookupAllowed()) return { eligible: false, reason: 'watcher-uncertain' };
    return { eligible: true };

  } // routeCacheEligibility

  normalizeRouteCacheKey(p) {

    if (p === 'home') return '/';
    const normalized = this.trimSlashes(p);
    return normalized ? `/${normalized}` : '/';

  } // normalizeRouteCacheKey

  createETag(body) {

    const hash = createHash('sha256').update(body).digest('base64url').slice(0, 16);
    return `W/"${hash}"`;

  } // createETag

  etagMatches(headerValue, etag) {

    if (!headerValue) return false;
    const normalize = (value) => value.trim().replace(/^W\//i, '');
    const expected = normalize(etag);
    return headerValue.split(',').some((value) => value.trim() === '*' || normalize(value) === expected);

  } // etagMatches

  createHTMLResponse(body, context) {

    if (context.req.method.toUpperCase() === 'HEAD') {
      return context.body(null, 200, { 'Content-Type': 'text/html; charset=UTF-8' });
    }
    return context.html(body);

  } // createHTMLResponse

  createCachedHTMLResponse(entry, context) {

    const headers = {
      'Content-Type': 'text/html; charset=UTF-8',
      'ETag': entry.etag,
      'Cache-Control': 'no-cache'
    };
    if (this.etagMatches(context.req.header('If-None-Match'), entry.etag)) {
      return context.body(null, 304, headers);
    }
    if (context.req.method.toUpperCase() === 'HEAD') return context.body(null, 200, headers);
    return context.body(entry.body, 200, headers);

  } // createCachedHTMLResponse

  routeCacheReadout(message) {

    if (this.settings.routeCacheDebug) console.log(`[Route-Cache] ${message}`);

  } // routeCacheReadout

  invalidateRouteCache(reason = 'unspecified') {

    return this.renderCache.invalidateAll(reason);

  } // invalidateRouteCache

  closeRouteCache() {

    this.renderCache.close();

  } // closeRouteCache

  // renderCSS : render css scripts
  renderCSS = async (p, context) => {

    try {
      if (!this.pageNameValidation(p)) return this.redirects(301, '/', context);
      let filePath = path.join(this.settings.appRootPath, this.settings.activeSpace, this.trimSlashes(p));
      let data = await fs.readFile(filePath, 'utf8'); // UTF-8: (8-bit Unicode Transformation Format)
      data = await this.tarazed.replaceElemTags(data);
      data = await this.tarazed.replaceRepeatTags(data);
      data = await this.tarazed.replaceDataTags(data);
      data = this.tarazed.replaceVarTags(data, this.varDefinitions({ currentPath: p }));
      if (this.settings.minify) { // Minify CSS, when specified
        let minified = new CleanCSS().minify(data);
        if (minified.errors && minified.errors.length > 0)
          throw new Error(`CSS minification error(s) > ${minified.errors.join(', ')}`);
        data = minified.styles;
      } // if
      data = await this.applyGlobalReplacements({ content: data, type: 'css', routePath: p });
      return context.body(data, 200, { 'Content-Type': 'text/css; charset=UTF-8' });
    }
    catch (err) {
      if (err.code === 'ENOENT') // “Error NO ENTry” or “No such file or directory”
        return this.redirects(301, '/', context);
      else // Other errors
        return this.serverError(context, err.message, 'renderCSS()', p);
    } // try

    return;

  } // renderCSS

  // renderJS : render js scripts
  renderJS = async (p, context) => {

    try{
      if (!this.pageNameValidation(p)) return this.redirects(301, '/', context);
      let filePath = path.join(this.settings.appRootPath, this.settings.activeSpace, this.trimSlashes(p));
      let data = await fs.readFile(filePath, 'utf8'); // UTF-8: (8-bit Unicode Transformation Format)
      data = await this.tarazed.replaceElemTags(data);
      data = await this.tarazed.replaceRepeatTags(data);
      data = await this.tarazed.replaceDataTags(data);
      data = this.tarazed.replaceVarTags(data, this.varDefinitions({ currentPath: p }));
      if (this.settings.minify) { // Minify JS, when specified
        let minified = await minify(data);
        if (minified.error)
          throw new Error(`JS minification error(s) > ${minified.error.message}`);
        data = minified.code;
      } // if
      data = await this.applyGlobalReplacements({ content: data, type: 'js', routePath: p });
      return context.body(data, 200, { 'Content-Type': 'application/javascript; charset=UTF-8' });
    }
    catch (err) {
      if (err.code === 'ENOENT') // “Error NO ENTry” or “No such file or directory”
        return this.redirects(301, '/', context);
      else // Other errors
        return this.serverError(context, err.message, 'renderJS()', p);
    } // try

    return;

  } // renderJS

  // applyGlobalReplacements : final content replacement hook (override as needed)
  applyGlobalReplacements = async ({ content, type, routePath } = {}) => {
    if (typeof content !== 'string' || content.length === 0)
      return content;

    return content;

  } // applyGlobalReplacements

  // pageNameValidation : validate the page|script name
  pageNameValidation = (p) => {

    let path = this.trimSlashes(p);
    let a = path.split('/');
    let fileName = a[a.length - 1];
    if (fileName.trim() === '' || fileName.charAt(0) === '_') // File name cannot be empty or start with _
      return false;

    return true;

  } // pageNameValidation

  // varDefinitions : define an object containing some standard "var" definitions
  varDefinitions = ({ currentPath, ...otherProps } = {}) => {

    // Normalize 'home' to '/'
    if (currentPath === 'home') {
      currentPath = '/';
    }

    // Flatten dataCache for use in template variables (original structure preserved in memory)
    const flattenedDataCache = this.flattenObject(this.getDataCache());

    return {
      year: new Date().getFullYear(),
      timestamp: this.nowToJSONDateUTC(),
      ts: this.nowToJSONDateUTC(),
      currentpath: currentPath,
      ...this.additionalVarDefinitions(),
      ...flattenedDataCache
    };

  } // varDefinitions

  // additionalVarDefinitions : define an object containing any addditional "var" definitions (override as needed)
  additionalVarDefinitions = () => {

    let v = {};

    return v;

  } // additionalVarDefinitions

} // WebServer

export default WebServer;
