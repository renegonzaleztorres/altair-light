/**
 * Constants
 */

import { path, fileURLToPath, dotenv, config } from './dependencies.js'

dotenv.config(); 

const envBoolean = (name, fallback) => {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  console.warn(`[Configuration] ${name} must be true or false; using ${fallback}`);
  return fallback;
};

const envInteger = (name, fallback, minimum, maximum) => {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum) return parsed;
  console.warn(
    `[Configuration] ${name} must be an integer from ${minimum} to ${maximum}; using ${fallback}`
  );
  return fallback;
};

const __fileName = fileURLToPath(import.meta.url);
const __dirName = path.dirname(__fileName);
const __appRootPath = path.dirname(__dirName);
const __version = config.get('version');
const __localPort = config.get('localPort');
const __NODE_ENV = process.env.NODE_ENV;
const __APP_NAME = process.env.APP_NAME;
const __ACTIVE_SPACE = process.env.ACTIVE_SPACE;
const __PUBLIC_LOCATION = process.env.PUBLIC_LOCATION;
const __PAGES_LOCATION = process.env.PAGES_LOCATION;
const __MEDIA_LOCATION = process.env.MEDIA_LOCATION || 'media';
const __MEDIA_CDN_FALLBACK = envBoolean('MEDIA_CDN_FALLBACK', false);
const __MEDIA_CDN_BASE_URL = process.env.MEDIA_CDN_BASE_URL || '';
const __DATA_LOCATION = process.env.DATA_LOCATION || '';
const __DATA_FILE = process.env.DATA_FILE || '';
const __ENABLE_DATA_WATCH = envBoolean('ENABLE_DATA_WATCH', true);
const __ENABLE_ROUTE_CACHE = envBoolean('ENABLE_ROUTE_CACHE', false);
const __ROUTE_CACHE_MAX_ENTRIES = envInteger('ROUTE_CACHE_MAX_ENTRIES', 250, 1, 10000);
const __ROUTE_CACHE_WATCH = envBoolean('ROUTE_CACHE_WATCH', true);
const __ROUTE_CACHE_QUIET_MS = envInteger('ROUTE_CACHE_QUIET_MS', 250, 25, 5000);
const __ROUTE_CACHE_MAX_BATCH_MS = envInteger('ROUTE_CACHE_MAX_BATCH_MS', 2000, 100, 30000);
const __ROUTE_CACHE_RECONCILE = envBoolean('ROUTE_CACHE_RECONCILE', false);
const __ROUTE_CACHE_RECONCILE_MS = envInteger('ROUTE_CACHE_RECONCILE_MS', 30000, 5000, 3600000);
const __ROUTE_CACHE_DEBUG = envBoolean('ROUTE_CACHE_DEBUG', false);
const __MINIFY = envBoolean('MINIFY', false);
const __DEBUG = envBoolean('DEBUG', false);

// WebSocket Configuration
const __ENABLE_WEBSOCKET = envBoolean('ENABLE_WEBSOCKET', false);
const __WEBSOCKET_PATH = process.env.WEBSOCKET_PATH || '/ws';
const __WEBSOCKET_HEARTBEAT_MS = parseInt(process.env.WEBSOCKET_HEARTBEAT_MS) || 30000;
const __WEBSOCKET_SESSION_TTL_SECS = parseInt(process.env.WEBSOCKET_SESSION_TTL_SECS) || 3600;
const __WEBSOCKET_ALLOWED_ORIGINS = process.env.WEBSOCKET_ALLOWED_ORIGINS || '';

export { __dirName, __appRootPath, __version, __localPort, __NODE_ENV, __APP_NAME, __ACTIVE_SPACE, __PUBLIC_LOCATION, __PAGES_LOCATION, __MEDIA_LOCATION, __MEDIA_CDN_FALLBACK, __MEDIA_CDN_BASE_URL, __DATA_LOCATION, __DATA_FILE, __ENABLE_DATA_WATCH, __ENABLE_ROUTE_CACHE, __ROUTE_CACHE_MAX_ENTRIES, __ROUTE_CACHE_WATCH, __ROUTE_CACHE_QUIET_MS, __ROUTE_CACHE_MAX_BATCH_MS, __ROUTE_CACHE_RECONCILE, __ROUTE_CACHE_RECONCILE_MS, __ROUTE_CACHE_DEBUG, __MINIFY, __DEBUG, __ENABLE_WEBSOCKET, __WEBSOCKET_PATH, __WEBSOCKET_HEARTBEAT_MS, __WEBSOCKET_SESSION_TTL_SECS, __WEBSOCKET_ALLOWED_ORIGINS };
