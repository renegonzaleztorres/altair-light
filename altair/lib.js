/**
 * Lib
 */

import * as __CONSTANTS from './constants.js';
const { __APP_NAME: appName, __NODE_ENV: nodeEnv, __ACTIVE_SPACE: activeSpace, __PUBLIC_LOCATION: publicLocation, __PAGES_LOCATION: pagesLocation, __MEDIA_LOCATION: mediaLocation, __MEDIA_CDN_FALLBACK: mediaCdnFallback, __MEDIA_CDN_BASE_URL: mediaCdnBaseUrl, __DATA_LOCATION: dataLocation, __DATA_FILE: dataFile, __ENABLE_DATA_WATCH: enableDataWatch, __ENABLE_ROUTE_CACHE: enableRouteCache, __ROUTE_CACHE_MAX_ENTRIES: routeCacheMaxEntries, __ROUTE_CACHE_WATCH: routeCacheWatch, __ROUTE_CACHE_QUIET_MS: routeCacheQuietMs, __ROUTE_CACHE_MAX_BATCH_MS: routeCacheMaxBatchMs, __ROUTE_CACHE_RECONCILE: routeCacheReconcile, __ROUTE_CACHE_RECONCILE_MS: routeCacheReconcileMs, __ROUTE_CACHE_DEBUG: routeCacheDebug, __MINIFY: minify, __DEBUG: debug, __appRootPath: appRootPath, __dirName: dirName, __localPort: localPort, __version: version, __ENABLE_WEBSOCKET: enableWebSocket, __WEBSOCKET_PATH: webSocketPath, __WEBSOCKET_HEARTBEAT_MS: webSocketHeartbeatMs, __WEBSOCKET_SESSION_TTL_SECS: webSocketSessionTtlSecs, __WEBSOCKET_ALLOWED_ORIGINS: webSocketAllowedOrigins } = __CONSTANTS;

class Lib {

  constructor() {

    this.settings = { appName, nodeEnv, activeSpace, publicLocation, pagesLocation, mediaLocation, mediaCdnFallback, mediaCdnBaseUrl, dataLocation, dataFile, enableDataWatch, enableRouteCache, routeCacheMaxEntries, routeCacheWatch, routeCacheQuietMs, routeCacheMaxBatchMs, routeCacheReconcile, routeCacheReconcileMs, routeCacheDebug, debug, minify, appRootPath, dirName, localPort, version, enableWebSocket, webSocketPath, webSocketHeartbeatMs, webSocketSessionTtlSecs, webSocketAllowedOrigins };

  } // constructor

  // trimSlashes : remove any number of leading and trailing slashes
  trimSlashes = (s) => {

    return s.replace(/^\/+/, '').replace(/\/+$/, ''); 

  } // trimSlashes

  // readout : log
  readout = (msg, tag) => {

    if (this.settings.debug)
      console.log(`[${tag}] ${msg}`);

    return;

  } // readout

  // Timestamp in ISO 8601 format (JSON UTC timestamp)
  nowToJSONDateUTC = () => {

    let d = new Date();

    return d.toISOString();

  } // nowToJSONDateUTC

  // flattenObject : recursively flatten nested object to underscore-separated lowercase keys
  flattenObject = (obj, prefix = '', result = {}) => {

    for (let key in obj) {
      if (obj.hasOwnProperty(key)) {
        const lowercaseKey = key.toLowerCase();
        const newKey = prefix ? `${prefix}_${lowercaseKey}` : lowercaseKey;
        const value = obj[key];

        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          // Recursively flatten nested objects
          this.flattenObject(value, newKey, result);
        } else if (Array.isArray(value)) {
          // Convert arrays to comma-separated strings
          result[newKey] = value.join(', ');
        } else {
          // Primitive values (string, number, boolean, null)
          result[newKey] = value;
        }
      }
    }

    return result;

  } // flattenObject

  // deepMerge : recursively merge source object into target object
  deepMerge = (target, source) => {

    const result = { ...target };

    for (let key in source) {
      if (source.hasOwnProperty(key)) {
        const sourceValue = source[key];
        const targetValue = result[key];

        if (sourceValue !== null && typeof sourceValue === 'object' && !Array.isArray(sourceValue) &&
            targetValue !== null && typeof targetValue === 'object' && !Array.isArray(targetValue)) {
          // Both are objects - recursively merge
          result[key] = this.deepMerge(targetValue, sourceValue);
        } else {
          // Primitive, array, or null - override
          result[key] = sourceValue;
        }
      }
    }

    return result;

  } // deepMerge

} // Lib

export default Lib;
