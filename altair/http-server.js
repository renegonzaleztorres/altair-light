/**
 * HTTP server
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { path, fs, fsSync } from './dependencies.js'
import { ExtensionRunner } from './extensions.js';
import Lib from './lib.js';
import { createMediaRedirectUrl, mediaRequestTarget, resolveMediaConfiguration } from './media-config.js';
import { loadSettings } from './settings.js';
import SpaceWatcher from './space-watcher.js';

class HTTPServer extends Lib {

  // extensions : applications list theirs with `static extensions = [...]` (see extensions.js)
  static extensions = [];

  constructor(options = {}){

    super(options);
    this.app = new Hono();
    this.app.notFound((context) => this.notFound(context, {
      path: context.req.path,
      reason: 'route-unmatched',
      resourceType: 'resource'
    }));
    this.app.onError((error, context) => error instanceof HTTPException && error.status < 500
      ? this.clientError(context, error)
      : this.serverError(context, error, {
        path: context.req.path,
        source: 'unhandled-route',
        resourceType: this.requestExpectsHTML(context) ? 'html' : 'resource'
      }));
    this.server = null;
    this.extensionRunner = null;
    this.wsServer = null;
    this.activeSpacePath = null;
    this.mediaConfiguration = null;
    this.publicPath = null;
    this.dataFilePath = null;
    this.runtimeSettingsInitialized = false;
    this.settingsReadyNotified = false;

    // Initialize data cache to empty object (backwards compatible)
    this.dataCache = {};

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

    if (this.settings) this.initializeRuntimeSettings();

  } // constructor

  initializeRuntimeSettings() {

    if (this.runtimeSettingsInitialized) return;
    this.activeSpacePath = path.join(this.settings.appRootPath, this.settings.activeSpace);
    this.publicPath = path.join(this.activeSpacePath, this.settings.publicLocation);
    this.dataFilePath = path.join(this.activeSpacePath, this.settings.dataLocation, this.settings.dataFile);
    this.runtimeSettingsInitialized = true;

  } // initializeRuntimeSettings

  initializeApplication() {

    return;

  } // initializeApplication

  onSettingsReady() {

    return;

  } // onSettingsReady

  // setupExtensions : create the runner once and await every configured extension's setup
  // (env defaults to process.env; tests may pass their own)
  async setupExtensions({ env } = {}) {

    if (!this.settings) this.settings = loadSettings();
    this.extensionRunner ??= new ExtensionRunner({
      extensions: this.constructor.extensions,
      settings: this.settings,
      readout: this.readout,
      invalidateRouteCache: (reason) => this.invalidateRouteCache(reason),
      listPages: () => this.listPublicPages(),
      getData: () => this.getDataCache(),
      env
    });
    await this.extensionRunner.setup();
    return this.extensionRunner;

  } // setupExtensions

  // listPublicPages : public page routes, implemented by WebServer
  async listPublicPages() {

    return [];

  } // listPublicPages

  initialize() {

    if (!this.settings) this.settings = loadSettings();
    this.initializeRuntimeSettings();
    this.initializeApplication();
    if (!this.settingsReadyNotified) {
      this.onSettingsReady();
      this.settingsReadyNotified = true;
    }

  } // initialize

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
      if (result.applied && result.changed) {
        this.invalidateRouteCache('data-change');
        await this.extensionRunner?.contentChanged({ reason: 'data-change' });
      }
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
        settings: this.settings,
        rootPath: this.activeSpacePath,
        ignoredPaths: [this.mediaConfiguration.mediaRelativePath, '.altair'],
        onDirty: () => {},
        onUncertain: () => {
          this.routeCacheAdmissionSuspended = true;
        },
        onBatch: async ({ reason, rootChanged }) => {
          this.routeCacheAdmissionSuspended = true;
          const dataResult = await this.attemptDataReload();
          if (!dataResult.applied) return false;
          const changeReason = rootChanged ? 'active-space-root-change' : `kinetic-${reason}`;
          this.invalidateRouteCache(changeReason);
          await this.extensionRunner?.contentChanged({ reason: changeReason });
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
      await this.extensionRunner?.contentChanged({ reason: `active-space-reload-${reason}` });
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

  // prepare : everything start() does before watching and listening; tests use it to serve requests without a port
  async prepare() {

    // Extensions are set up (in list order) before the application's onSettingsReady
    await this.setupExtensions();
    this.initialize();
    this.initializeMediaConfiguration();

    // Load data before starting server
    const startupDataResult = await this.loadDataFile();
    if (!startupDataResult.applied && this.settings.enableRouteCache) {
      this.routeCacheAdmissionSuspended = true;
    }

    this.app.use('*', cors());
    this.extensionRunner.mountMiddleware(this.app);
    this.app.use('*', serveStatic({ root: this.publicPath }));
    this.app.use('*', (context, next) => this.mediaFallback(context) || next());

    // Routes: extension routes take precedence over the application and core routes
    this.extensionRunner.mountRoutes(this.app);
    this.routes();
    return this;

  } // prepare

  // start : start app
  async start() {

    try {
      await this.prepare();

      // Start watching data file for changes (if enabled)
      await this.startChangeObservation();

      // Start listening and do not resolve until the socket is ready.
      await new Promise((resolve, reject) => {
        const onError = (error) => reject(error);
        this.server = serve({
          fetch: this.app.fetch,
          port: this.settings.port,
          hostname: this.settings.host
        }, (info) => {
          this.server.off('error', onError);
          this.readout(
            `${this.settings.appName} ${this.settings.nodeEnv} server listening on ${this.settings.host}:${info.port}`,
            'Start'
          );
          this.readout(`${this.settings.activeSpace}`, 'Space');
          resolve();
        });
        this.server.once('error', onError);
      });

      // Initialize WebSocket server if enabled
      if (this.settings.enableWebSocket) {
      const { WSServer } = await import('./websocket-server.js');
        this.wsServer = new WSServer(this.server, {
          settings: this.settings,
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

      return this;
    } catch (error) {
      await this.shutdown();
      throw error;
    }

  } // start

  // shutdown : idempotently release all server and watcher resources
  async shutdown({ exitProcess = false } = {}) {

    if (this.shutdownPromise) return this.shutdownPromise;
    this.shuttingDown = true;
    this.routeCacheAdmissionSuspended = true;
    // Extensions shut down first (reverse order), while watchers and the listener are still open
    const extensionsClosed = this.extensionRunner?.shutdown() ?? Promise.resolve();
    this.shutdownPromise = extensionsClosed.then(() => new Promise((resolve) => {
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
      if (this.server) {
        try {
          this.server.close(finish);
        } catch {
          finish();
        }
      } else finish();
    }));
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

  // clientError : 4xx rejection thrown by Hono middleware (csrf, bodyLimit, auth); keeps its status and headers
  clientError(context, error) {

    const response = error.getResponse();
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'text/plain; charset=UTF-8');
    this.readout(
      `${response.status} - path: ${this.safeLogValue(context.req.path)} - reason: request-rejected`,
      'Client-Error'
    );
    const body = context.req.method.toUpperCase() === 'HEAD' ? null : response.body;
    return new Response(body, { status: response.status, headers });

  } // clientError

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
