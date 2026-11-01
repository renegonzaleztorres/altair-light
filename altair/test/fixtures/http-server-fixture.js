/**
 * Minimal HTTPServer fixture used by Altair's framework tests.
 *
 * This intentionally avoids the application's root index.js and WebApp class,
 * so custom application startup behavior cannot run during Altair tests.
 */

import HTTPServer from '../../http-server.js';

class TestHTTPServer extends HTTPServer {

  routes() {
    this.app.get('/', (context) => context.text('Altair HTTP test fixture'));
  }

}

const server = new TestHTTPServer();
await server.start();
