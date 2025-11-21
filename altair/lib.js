/**
 * Lib
 */

import * as __CONSTANTS from './constants.js';
const { __APP_NAME: appName, __NODE_ENV: nodeEnv, __ACTIVE_SPACE: activeSpace, __PUBLIC_LOCATION: publicLocation, __PAGES_LOCATION: pagesLocation, __MINIFY: minify, __DEBUG: debug, __appRootPath: appRootPath, __dirName: dirName, __localPort: localPort, __version: version } = __CONSTANTS;

class Lib {

  constructor() {

    this.settings = { appName, nodeEnv, activeSpace, publicLocation, pagesLocation, debug, minify, appRootPath, dirName, localPort, version };

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

} // Lib

export default Lib;