/**
 * Lib
 */

import { deepFreeze } from './settings.js';

class Lib {

  constructor({ settings = null } = {}) {

    this.settings = settings ? deepFreeze(settings) : null;

  } // constructor

  // trimSlashes : remove any number of leading and trailing slashes
  trimSlashes = (s) => {

    return s.replace(/^\/+/, '').replace(/\/+$/, ''); 

  } // trimSlashes

  // readout : log
  readout = (msg, tag) => {

    if (this.settings?.debug)
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
