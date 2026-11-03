/**
 * Web server
 */

import { fs, path, loadTerser, loadCleanCSS } from './dependencies.js'
import { createHash } from 'node:crypto';
import HTTPServer from './http-server.js';
import RenderCache from './render-cache.js';
import Tarazed from './tarazed.js';

const NON_PAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp', 'tif', 'tiff',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac',
  'mp4', 'webm', 'mov', 'm4v', 'pdf', 'zip', 'gz', 'br', 'wasm', 'map', 'json',
  'xml', 'txt', 'webmanifest'
]);
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

class WebServer extends HTTPServer {

  constructor(options = {}) {

    super(options);
    this.tarazed = null;
    this.renderCache = null;
    this.applicationInitialized = false;
    if (this.settings) this.initializeApplication();

  } // constructor

  initializeApplication() {

    if (this.applicationInitialized) return;
    this.tarazed = new Tarazed({ appPath: path.join(this.settings.appRootPath, this.settings.activeSpace), readoutCallback: this.readout });
    this.renderCache = new RenderCache({
      settings: this.settings,
      readoutCallback: this.settings.routeCacheDebug ? (message) => this.routeCacheReadout(message) : null
    });
    this.applicationInitialized = true;

  } // initializeApplication

  // routes : definitions (override when needed or override additionalRoutes() to add custom routes)
  routes() {

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
      if (this.isNonPageRequest(context)) {
        return this.notFound(context, {
          path: context.req.path,
          reason: 'resource-missing',
          resourceType: 'resource'
        });
      }
      return this.renderHTML(context.req.path, context, { coreRoute: true });
    }); // get

    return;

  } // routes

  // additionalRoutes : definitions (override as needed)
  additionalRoutes() {
    
    return;

  } // additionalRoutes

  // renderHTML : render html pages
  async renderHTML(p, context, { coreRoute = false, bypassCache = false } = {}) {

    try{
      if (!this.pageNameValidation(p)) {
        return this.handleMissingPage(context, {
          path: context.req.path,
          reason: this.isPrivatePagePath(p) ? 'page-private' : 'page-invalid'
        });
      }
      const eligibility = this.routeCacheEligibility(context, { coreRoute, bypassCache });
      if (!eligibility.eligible) {
        this.renderCache.recordBypass();
        this.routeCacheReadout(`bypass path=${this.normalizeRouteCacheKey(p)} reason=${eligibility.reason}`);
        const result = await this.renderHTMLBody(p);
        return this.createHTMLResponse(result.body, context);
      }

      const cacheKey = this.normalizeRouteCacheKey(p);
      const cookieDebug = eligibility.ignoredCookies > 0
        ? ` ignored-cookies=${eligibility.ignoredCookies}`
        : '';
      let cached = this.renderCache.get(cacheKey);
      if (cached) {
        this.routeCacheReadout(`hit path=${cacheKey}${cookieDebug}`);
        return this.createCachedHTMLResponse(cached, context, cacheKey);
      }
      this.routeCacheReadout(`miss path=${cacheKey}${cookieDebug}`);

      let renderPromise = this.renderCache.getInFlight(cacheKey);
      if (!renderPromise) {
        const generationAtStart = this.renderCache.generation;
        renderPromise = (async () => {
          const result = await this.renderHTMLBody(p);
          if (!result.cacheable) {
            this.routeCacheReadout(`skip-store path=${cacheKey} reason=${result.timeSensitive ? 'time-sensitive' : 'response-policy'}`);
            return result;
          }

          try {
            result.etag = this.createETag(result.body);
            if (this.routeCacheAdmissionAllowed()) {
              const stored = this.renderCache.set(cacheKey, result, generationAtStart);
              if (stored) this.routeCacheReadout(`stored path=${cacheKey}`);
              else this.routeCacheReadout(`skip-store path=${cacheKey} reason=cache-state-changed`);
            }
            else this.routeCacheReadout(`skip-store path=${cacheKey} reason=admission-suspended`);
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
        this.routeCacheReadout(`coalesced path=${cacheKey}${cookieDebug}`);
      }

      const result = await renderPromise;
      if (!result.cacheable || !result.etag) return this.createHTMLResponse(result.body, context);
      cached = { body: result.body, etag: result.etag };
      return this.createCachedHTMLResponse(cached, context, cacheKey);
    }
    catch (err) {
      if (err.code === 'ENOENT') // “Error NO ENTry” or “No such file or directory”
        return this.handleMissingPage(context, { path: context.req.path, reason: 'page-missing' });
      else // Other errors
        return this.serverError(context, err, {
          path: context.req.path,
          source: 'renderHTML',
          resourceType: 'html'
        });
    } // try

    return;

  } // renderHTML

  // renderHTMLBody : render a page without constructing a response
  async renderHTMLBody(p, {
    allowPrivate = false,
    currentPath = p,
    routePath = p,
    variables = {}
  } = {}) {

    let filePath = this.resolvePageFile(p, { allowPrivate });
    let data = await fs.readFile(filePath, 'utf8');
    data = await this.tarazed.replaceElemTags(data);
    data = await this.tarazed.replaceRepeatTags(data);
    data = await this.tarazed.replaceDataTags(data);
    const timeSensitive = /@@VAR_(?:TIMESTAMP|TS)(?![\w-])/i.test(data);
    data = this.tarazed.replaceVarTags(data, this.varDefinitions({ currentPath, ...variables }));
    if (this.settings.minify) data = data.replace(/<!--[\s\S]*?-->/g, '');
    if (this.extensionRunner) {
      data = await this.extensionRunner.transform('html', data, {
        path: this.normalizeRouteCacheKey(routePath), routePath, kind: allowPrivate ? 'error' : 'page'
      });
    }
    data = await this.applyGlobalReplacements({ content: data, type: 'html', routePath });
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
    const cookieEligibility = this.routeCacheCookieEligibility(context.req.header('Cookie'));
    if (!cookieEligibility.eligible) return cookieEligibility;
    const responseHeaders = context.res?.headers;
    const cacheControl = responseHeaders?.get('Cache-Control')?.toLowerCase() || '';
    if (responseHeaders?.has('Set-Cookie')) return { eligible: false, reason: 'set-cookie' };
    if (cacheControl.includes('private')) return { eligible: false, reason: 'private' };
    if (cacheControl.includes('no-store')) return { eligible: false, reason: 'no-store' };
    if (!this.routeCacheLookupAllowed()) return { eligible: false, reason: 'watcher-uncertain' };
    return { eligible: true, ignoredCookies: cookieEligibility.ignoredCookies };

  } // routeCacheEligibility

  routeCacheCookieEligibility(cookieHeader) {

    if (!cookieHeader) return { eligible: true, ignoredCookies: 0 };
    const patterns = this.settings.routeCacheIgnoredCookies || [];
    let ignoredCookies = 0;

    for (const pair of cookieHeader.split(';')) {
      const separator = pair.indexOf('=');
      const name = separator > 0 ? pair.slice(0, separator).trim() : '';
      if (!name || !COOKIE_NAME_PATTERN.test(name)) {
        return { eligible: false, reason: 'cookie-malformed' };
      }

      const ignored = patterns.some((pattern) => pattern.endsWith('*')
        ? name.startsWith(pattern.slice(0, -1))
        : name === pattern);
      if (!ignored) return { eligible: false, reason: 'cookie' };
      ignoredCookies += 1;
    }

    return { eligible: true, ignoredCookies };

  } // routeCacheCookieEligibility

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

  createCachedHTMLResponse(entry, context, cacheKey = this.normalizeRouteCacheKey(context.req.path)) {

    const headers = {
      'Content-Type': 'text/html; charset=UTF-8',
      'ETag': entry.etag,
      'Cache-Control': 'no-cache'
    };
    if (this.etagMatches(context.req.header('If-None-Match'), entry.etag)) {
      this.routeCacheReadout(`revalidated path=${cacheKey} status=304`);
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

    if (this.renderCache) this.renderCache.close();

  } // closeRouteCache

  // renderCSS : render css scripts
  async renderCSS(p, context) {

    try {
      if (!this.pageNameValidation(p)) {
        return this.notFound(context, { path: context.req.path, reason: 'stylesheet-invalid', resourceType: 'css' });
      }
      let filePath = this.resolveActiveSpaceFile(p);
      let data = await fs.readFile(filePath, 'utf8'); // UTF-8: (8-bit Unicode Transformation Format)
      data = await this.tarazed.replaceElemTags(data);
      data = await this.tarazed.replaceRepeatTags(data);
      data = await this.tarazed.replaceDataTags(data);
      data = this.tarazed.replaceVarTags(data, this.varDefinitions({ currentPath: p }));
      if (this.settings.minify) { // Minify CSS, when specified
        const CleanCSS = await loadCleanCSS();
        let minified = new CleanCSS().minify(data);
        if (minified.errors && minified.errors.length > 0)
          throw new Error(`CSS minification error(s) > ${minified.errors.join(', ')}`);
        data = minified.styles;
      } // if
      if (this.extensionRunner) data = await this.extensionRunner.transform('css', data, { path: p });
      data = await this.applyGlobalReplacements({ content: data, type: 'css', routePath: p });
      return context.body(data, 200, { 'Content-Type': 'text/css; charset=UTF-8' });
    }
    catch (err) {
      if (err.code === 'ENOENT') // “Error NO ENTry” or “No such file or directory”
        return this.notFound(context, { path: context.req.path, reason: 'stylesheet-missing', resourceType: 'css' });
      else // Other errors
        return this.serverError(context, err, {
          path: context.req.path,
          source: 'renderCSS',
          resourceType: 'css'
        });
    } // try

    return;

  } // renderCSS

  // renderJS : render js scripts
  async renderJS(p, context) {

    try{
      if (!this.pageNameValidation(p)) {
        return this.notFound(context, { path: context.req.path, reason: 'javascript-invalid', resourceType: 'javascript' });
      }
      let filePath = this.resolveActiveSpaceFile(p);
      let data = await fs.readFile(filePath, 'utf8'); // UTF-8: (8-bit Unicode Transformation Format)
      data = await this.tarazed.replaceElemTags(data);
      data = await this.tarazed.replaceRepeatTags(data);
      data = await this.tarazed.replaceDataTags(data);
      data = this.tarazed.replaceVarTags(data, this.varDefinitions({ currentPath: p }));
      if (this.settings.minify) { // Minify JS, when specified
        const { minify } = await loadTerser();
        let minified = await minify(data);
        if (minified.error)
          throw new Error(`JS minification error(s) > ${minified.error.message}`);
        data = minified.code;
      } // if
      if (this.extensionRunner) data = await this.extensionRunner.transform('js', data, { path: p });
      data = await this.applyGlobalReplacements({ content: data, type: 'js', routePath: p });
      return context.body(data, 200, { 'Content-Type': 'application/javascript; charset=UTF-8' });
    }
    catch (err) {
      if (err.code === 'ENOENT') // “Error NO ENTry” or “No such file or directory”
        return this.notFound(context, { path: context.req.path, reason: 'javascript-missing', resourceType: 'javascript' });
      else // Other errors
        return this.serverError(context, err, {
          path: context.req.path,
          source: 'renderJS',
          resourceType: 'javascript'
        });
    } // try

    return;

  } // renderJS

  // applyGlobalReplacements : final content replacement hook (override as needed)
  async applyGlobalReplacements({ content, type, routePath } = {}) {
    if (typeof content !== 'string' || content.length === 0)
      return content;

    return content;

  } // applyGlobalReplacements

  // handleMissingPage : application extension point for missing HTML pages only
  handleMissingPage(context, { path: requestPath, reason } = {}) {

    return this.notFound(context, { path: requestPath, reason, resourceType: 'html' });

  } // handleMissingPage

  // notFound : optionally render the private HTML 404 page
  async notFound(context, options = {}) {

    const requestPath = options.path || context.req.path;
    const reason = options.reason || 'not-found';
    this.readout(
      `404 - path: ${this.safeLogValue(requestPath)} - reason: ${this.safeLogValue(reason)}`,
      'Not-Found'
    );
    if (options.resourceType === 'html') {
      const response = await this.renderErrorPage(404, context);
      if (response) return response;
    }
    return this.createErrorResponse(context, 404, 'Not Found', {
      html: options.resourceType === 'html'
    });

  } // notFound

  // serverError : optionally render the private HTML 500 page without recursion
  async serverError(context, error, options = {}) {

    const reference = options.reference || this.createErrorReference();
    this.logServerError(error, {
      path: options.path || context.req.path,
      source: options.source || 'server',
      reference
    });
    if (options.resourceType === 'html') {
      const response = await this.renderErrorPage(500, context, { reference });
      if (response) return response;
    }
    return this.createErrorResponse(context, 500, `Server Error\nReference: ${reference}`, {
      html: options.resourceType === 'html'
    });

  } // serverError

  // renderErrorPage : render an optional private error page outside route caching
  async renderErrorPage(statusCode, context, { reference } = {}) {

    const page = statusCode === 404 ? '_404' : '_500';
    try {
      const result = await this.renderHTMLBody(page, {
        allowPrivate: true,
        currentPath: '/',
        routePath: page,
        variables: reference ? { errorreference: reference } : {}
      });
      return this.createErrorResponse(context, statusCode, result.body, { html: true });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.readout(`Unable to render ${page}.html; using built-in fallback`, 'Error-Page');
      }
      return null;
    }

  } // renderErrorPage

  // isNonPageRequest : keep missing assets and API requests out of the HTML renderer
  isNonPageRequest(context) {

    const requestPath = context.req.path;
    if (requestPath === '/api' || requestPath.startsWith('/api/')) return true;
    const destination = (context.req.header('Sec-Fetch-Dest') || '').toLowerCase();
    if (destination && destination !== 'document' && destination !== 'iframe' && destination !== 'empty') return true;
    const extension = path.extname(requestPath).slice(1).toLowerCase();
    if (NON_PAGE_EXTENSIONS.has(extension)) return true;
    const accept = context.req.header('Accept') || '';
    return Boolean(accept && !accept.includes('text/html') && !accept.includes('*/*'));

  } // isNonPageRequest

  normalizeContentPath(p) {

    if (typeof p !== 'string' || p.includes('\0') || p.includes('\\')) return null;
    let decoded;
    try {
      decoded = decodeURIComponent(p);
    } catch (error) {
      return null;
    }
    const normalized = this.trimSlashes(decoded);
    const segments = normalized.split('/');
    if (!normalized || segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
    return normalized;

  } // normalizeContentPath

  isPrivatePagePath(p) {

    const normalized = this.normalizeContentPath(p);
    return Boolean(normalized && normalized.split('/').some((segment) => segment.startsWith('_')));

  } // isPrivatePagePath

  resolveContainedFile(root, relativePath) {

    const resolvedRoot = path.resolve(root);
    const resolvedFile = path.resolve(resolvedRoot, relativePath);
    if (!resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) {
      const error = new Error('Requested path is outside the configured content directory');
      error.code = 'ALT_INVALID_PATH';
      throw error;
    }
    return resolvedFile;

  } // resolveContainedFile

  resolvePageFile(p, { allowPrivate = false } = {}) {

    const normalized = this.normalizeContentPath(p);
    const allowedPrivatePage = allowPrivate && (normalized === '_404' || normalized === '_500');
    if (!normalized || (!allowedPrivatePage && !this.pageNameValidation(normalized))) {
      const error = new Error('Invalid page path');
      error.code = 'ALT_INVALID_PATH';
      throw error;
    }
    const pagesRoot = path.join(this.settings.appRootPath, this.settings.activeSpace, this.settings.pagesLocation);
    return this.resolveContainedFile(pagesRoot, `${normalized}.html`);

  } // resolvePageFile

  resolveActiveSpaceFile(p) {

    const normalized = this.normalizeContentPath(p);
    if (!normalized || !this.pageNameValidation(normalized)) {
      const error = new Error('Invalid asset path');
      error.code = 'ALT_INVALID_PATH';
      throw error;
    }
    const activeRoot = path.join(this.settings.appRootPath, this.settings.activeSpace);
    return this.resolveContainedFile(activeRoot, normalized);

  } // resolveActiveSpaceFile

  // listPublicPages : public page routes in the active space ("/" for home.html), sorted;
  // skips private "_" files and folders and names pageNameValidation rejects
  async listPublicPages() {

    const pagesRoot = path.join(this.settings.appRootPath, this.settings.activeSpace, this.settings.pagesLocation);
    const routes = [];
    const visit = async (directory, prefix) => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('_')) continue;
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await visit(path.join(directory, entry.name), relative);
        else if (entry.isFile() && entry.name.endsWith('.html')) {
          const page = relative.slice(0, -'.html'.length);
          if (this.pageNameValidation(page)) routes.push(page === 'home' ? '/' : `/${page}`);
        }
      }
    };
    await visit(pagesRoot, '');
    return routes.sort();

  } // listPublicPages

  // pageNameValidation : validate the page|script name
  pageNameValidation(p) {

    const normalized = this.normalizeContentPath(p);
    if (!normalized) return false;
    return !normalized.split('/').some((segment) => segment.startsWith('_'));

  } // pageNameValidation

  // varDefinitions : define an object containing some standard "var" definitions
  varDefinitions({ currentPath, ...otherProps } = {}) {

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
      ...this.extensionRunner?.vars({ currentPath }),
      ...this.additionalVarDefinitions(),
      ...flattenedDataCache,
      ...otherProps
    };

  } // varDefinitions

  // additionalVarDefinitions : define an object containing any addditional "var" definitions (override as needed)
  additionalVarDefinitions() {

    let v = {};

    return v;

  } // additionalVarDefinitions

} // WebServer

export default WebServer;
