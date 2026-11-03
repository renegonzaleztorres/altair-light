// @ts-check
/**
 * My extension (template)
 *
 * Copy this folder to extensions/<name>/ (shared) or web-app/extensions/<name>/
 * (this site only), rename the files, and replace this description with what
 * the extension does. The contract is "Extension API" in altair/ARCHITECTURE.md.
 */

import { defineExtension } from '../../altair/extensions.js';

export const myExtension = defineExtension({
  name: 'my-extension',      // lowercase kebab-case, unique
  apiVersion: 1,             // extension API version this was written for
  configKey: 'myExtension',  // reads settings.extensions.myExtension; no block, no activation
  setup({ config, log }) {

    // Validate config here and throw on bad values; a missing setting means "do nothing"
    const { greeting } = config;
    if (greeting !== undefined && typeof greeting !== 'string') {
      throw new Error('extensions.myExtension.greeting must be a string');
    }
    log('ready');

    // Return only the hooks you need. Transforms and vars are route-cached:
    // they may depend only on path, content and config, never on the request.
    return {
      vars: () => (greeting === undefined ? {} : { greeting })
    };

  } // setup
});
