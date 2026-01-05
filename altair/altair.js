/**
 * Web server
 */

import { fs, path, minify, CleanCSS } from './dependencies.js'
import ExpressServer from './express-server.js';
import Tarazed from './tarazed.js';

class WebServer extends ExpressServer {

  constructor() {

    super();
    this.tarazed = new Tarazed({ appPath: path.join(this.settings.appRootPath, this.settings.activeSpace), readoutCallback: this.readout });

  } // constructor

  // routes : definitions (override when needed or override additionalRoutes() to add custom routes)
  routes = () => {

    // Root
    this.app.get('/', (req, res) => {
      this.readout(`path: ${req.path}`, 'Request-Root');
      this.renderHTML('home', res);
    });

    // CSS scripts
    this.app.get(/.*\.css$/, (req, res) => {
      this.readout(`path: ${req.path}`, 'Request-CSS');
      this.renderCSS(req.path, res);
    }); // get

    // JS scripts
    this.app.get(/.*\.js$/, (req, res) => {
      this.readout(`path: ${req.path}`, 'Request-JS');
      this.renderJS(req.path, res);
    }); // get

    // Additional routes definitions
    this.additionalRoutes();

    // HTML pages and "catch all"
    this.app.get('*', (req, res) => {
      this.readout(`path: ${req.path}`, 'Request-CatchAll');
      this.renderHTML(req.path, res);
    }); // get

    return;

  } // routes

  // additionalRoutes : definitions (override as needed)
  additionalRoutes = () => {
    
    return;

  } // additionalRoutes

  // renderHTML : render html pages
  renderHTML = async (p, res) => {

    try{
      if (!this.pageNameValidation(p)) { this.redirects(301, '/', res); return; }
      let filePath = path.join(this.settings.appRootPath, this.settings.activeSpace, this.settings.pagesLocation, (this.trimSlashes(p) + '.html'));
      let data = await fs.readFile(filePath, 'utf8'); // UTF-8: (8-bit Unicode Transformation Format)
      data = await this.tarazed.replaceElemTags(data);
      data = this.tarazed.replaceVarTags(data, this.varDefinitions({ currentPath: p }));
      if (this.settings.minify) // Remove html remarks, when specified
        data = data.replace(/<!--[\s\S]*?-->/g, '');
      res.type('text/html');
      res.send(data);
    }
    catch (err) {
      if (err.code === 'ENOENT') // “Error NO ENTry” or “No such file or directory”
        this.redirects(301, '/', res);
      else // Other errors
        this.serverError(res, err.message, 'renderHTML()', p);
    } // try

    return;

  } // renderHTML

  // renderCSS : render css scripts
  renderCSS = async (p, res) => {

    try {
      if (!this.pageNameValidation(p)) { this.redirects(301, '/', res); return; }
      let filePath = path.join(this.settings.appRootPath, this.settings.activeSpace, this.trimSlashes(p));
      let data = await fs.readFile(filePath, 'utf8'); // UTF-8: (8-bit Unicode Transformation Format)
      data = await this.tarazed.replaceElemTags(data);
      data = this.tarazed.replaceVarTags(data, this.varDefinitions({ currentPath: p }));
      if (this.settings.minify) { // Minify CSS, when specified
        let minified = new CleanCSS().minify(data);
        if (minified.errors && minified.errors.length > 0)
          throw new Error(`CSS minification error(s) > ${minified.errors.join(', ')}`);
        data = minified.styles;
      } // if
      res.type('text/css');
      res.send(data);
    }
    catch (err) {
      if (err.code === 'ENOENT') // “Error NO ENTry” or “No such file or directory”
        this.redirects(301, '/', res);
      else // Other errors
        this.serverError(res, err.message, 'renderCSS()', p);
    } // try

    return;

  } // renderCSS

  // renderJS : render js scripts
  renderJS = async (p, res) => {

    try{
      if (!this.pageNameValidation(p)) { this.redirects(301, '/', res); return; }
      let filePath = path.join(this.settings.appRootPath, this.settings.activeSpace, this.trimSlashes(p));
      let data = await fs.readFile(filePath, 'utf8'); // UTF-8: (8-bit Unicode Transformation Format)
      data = await this.tarazed.replaceElemTags(data);
      data = this.tarazed.replaceVarTags(data, this.varDefinitions({ currentPath: p }));
      if (this.settings.minify) { // Minify JS, when specified
        let minified = await minify(data);
        if (minified.error)
          throw new Error(`JS minification error(s) > ${minified.error.message}`);
        data = minified.code;
      } // if
      res.type('application/javascript');
      res.send(data);
    }
    catch (err) {
      if (err.code === 'ENOENT') // “Error NO ENTry” or “No such file or directory”
        this.redirects(301, '/', res);
      else // Other errors
        this.serverError(res, err.message, 'renderJS()', p);
    } // try

    return;

  } // renderJS

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

    return {
      year: new Date().getFullYear(),
      timestamp: this.nowToJSONDateUTC(),
      ts: this.nowToJSONDateUTC(),
      currentpath: currentPath,
      ...this.additionalVarDefinitions()
    };

  } // varDefinitions

  // additionalVarDefinitions : define an object containing any addditional "var" definitions (override as needed)
  additionalVarDefinitions = () => {

    let v = {};

    return v;

  } // additionalVarDefinitions

} // WebServer

export default WebServer;