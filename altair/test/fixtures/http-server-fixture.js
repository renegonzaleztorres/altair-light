/**
 * Minimal HTTPServer fixture used by Altair's framework tests.
 *
 * This intentionally avoids the application's root index.js and WebApp class,
 * so custom application startup behavior cannot run during Altair tests.
 */

import HTTPServer from '../../http-server.js';

class TestHTTPServer extends HTTPServer {

  constructor() {
    super();
    this.settings.appName = 'altair-http-test';
    this.settings.enableDataWatch = false;
    this.settings.enableWebSocket = false;
    this.settings.debug = true;
  }

  routes() {
    this.app.get('/', (context) => context.text('Altair HTTP test fixture'));
  }

}

const server = new TestHTTPServer();
await server.start();
