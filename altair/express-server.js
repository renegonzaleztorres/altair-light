/**
 * Express server
 */

import { express, cors, createServer, path } from './dependencies.js'
import Lib from './lib.js';

class ExpressServer extends Lib {

  constructor(){

    super();    
    this.app = express();
    this.server = null;
    this.publicPath = path.join(this.settings.appRootPath, this.settings.activeSpace, this.settings.publicLocation);

  } // constructor

  // start : start app
  start() {
    
    this.app.use(cors());
    this.app.use(express.static(this.publicPath));
    this.app.use(express.json());
    this.server = createServer(this.app);

    // Routes    
    this.routes();

    // Start listening
    let port = process.env.PORT || this.settings.localPort;
    this.server.listen(port, () => {  
      this.readout(`${this.settings.appName} ${this.settings.nodeEnv} server listening on *: ${port}`, 'Start');
      this.readout(`${this.settings.activeSpace}`, 'Space');
    }); // listen

    return;

  } // start

  // routes : definitions (override as needed)
  routes() {

    return;

  } // routes

  // redirects : response
  redirects(statusCode, path, res) {

    this.readout(`${statusCode} ${path}`, 'Redirect');
    res.status(statusCode).redirect(path);

    return;

  } // redirects

  // serverError : response
  serverError(res, errMessage, errRef, p) {

    this.readout(`500 - path: ${p} - message: ${errMessage} - ref: ${errRef}`, 'Server-Error');
    res.status(500).send('Server Error');

    return;

  } // serverError

} // ExpressServer

export default ExpressServer;