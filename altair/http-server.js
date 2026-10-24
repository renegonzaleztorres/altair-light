/**
 * HTTP server
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { path, fs, fsSync } from './dependencies.js'
import { WSServer } from './websocket-server.js';
import Lib from './lib.js';

class HTTPServer extends Lib {

  constructor(){

    super();
    this.app = new Hono();
    this.server = null;
    this.wsServer = null;
    
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
    this.dataReloadDebounce = 1000; // 1 second

    // Retry logic for mid-write scenarios
    this.dataReloadRetryDelay = 500; // 500ms
    this.dataReloadMaxRetries = 1; // Retry once

  } // constructor

  // loadDataFile : load data from JSON file into memory cache
  // Atomic swap: builds new cache first, only updates dataCache if parsing succeeds
  async loadDataFile() {

    try {
      const rawData = await fs.readFile(this.dataFilePath, 'utf8');
      const parsedData = JSON.parse(rawData);

      // Build new cache in temporary variable (atomic preparation)
      let newCache;
      if (parsedData.hasOwnProperty('default')) {
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

      // Atomic swap: only update if all parsing succeeded
      this.dataCache = newCache;
      return true;

    } catch (err) {
      if (err.code === 'ENOENT') {
        // File not found - reset to empty (backwards compatible)
        this.readout(
          `Data file not found at ${this.dataFilePath}, using empty cache`,
          'Data-Load'
        );
        this.dataCache = {};
        return false;
      } else if (err instanceof SyntaxError) {
        // Invalid JSON - keep existing cache (atomic: no partial updates)
        this.readout(
          `Invalid JSON in ${this.dataFilePath}, keeping existing cache: ${err.message}`,
          'Data-Error'
        );
        return false;
      } else {
        // Other errors - keep existing cache
        this.readout(
          `Error loading data file, keeping existing cache: ${err.message}`,
          'Data-Error'
        );
        return false;
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
      await this.attemptDataReload();
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
    const success = await this.loadDataFile();

    // If failed and retries available, check if file exists and retry
    if (!success && retryCount < this.dataReloadMaxRetries) {
      try {
        await fs.access(this.dataFilePath);
        // File exists, likely mid-write - retry after delay
        this.readout(`Retrying data reload (${retryCount + 1}/${this.dataReloadMaxRetries})...`, 'Data-Watch');
        if (this.dataReloadRetryTimer) {
          clearTimeout(this.dataReloadRetryTimer);
        }
        this.dataReloadRetryTimer = setTimeout(async () => {
          this.dataReloadRetryTimer = null;
          await this.attemptDataReload(retryCount + 1);
        }, this.dataReloadRetryDelay);
      } catch (err) {
        // File doesn't exist, don't retry
        this.readout('File no longer exists, skipping retry', 'Data-Watch');
      }
    }

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

  } // stopWatchingDataFile

  // getDataCache : getter for data cache (encapsulation)
  getDataCache() {

    return this.dataCache;

  } // getDataCache

  // start : start app
  async start() {

    // Load data before starting server
    await this.loadDataFile();

    this.app.use('*', cors());
    this.app.use('*', serveStatic({ root: this.publicPath }));

    // Routes
    this.routes();

    // Start watching data file for changes (if enabled)
    if (this.settings.enableDataWatch) {
      await this.watchDataFile();
    }

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
    const shutdown = () => {
      this.readout('Shutting down...', 'Shutdown');
      this.stopWatchingDataFile();
      if (this.wsServer) {
        this.wsServer.close();
        this.readout('WebSocket server closed', 'Shutdown');
      }
      this.server.close(() => {
        this.readout('HTTP server closed', 'Shutdown');
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    return;

  } // start

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

  // serverError : response
  serverError(context, errMessage, errRef, p) {

    this.readout(`500 - path: ${p} - message: ${errMessage} - ref: ${errRef}`, 'Server-Error');
    return context.text('Server Error', 500);

  } // serverError

} // HTTPServer

export default HTTPServer;
