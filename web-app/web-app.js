/**
 * Web app
 */

import WebServer from '../altair/altair.js';

class WebApp extends WebServer{

  constructor() {

    super();

  } // constructor

  // Depending on the application, override any methods from WebServer such as routes, additionalRoutes, additionalVarDefinitions, etc.

  // additionalRoutes : override
  additionalRoutes = () => {
    
    return;

  } // additionalRoutes

  // additionalVarDefinitions : override
  additionalVarDefinitions = () => {

    let v = {};
    v.version = this.settings.version;
    v.ver = this.settings.version;
    v.appname = this.settings.appName;
    
    return v;

  } // additionalVarDefinitions

} // WebApp

export default WebApp;