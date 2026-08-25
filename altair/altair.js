/**
 * Web server
 */

import { fs, path, minify, CleanCSS } from './dependencies.js'
import HTTPServer from './http-server.js';
import Tarazed from './tarazed.js';

class WebServer extends HTTPServer {

  constructor() {

    super();
    this.tarazed = new Tarazed({ appPath: path.join(this.settings.appRootPath, this.settings.activeSpace), readoutCallback: this.readout });

  } // constructor

  // routes : definitions (override when needed or override additionalRoutes() to add custom routes)
  routes = () => {

    // Root
    this.app.get('/', (context) => {
      this.readout(`path: ${context.req.path}`, 'Request-Root');
      return this.renderHTML('home', context);
    });

    // CSS and JS scripts
    this.app.get('*', (context, next) => {
      const requestPath = context.req.path;
      if (requestPath.endsWith('.css')) {
        this.readout(`path: ${requestPath}`, 'Request-CSS');
        return this.renderCSS(requestPath, context);
      }
      if (requestPath.endsWith('.js')) {
        this.readout(`path: ${requestPath}`, 'Request-JS');
        return this.renderJS(requestPath, context);
      }
      return next();
    }); // get

    // Additional routes definitions
    this.additionalRoutes();

    // HTML pages and "catch all"
    this.app.get('*', (context) => {
      this.readout(`path: ${context.req.path}`, 'Request-CatchAll');
      return this.renderHTML(context.req.path, context);
    }); // get

    return;

  } // routes

  // additionalRoutes : definitions (override as needed)
  additionalRoutes = () => {
    
    return;

  } // additionalRoutes

  // renderHTML : render html pages
  renderHTML = async (p, context) => {

    try{
      if (!this.pageNameValidation(p)) return this.redirects(301, '/', context);
      let filePath = path.join(this.settings.appRootPath, this.settings.activeSpace, this.settings.pagesLocation, (this.trimSlashes(p) + '.html'));
      let data = await fs.readFile(filePath, 'utf8'); // UTF-8: (8-bit Unicode Transformation Format)
      data = await this.tarazed.replaceElemTags(data);
      data = await this.tarazed.replaceRepeatTags(data);
      data = await this.tarazed.replaceDataTags(data);
      data = this.tarazed.replaceVarTags(data, this.varDefinitions({ currentPath: p }));
      if (this.settings.minify) // Remove html remarks, when specified
        data = data.replace(/<!--[\s\S]*?-->/g, '');
      data = await this.applyGlobalReplacements({ content: data, type: 'html', routePath: p });
      return context.html(data);
    }
    catch (err) {
      if (err.code === 'ENOENT') // “Error NO ENTry” or “No such file or directory”
        return this.redirects(301, '/', context);
      else // Other errors
        return this.serverError(context, err.message, 'renderHTML()', p);
    } // try

    return;

  } // renderHTML

  // renderCSS : render css scripts
  renderCSS = async (p, context) => {

    try {
      if (!this.pageNameValidation(p)) return this.redirects(301, '/', context);
      let filePath = path.join(this.settings.appRootPath, this.settings.activeSpace, this.trimSlashes(p));
      let data = await fs.readFile(filePath, 'utf8'); // UTF-8: (8-bit Unicode Transformation Format)
      data = await this.tarazed.replaceElemTags(data);
      data = await this.tarazed.replaceRepeatTags(data);
      data = await this.tarazed.replaceDataTags(data);
      data = this.tarazed.replaceVarTags(data, this.varDefinitions({ currentPath: p }));
      if (this.settings.minify) { // Minify CSS, when specified
        let minified = new CleanCSS().minify(data);
        if (minified.errors && minified.errors.length > 0)
          throw new Error(`CSS minification error(s) > ${minified.errors.join(', ')}`);
        data = minified.styles;
      } // if
      data = await this.applyGlobalReplacements({ content: data, type: 'css', routePath: p });
      return context.body(data, 200, { 'Content-Type': 'text/css; charset=UTF-8' });
    }
    catch (err) {
      if (err.code === 'ENOENT') // “Error NO ENTry” or “No such file or directory”
        return this.redirects(301, '/', context);
      else // Other errors
        return this.serverError(context, err.message, 'renderCSS()', p);
    } // try

    return;

  } // renderCSS

  // renderJS : render js scripts
  renderJS = async (p, context) => {

    try{
      if (!this.pageNameValidation(p)) return this.redirects(301, '/', context);
      let filePath = path.join(this.settings.appRootPath, this.settings.activeSpace, this.trimSlashes(p));
      let data = await fs.readFile(filePath, 'utf8'); // UTF-8: (8-bit Unicode Transformation Format)
      data = await this.tarazed.replaceElemTags(data);
      data = await this.tarazed.replaceRepeatTags(data);
      data = await this.tarazed.replaceDataTags(data);
      data = this.tarazed.replaceVarTags(data, this.varDefinitions({ currentPath: p }));
      if (this.settings.minify) { // Minify JS, when specified
        let minified = await minify(data);
        if (minified.error)
          throw new Error(`JS minification error(s) > ${minified.error.message}`);
        data = minified.code;
      } // if
      data = await this.applyGlobalReplacements({ content: data, type: 'js', routePath: p });
      return context.body(data, 200, { 'Content-Type': 'application/javascript; charset=UTF-8' });
    }
    catch (err) {
      if (err.code === 'ENOENT') // “Error NO ENTry” or “No such file or directory”
        return this.redirects(301, '/', context);
      else // Other errors
        return this.serverError(context, err.message, 'renderJS()', p);
    } // try

    return;

  } // renderJS

  // applyGlobalReplacements : final content replacement hook (override as needed)
  applyGlobalReplacements = async ({ content, type, routePath } = {}) => {
    if (typeof content !== 'string' || content.length === 0)
      return content;

    return content;

  } // applyGlobalReplacements

  // pageNameValidation : validate the page|script name
  pageNameValidation = (p) => {

    let path = this.trimSlashes(p);
    let a = path.split('/');
    let fileName = a[a.length - 1];
    if (fileName.trim() === '' || fileName.charAt(0) === '_') // File name cannot be empty or start with _
      return false;

    return true;

  } // pageNameValidation

  // varDefinitions : define an object containing some standard "var" definitions
  varDefinitions = ({ currentPath, ...otherProps } = {}) => {

    // Normalize 'home' to '/'
    if (currentPath === 'home') {
      currentPath = '/';
    }

    // Flatten dataCache for use in template variables (original structure preserved in memory)
    const flattenedDataCache = this.flattenObject(this.getDataCache());

    return {
      year: new Date().getFullYear(),
      timestamp: this.nowToJSONDateUTC(),
      ts: this.nowToJSONDateUTC(),
      currentpath: currentPath,
      ...this.additionalVarDefinitions(),
      ...flattenedDataCache
    };

  } // varDefinitions

  // additionalVarDefinitions : define an object containing any addditional "var" definitions (override as needed)
  additionalVarDefinitions = () => {

    let v = {};

    return v;

  } // additionalVarDefinitions

} // WebServer

export default WebServer;
