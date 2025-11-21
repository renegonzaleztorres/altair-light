/**
 * Web app
 */

import WebServer from '../altair/altair.js';

class WebApp extends WebServer{

  // Depending on the application, override any methods from WebServer such as routes, additionalRoutes, additionalVarDefinitions, etc.

  // additionalVarDefinitions : override
  additionalVarDefinitions = () => {

    let v = {};
    v.version = this.settings.version;
    v.ver = this.settings.version;

    return v;

  } // additionalVarDefinitions

} // WebApp*/

export default WebApp;