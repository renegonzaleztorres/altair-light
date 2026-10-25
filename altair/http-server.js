/**
 * HTTP server
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { path, fs, fsSync } from './dependencies.js'
import { WSServer } from './websocket-server.js';
import Lib from './lib.js';
import { createMediaRedirectUrl, mediaRequestTarget, resolveMediaConfiguration } from './media-config.js';
import SpaceWatcher from './space-watcher.js';

class HTTPServer extends Lib {

  constructor(){

    super();
    this.app = new Hono();
    this.app.notFound((context) => this.notFound(context, {
      path: context.req.path,
      reason: 'route-unmatched',
      resourceType: 'resource'
    }));
    this.app.onError((error, context) => this.serverError(context, error, {
      path: context.req.path,
      source: 'unhandled-route',
      resourceType: this.requestExpectsHTML(context) ? 'html' : 'resource'
    }));
    this.server = null;
    this.wsServer = null;
    this.activeSpacePath = path.join(this.settings.appRootPath, this.settings.activeSpace);
    this.mediaConfiguration = null;
    
    // Construct public path (scoped to active space)
    this.publicPath = path.join(this.settings.appRootPath, this.settings.activeSpace, this.settings.publicLocation);

    // Initialize data cache to empty object (backwards compatible)
    this.dataCache = {};

    // Construct data file path (scoped to active space)
    this.dataFilePath = path.join(this.settings.appRootPath, this.settings.activeSpace, this.settings.dataLocation, this.settings.dataFile);

    // Track if file watching is active
    this.dataFileWatcher = null;
    this.dataFileWatchListener = null;
    this.dataFileWatchInterval = 500; // 500ms stat polling survives file replacement
    this.dataFileWatchStopped = false;

    // Debouncing timer for data reload
    this.dataReloadTimer = null;

    // Retry timer for a reload attempted during an incomplete write
    this.dataReloadRetryTimer = null;
    this.dataReloadRetryResolve = null;
    this.dataReloadDebounce = 1000; // 1 second

    // Retry logic for mid-write scenarios
    this.dataReloadRetryDelay = 500; // 500ms
    this.dataReloadMaxRetries = 1; // Retry once

    // Generalized active-space watcher and lifecycle state
    this.spaceWatcher = null;
    this.routeCacheAdmissionSuspended = false;
    this.activeSpaceReloadPromise = null;
    this.shuttingDown = false;
    this.shutdownPromise = null;
    this.signalHandlers = null;

  } // constructor

  // loadDataFile : load data from JSON file into memory cache
  // Atomic swap: builds new cache first, only updates dataCache if parsing succeeds
  async loadDataFile() {

    try {
      const rawData = await fs.readFile(this.dataFilePath, 'utf8');
      const parsedData = JSON.parse(rawData);

      // Build new cache in temporary variable (atomic preparation)
      let newCache;
      if (Object.prototype.hasOwnProperty.call(parsedData, 'default')) {
        // Environment-based configuration detected
        const defaultData = parsedData.default || {};
        const envData = parsedData[this.settings.nodeEnv] || {};
        newCache = this.deepMerge(defaultData, envData);
        this.readout(
          `Data loaded from ${this.dataFilePath} (env: ${this.settings.nodeEnv})`,
          'Data-Load'
        );
      } else {
        // Legacy flat structure - use as-is
        newCache = parsedData;
        this.readout(`Data loaded from ${this.dataFilePath}`, 'Data-Load');
      }

      const changed = !isDeepStrictEqual(this.dataCache, newCache);
      // Atomic swap: only update if all parsing succeeded
      this.dataCache = newCache;
      return { applied: true, state: changed ? 'loaded' : 'unchanged', changed };

    } catch (err) {
      if (err.code === 'ENOENT') {
        // File not found - reset to empty (backwards compatible)
        this.readout(
          `Data file not found at ${this.dataFilePath}, using empty cache`,
          'Data-Load'
        );
        const changed = !isDeepStrictEqual(this.dataCache, {});
        this.dataCache = {};
        return { applied: true, state: 'missing', changed };
      } else if (err instanceof SyntaxError) {
        // Invalid JSON - keep existing cache (atomic: no partial updates)
        this.readout(
          `Invalid JSON in ${this.dataFilePath}, keeping existing cache: ${err.message}`,
          'Data-Error'
        );
        return { applied: false, state: 'invalid', retryable: true, changed: false };
      } else {
        // Other errors - keep existing cache
        this.readout(
          `Error loading data file, keeping existing cache: ${err.message}`,
          'Data-Error'
        );
        return { applied: false, state: 'error', retryable: false, changed: false };
      }
    }

  } // loadDataFile

  // scheduleDataReload : debounce data reloads caused by file-system events
  scheduleDataReload() {

    if (this.dataReloadTimer) {
      clearTimeout(this.dataReloadTimer);
    }

    this.dataReloadTimer = setTimeout(async () => {
      this.dataReloadTimer = null;
      const result = await this.attemptDataReload();
      if (result.applied && result.changed) this.invalidateRouteCache('data-change');
    }, this.dataReloadDebounce);

  } // scheduleDataReload

  // watchDataFile : watch DATA_FILE with stat polling
  // Debounce: prevents multiple reloads during rapid edits (1s delay)
  // Retry: attemptDataReload() retries once on mid-write errors (500ms delay)
  // Path-based stat polling survives atomic-save and rsync rename-overwrite patterns
  async watchDataFile() {

    this.dataFileWatchStopped = false;

    if (this.dataFileWatchListener) {
      fsSync.unwatchFile(this.dataFilePath, this.dataFileWatchListener);
    }

    this.dataFileWatchListener = (current, previous) => {
      if (this.dataFileWatchStopped) {
        return;
      }

      const changed = current.mtimeMs !== previous.mtimeMs ||
        current.size !== previous.size ||
        current.ino !== previous.ino ||
        current.nlink !== previous.nlink;

      if (changed) {
        this.scheduleDataReload();
      }
    };

    this.dataFileWatcher = fsSync.watchFile(
      this.dataFilePath,
      { persistent: true, interval: this.dataFileWatchInterval },
      this.dataFileWatchListener
    );

    this.readout(`Watching data file path: ${this.dataFilePath}`, 'Data-Watch');

  } // watchDataFile

  // attemptDataReload : reload data with retry logic for mid-write scenarios
  async attemptDataReload(retryCount = 0) {

    this.readout('Data file changed, reloading...', 'Data-Watch');
    const result = await this.loadDataFile();

    // If a write was incomplete and retries remain, wait once and retry.
    if (!result.applied && result.retryable && retryCount < this.dataReloadMaxRetries && !this.shuttingDown) {
      try {
        await fs.access(this.dataFilePath);
        this.readout(`Retrying data reload (${retryCount + 1}/${this.dataReloadMaxRetries})...`, 'Data-Watch');
        await new Promise((resolve) => {
          this.dataReloadRetryResolve = resolve;
          this.dataReloadRetryTimer = setTimeout(() => {
            this.dataReloadRetryTimer = null;
            this.dataReloadRetryResolve = null;
            resolve();
          }, this.dataReloadRetryDelay);
        });
        if (this.shuttingDown) return result;
        return this.attemptDataReload(retryCount + 1);
      } catch (err) {
        this.readout('File no longer exists, skipping retry', 'Data-Watch');
      }
    }

    return result;

  } // attemptDataReload

  // stopWatchingDataFile : stop watching data file (cleanup)
  stopWatchingDataFile() {

    this.dataFileWatchStopped = true;

    if (this.dataFileWatchListener) {
      fsSync.unwatchFile(this.dataFilePath, this.dataFileWatchListener);
      this.dataFileWatchListener = null;
      this.readout('Stopped watching data file', 'Data-Watch');
    }
    this.dataFileWatcher = null;

    if (this.dataReloadTimer) {
      clearTimeout(this.dataReloadTimer);
      this.dataReloadTimer = null;
    }

    if (this.dataReloadRetryTimer) {
      clearTimeout(this.dataReloadRetryTimer);
      this.dataReloadRetryTimer = null;
    }
    if (this.dataReloadRetryResolve) {
      this.dataReloadRetryResolve();
      this.dataReloadRetryResolve = null;
    }

  } // stopWatchingDataFile

  // getDataCache : getter for data cache (encapsulation)
  getDataCache() {

    return this.dataCache;

  } // getDataCache

  // invalidateRouteCache : extension point implemented by WebServer
  invalidateRouteCache(reason = 'unspecified') {

    return 0;

  } // invalidateRouteCache

  // startChangeObservation : select one owner for DATA.json observation
  async startChangeObservation() {

    if (!this.mediaConfiguration) this.initializeMediaConfiguration();

    if (this.settings.enableRouteCache && this.settings.routeCacheWatch) {
      this.stopWatchingDataFile();
      this.spaceWatcher = new SpaceWatcher({
        rootPath: this.activeSpacePath,
        quietMs: this.settings.routeCacheQuietMs,
        maxBatchMs: this.settings.routeCacheMaxBatchMs,
        reconcileEnabled: this.settings.routeCacheReconcile,
        reconcileMs: this.settings.routeCacheReconcileMs,
        ignoredPaths: [this.mediaConfiguration.mediaRelativePath, '.altair'],
        onDirty: () => {},
        onUncertain: () => {
          this.routeCacheAdmissionSuspended = true;
        },
        onBatch: async ({ reason, rootChanged }) => {
          this.routeCacheAdmissionSuspended = true;
          const dataResult = await this.attemptDataReload();
          if (!dataResult.applied) return false;
          this.invalidateRouteCache(rootChanged ? 'active-space-root-change' : `kinetic-${reason}`);
          this.routeCacheAdmissionSuspended = false;
          return true;
        },
        readoutCallback: this.readout
      });
      await this.spaceWatcher.start();
      return;
    }

    if (this.settings.routeCacheReconcile) {
      console.warn('[Configuration] ROUTE_CACHE_RECONCILE requires ENABLE_ROUTE_CACHE=true and ROUTE_CACHE_WATCH=true; reconciliation is disabled');
    }
    if (this.settings.enableRouteCache && !this.settings.routeCacheWatch) {
      console.warn('[Route-Cache] Full-space watching is disabled; non-DATA changes require reloadActiveSpace() or SIGHUP');
    }
    if (this.settings.enableDataWatch) await this.watchDataFile();

  } // startChangeObservation

  // reloadActiveSpace : complete deployment-safe active-space refresh
  async reloadActiveSpace({ reason = 'manual' } = {}) {

    if (this.shuttingDown) return false;
    if (this.activeSpaceReloadPromise) return this.activeSpaceReloadPromise;
    this.activeSpaceReloadPromise = (async () => {
      this.routeCacheAdmissionSuspended = true;
      const dataResult = await this.attemptDataReload();
      if (!dataResult.applied || this.shuttingDown) return false;

      if (this.spaceWatcher) {
        const attached = await this.spaceWatcher.reattach(reason);
        if (!attached || this.shuttingDown) return false;
      }

      this.invalidateRouteCache(`active-space-reload-${reason}`);
      this.routeCacheAdmissionSuspended = false;
      return true;
    })();

    try {
      return await this.activeSpaceReloadPromise;
    } finally {
      this.activeSpaceReloadPromise = null;
    }

  } // reloadActiveSpace

  routeCacheLookupAllowed() {

    return !this.shuttingDown && !this.spaceWatcher?.uncertain;

  } // routeCacheLookupAllowed

  routeCacheAdmissionAllowed() {

    return this.routeCacheLookupAllowed() && !this.routeCacheAdmissionSuspended && !this.spaceWatcher?.dirty;

  } // routeCacheAdmissionAllowed

  initializeMediaConfiguration() {

    this.mediaConfiguration = resolveMediaConfiguration(this.settings);
    this.activeSpacePath = this.mediaConfiguration.activeSpacePath;
    this.publicPath = this.mediaConfiguration.publicPath;
    return this.mediaConfiguration;

  } // initializeMediaConfiguration

  mediaFallback(context) {

    if (!this.settings.mediaCdnFallback) return null;
    const method = context.req.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return null;
    const configuration = this.mediaConfiguration || this.initializeMediaConfiguration();
    const target = mediaRequestTarget(context.req.url, configuration.mediaUrlPrefix);
    if (!target) return null;
    const location = createMediaRedirectUrl(configuration.cdnBaseUrl, target);
    this.readout(`307 ${target.pathname}`, 'Media-CDN');
    return context.body(null, 307, {
      'Cache-Control': 'no-store',
      'Location': location
    });

  } // mediaFallback

  // start : start app
  async start() {

    this.initializeMediaConfiguration();

    // Load data before starting server
    const startupDataResult = await this.loadDataFile();
    if (!startupDataResult.applied && this.settings.enableRouteCache) {
      this.routeCacheAdmissionSuspended = true;
    }

    this.app.use('*', cors());
    this.app.use('*', serveStatic({ root: this.publicPath }));
    this.app.use('*', (context, next) => this.mediaFallback(context) || next());

    // Routes
    this.routes();

    // Start watching data file for changes (if enabled)
    await this.startChangeObservation();

    // Start listening
    const port = Number(process.env.PORT || this.settings.localPort);
    const hostname = process.env.HOST || '127.0.0.1';
    this.server = serve({ fetch: this.app.fetch, port, hostname }, (info) => {
      this.readout(`${this.settings.appName} ${this.settings.nodeEnv} server listening on ${hostname}:${info.port}`, 'Start');
      this.readout(`${this.settings.activeSpace}`, 'Space');
    }); // serve

    // Initialize WebSocket server if enabled
    if (this.settings.enableWebSocket) {
      this.wsServer = new WSServer(this.server, {
        path: this.settings.webSocketPath,
        heartbeatInterval: this.settings.webSocketHeartbeatMs,
        sessionTTL: this.settings.webSocketSessionTtlSecs * 1000,
        allowedOrigins: this.settings.webSocketAllowedOrigins,
        onMessage: (sessionId, message, ws) => this.onWsMessage(sessionId, message, ws)
      });
      this.readout(`WebSocket server initialized on ${this.settings.webSocketPath}`, 'WebSocket');
    }

    // Register cleanup handlers for graceful shutdown
    this.signalHandlers = {
      shutdown: () => void this.shutdown({ exitProcess: true }),
      reload: () => void this.reloadActiveSpace({ reason: 'sighup' })
    };
    process.on('SIGTERM', this.signalHandlers.shutdown);
    process.on('SIGINT', this.signalHandlers.shutdown);
    process.on('SIGHUP', this.signalHandlers.reload);

    return;

  } // start

  // shutdown : idempotently release all server and watcher resources
  async shutdown({ exitProcess = false } = {}) {

    if (this.shutdownPromise) return this.shutdownPromise;
    this.shuttingDown = true;
    this.routeCacheAdmissionSuspended = true;
    this.shutdownPromise = new Promise((resolve) => {
      this.readout('Shutting down...', 'Shutdown');
      this.stopWatchingDataFile();
      if (this.spaceWatcher) this.spaceWatcher.close();
      this.spaceWatcher = null;
      if (typeof this.closeRouteCache === 'function') this.closeRouteCache();
      if (this.wsServer) {
        this.wsServer.close();
        this.readout('WebSocket server closed', 'Shutdown');
      }

      if (this.signalHandlers) {
        process.off('SIGTERM', this.signalHandlers.shutdown);
        process.off('SIGINT', this.signalHandlers.shutdown);
        process.off('SIGHUP', this.signalHandlers.reload);
        this.signalHandlers = null;
      }

      const finish = () => {
        this.readout('HTTP server closed', 'Shutdown');
        resolve();
        if (exitProcess) process.exit(0);
      };
      if (this.server) this.server.close(finish);
      else finish();
    });
    return this.shutdownPromise;

  } // shutdown

  // routes : definitions (override as needed)
  routes() {

    return;

  } // routes

  // onWsMessage : WebSocket message handler (override as needed)
  // Called for all messages except built-in types (init, ping)
  onWsMessage(sessionId, message, ws) {

    return;

  } // onWsMessage

  // redirects : response
  redirects(statusCode, path, context) {

    this.readout(`${statusCode} ${path}`, 'Redirect');
    return context.redirect(path, statusCode);

  } // redirects

  // createErrorResponse : conservative response for framework-generated errors
  createErrorResponse(context, statusCode, body, { html = false, headers = {} } = {}) {

    const responseHeaders = {
      'Cache-Control': 'no-store',
      'Content-Type': html ? 'text/html; charset=UTF-8' : 'text/plain; charset=UTF-8',
      ...(html ? { 'X-Robots-Tag': 'noindex' } : {}),
      ...headers
    };
    const responseBody = context.req.method.toUpperCase() === 'HEAD' ? null : body;
    return context.body(responseBody, statusCode, responseHeaders);

  } // createErrorResponse

  // notFound : final safe 404 response (WebServer adds optional HTML error pages)
  notFound(context, { path: requestPath = context.req.path, reason = 'not-found' } = {}) {

    this.readout(
      `404 - path: ${this.safeLogValue(requestPath)} - reason: ${this.safeLogValue(reason)}`,
      'Not-Found'
    );
    return this.createErrorResponse(context, 404, 'Not Found');

  } // notFound

  // createErrorReference : opaque identifier safe to expose to a visitor
  createErrorReference() {

    return randomUUID();

  } // createErrorReference

  requestExpectsHTML(context) {

    const destination = (context.req.header('Sec-Fetch-Dest') || '').toLowerCase();
    if (destination === 'document' || destination === 'iframe') return true;
    return (context.req.header('Accept') || '').toLowerCase().includes('text/html');

  } // requestExpectsHTML

  safeLogValue(value) {

    return String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 1000);

  } // safeLogValue

  // logServerError : record internal detail against an opaque visitor-safe reference
  logServerError(error, {
    path: requestPath = '/',
    source = 'server',
    reference = this.createErrorReference()
  } = {}) {

    const message = error instanceof Error ? error.message : String(error || 'Unknown error');
    const safeMessage = this.safeLogValue(message);
    const safePath = this.safeLogValue(requestPath || '/');
    console.error(
      `[Server-Error] 500 path=${safePath} source=${source} reference=${reference} message=${safeMessage}`
    );
    return reference;

  } // logServerError

  // serverError : final safe 500 response (WebServer adds optional HTML error pages)
  serverError(context, error, {
    path: requestPath = context.req.path,
    source = 'server',
    reference = this.createErrorReference()
  } = {}) {

    this.logServerError(error, { path: requestPath, source, reference });
    return this.createErrorResponse(
      context,
      500,
      `Server Error\nReference: ${reference}`
    );

  } // serverError

} // HTTPServer

export default HTTPServer;
