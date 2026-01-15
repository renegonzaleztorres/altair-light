/**
 * Express server
 */

import { express, cors, createServer, path, fs, fsSync } from './dependencies.js'
import Lib from './lib.js';

class ExpressServer extends Lib {

  constructor(){

    super();
    this.app = express();
    this.server = null;
    
    // Construct public path (scoped to active space)
    this.publicPath = path.join(this.settings.appRootPath, this.settings.activeSpace, this.settings.publicLocation);

    // Initialize data cache to empty object (backwards compatible)
    this.dataCache = {};

    // Construct data file path (scoped to active space)
    this.dataFilePath = path.join(this.settings.appRootPath, this.settings.activeSpace, this.settings.dataLocation, this.settings.dataFile);

    // Track if file watching is active
    this.dataFileWatcher = null;

    // Debouncing timer for data reload
    this.dataReloadTimer = null;
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

  // watchDataFile : watch data file for changes and hot-reload with debouncing
  // Debounce: prevents multiple reloads during rapid edits (1s delay)
  // Retry: attemptDataReload() retries once on mid-write errors (500ms delay)
  async watchDataFile() {

    try {
      // Check if file exists before watching
      await fs.access(this.dataFilePath);

      // Start watching (fsSync.watch required, not available in fs/promises)
      this.dataFileWatcher = fsSync.watch(this.dataFilePath, (eventType) => {
        if (eventType === 'change' || eventType === 'rename') {
          // Debounce: clear existing timer, restart countdown
          if (this.dataReloadTimer) {
            clearTimeout(this.dataReloadTimer);
          }

          // Debounce: delay reload by 1s (multiple rapid saves = single reload)
          this.dataReloadTimer = setTimeout(async () => {
            await this.attemptDataReload(); // Retry once on mid-write errors
            this.dataReloadTimer = null;
          }, this.dataReloadDebounce);
        }
      });

      this.readout(`Watching data file: ${this.dataFilePath}`, 'Data-Watch');
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.readout(`Data file not found, skipping file watch`, 'Data-Watch');
      } else {
        this.readout(`Cannot watch data file: ${err.message}`, 'Data-Watch-Error');
      }
    }

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
        setTimeout(async () => {
          await this.loadDataFile();
        }, this.dataReloadRetryDelay);
      } catch (err) {
        // File doesn't exist, don't retry
        this.readout('File no longer exists, skipping retry', 'Data-Watch');
      }
    }

  } // attemptDataReload

  // stopWatchingDataFile : stop watching data file (cleanup)
  stopWatchingDataFile() {

    if (this.dataFileWatcher) {
      this.dataFileWatcher.close();
      this.dataFileWatcher = null;
      this.readout('Stopped watching data file', 'Data-Watch');
    }

    if (this.dataReloadTimer) {
      clearTimeout(this.dataReloadTimer);
      this.dataReloadTimer = null;
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

    this.app.disable('x-powered-by');
    this.app.use(cors());
    this.app.use(express.static(this.publicPath));
    this.app.use(express.json());
    this.server = createServer(this.app);

    // Routes
    this.routes();

    // Start watching data file for changes (if enabled)
    if (this.settings.enableDataWatch) {
      await this.watchDataFile();
    }

    // Start listening
    let port = process.env.PORT || this.settings.localPort;
    this.server.listen(port, () => {
      this.readout(`${this.settings.appName} ${this.settings.nodeEnv} server listening on *: ${port}`, 'Start');
      this.readout(`${this.settings.activeSpace}`, 'Space');
    }); // listen

    // Register cleanup handlers for graceful shutdown
    const shutdown = () => {
      this.stopWatchingDataFile();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    return;

  } // start

  // routes : definitions (override as needed)
  routes() {

    return;

  } // routes

  // redirects : response
  redirects(statusCode, path, res) {

    this.readout(`${statusCode} ${path}`, 'Redirect');
    res.status(statusCode).redirect(path);

    return;

  } // redirects

  // serverError : response
  serverError(res, errMessage, errRef, p) {

    this.readout(`500 - path: ${p} - message: ${errMessage} - ref: ${errRef}`, 'Server-Error');
    res.status(500).send('Server Error');

    return;

  } // serverError

} // ExpressServer

export default ExpressServer;