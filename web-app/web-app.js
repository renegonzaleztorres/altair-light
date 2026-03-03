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
    v.assetsversion = this.nowToJSONDateUTC();
    
    return v;

  } // additionalVarDefinitions

  // applyGlobalReplacements : sample override (uncomment and adapt when needed)
  // applyGlobalReplacements = async ({ content, type, routePath } = {}) => {
  //
  //   if (typeof content !== 'string' || content.length === 0)
  //     return content;
  //
  //   // Example: multiple global replacements, scoped to HTML responses only
  //   if (type === 'html') {
  //     const replacements = [
  //       [/\/images\//g, 'https://cdn.example.com/images/'],
  //       [/\/css\//g, 'https://cdn.example.com/css/'],
  //       [/\/js\//g, 'https://cdn.example.com/js/']
  //     ];
  //     let output = content;
  //     for (const [pattern, replacement] of replacements) {
  //       output = output.replace(pattern, replacement);
  //     }
  //     return output;
  //   }
  //
  //   return content;
  //
  // } // applyGlobalReplacements

} // WebApp

export default WebApp;
