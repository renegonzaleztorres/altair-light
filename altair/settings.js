/**
 * Settings
 *
 * Loads deployment environment variables before node-config, merges the
 * selected application configuration, validates framework settings, and
 * returns one immutable settings object for the process.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const require = createRequire(import.meta.url);
const defaultAppRootPath = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let loadedSettings = null;

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const envBoolean = (env, name, fallback) => {
  const value = env[name];
  if (value === undefined || value === '') {
    if (typeof fallback !== 'boolean') throw new Error(`${name} configuration must be boolean`);
    return fallback;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
};

const envInteger = (env, name, fallback, minimum, maximum) => {
  const value = env[name];
  const parsed = value === undefined || value === '' ? Number(fallback) : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
};

const envString = (env, name, fallback, { allowEmpty = false } = {}) => {
  const value = env[name];
  const resolved = value === undefined ? fallback : value;
  if (typeof resolved !== 'string' || (!allowEmpty && resolved.trim() === '')) {
    throw new Error(`${name} must be ${allowEmpty ? 'a string' : 'a non-empty string'}`);
  }
  return resolved;
};

const cookieNamePattern = /^[!#$%&'+\-.^_`|~0-9A-Za-z]+$/;

const ignoredCookiePatterns = (value) => {
  if (value === undefined || value === '') return [];
  if (typeof value !== 'string' && !Array.isArray(value)) {
    throw new Error('ROUTE_CACHE_IGNORED_COOKIES must be a comma-separated string or an array');
  }

  const values = Array.isArray(value) ? value : value.split(',');
  if (values.some((pattern) => typeof pattern !== 'string')) {
    throw new Error('ROUTE_CACHE_IGNORED_COOKIES patterns must be strings');
  }
  const patterns = values.map((pattern) => pattern.trim());
  if (patterns.length === 0 || patterns.some((pattern) => pattern === '')) {
    throw new Error('ROUTE_CACHE_IGNORED_COOKIES contains an empty pattern');
  }

  for (const pattern of patterns) {
    const name = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
    if (!name || !cookieNamePattern.test(name)) {
      throw new Error(
        'ROUTE_CACHE_IGNORED_COOKIES accepts cookie names and trailing-prefix patterns such as _ga_*'
      );
    }
  }

  return [...new Set(patterns)];
};

const deepFreeze = (value, seen = new WeakSet()) => {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
};

const createSettings = ({ applicationConfig = {}, env = process.env, appRootPath = defaultAppRootPath } = {}) => {
  if (!applicationConfig || typeof applicationConfig !== 'object' || Array.isArray(applicationConfig)) {
    throw new Error('Application configuration must be an object');
  }
  if (own(applicationConfig, 'localPort')) {
    throw new Error('config.localPort is no longer supported; set PORT in the environment');
  }

  const nodeEnv = envString(env, 'NODE_ENV', 'development');
  if (!/^[a-zA-Z0-9_-]+$/.test(nodeEnv)) {
    throw new Error('NODE_ENV may contain only letters, numbers, underscores, and hyphens');
  }

  const settings = {
    ...applicationConfig,
    nodeEnv,
    appName: envString(env, 'APP_NAME', applicationConfig.appName ?? 'altair-light'),
    host: envString(env, 'HOST', '127.0.0.1'),
    port: envInteger(env, 'PORT', 3000, 1, 65535),
    activeSpace: envString(env, 'ACTIVE_SPACE', applicationConfig.activeSpace ?? 'spaces/kinetic'),
    publicLocation: envString(env, 'PUBLIC_LOCATION', applicationConfig.publicLocation ?? 'public'),
    pagesLocation: envString(env, 'PAGES_LOCATION', applicationConfig.pagesLocation ?? 'pages'),
    mediaLocation: envString(env, 'MEDIA_LOCATION', applicationConfig.mediaLocation ?? 'media'),
    mediaCdnFallback: envBoolean(env, 'MEDIA_CDN_FALLBACK', applicationConfig.mediaCdnFallback ?? false),
    mediaCdnBaseUrl: envString(env, 'MEDIA_CDN_BASE_URL', applicationConfig.mediaCdnBaseUrl ?? '', { allowEmpty: true }),
    dataLocation: envString(env, 'DATA_LOCATION', applicationConfig.dataLocation ?? 'data'),
    dataFile: envString(env, 'DATA_FILE', applicationConfig.dataFile ?? 'DATA.json'),
    enableDataWatch: envBoolean(env, 'ENABLE_DATA_WATCH', applicationConfig.enableDataWatch ?? true),
    enableRouteCache: envBoolean(env, 'ENABLE_ROUTE_CACHE', applicationConfig.enableRouteCache ?? false),
    routeCacheMaxEntries: envInteger(env, 'ROUTE_CACHE_MAX_ENTRIES', applicationConfig.routeCacheMaxEntries ?? 250, 1, 10000),
    routeCacheWatch: envBoolean(env, 'ROUTE_CACHE_WATCH', applicationConfig.routeCacheWatch ?? true),
    routeCacheQuietMs: envInteger(env, 'ROUTE_CACHE_QUIET_MS', applicationConfig.routeCacheQuietMs ?? 250, 25, 5000),
    routeCacheMaxBatchMs: envInteger(env, 'ROUTE_CACHE_MAX_BATCH_MS', applicationConfig.routeCacheMaxBatchMs ?? 2000, 100, 30000),
    routeCacheReconcile: envBoolean(env, 'ROUTE_CACHE_RECONCILE', applicationConfig.routeCacheReconcile ?? false),
    routeCacheReconcileMs: envInteger(env, 'ROUTE_CACHE_RECONCILE_MS', applicationConfig.routeCacheReconcileMs ?? 30000, 5000, 3600000),
    routeCacheDebug: envBoolean(env, 'ROUTE_CACHE_DEBUG', applicationConfig.routeCacheDebug ?? false),
    routeCacheIgnoredCookies: ignoredCookiePatterns(
      env.ROUTE_CACHE_IGNORED_COOKIES ?? applicationConfig.routeCacheIgnoredCookies ?? ''
    ),
    minify: envBoolean(env, 'MINIFY', applicationConfig.minify ?? false),
    debug: envBoolean(env, 'DEBUG', applicationConfig.debug ?? false),
    enableWebSocket: envBoolean(env, 'ENABLE_WEBSOCKET', applicationConfig.enableWebSocket ?? false),
    webSocketPath: envString(env, 'WEBSOCKET_PATH', applicationConfig.webSocketPath ?? '/ws'),
    webSocketHeartbeatMs: envInteger(env, 'WEBSOCKET_HEARTBEAT_MS', applicationConfig.webSocketHeartbeatMs ?? 30000, 1000, 3600000),
    webSocketSessionTtlSecs: envInteger(env, 'WEBSOCKET_SESSION_TTL_SECS', applicationConfig.webSocketSessionTtlSecs ?? 3600, 1, 31536000),
    webSocketAllowedOrigins: envString(env, 'WEBSOCKET_ALLOWED_ORIGINS', applicationConfig.webSocketAllowedOrigins ?? '', { allowEmpty: true }),
    appRootPath
  };

  return deepFreeze(settings);
};

const loadSettings = ({ appRootPath = defaultAppRootPath } = {}) => {
  if (loadedSettings) return loadedSettings;
  dotenv.config();
  if (!process.env.NODE_ENV) process.env.NODE_ENV = 'development';

  // Deliberately delayed until after dotenv: node-config selects its files at
  // module evaluation time and is a process singleton.
  const config = require('config');
  const selectedEnvironment = config.util.getEnv('NODE_ENV');
  if (selectedEnvironment !== process.env.NODE_ENV) {
    throw new Error(
      `node-config selected ${selectedEnvironment} while NODE_ENV is ${process.env.NODE_ENV}; ` +
      'use NODE_ENV as the single environment selector'
    );
  }
  const applicationConfig = config.util.toObject();
  loadedSettings = createSettings({ applicationConfig, env: process.env, appRootPath });
  return loadedSettings;
};

export { createSettings, deepFreeze, loadSettings };
