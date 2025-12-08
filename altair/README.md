# Altair (module)

A super minimalist and efficient web server module.

**Altair** is a Node.js module that provides a super minimalist and efficient foundation for developing websites and web applications using Generative AI. Designed for flexibility and performance, it simplifies the creation of customizable web services, APIs, and more.

**Altair** leverages the Express server package.

**Altair** project was started on March 25, 2024 by Rene' A. Gonzalez Torres and Lisa Gray-Gonzalez as part of the **Hummingbird Intent Adaptive** AI project.

Source code: https://github.com/renegonzaleztorres/altair-light.git

---

## Configuration

**Altair** uses `dotenv` and `config` for flexible, environment-based setup.

### Config File

You must create a `default.json` file in a `/config` directory.
At minimum, it should contain:

```json
{
  "version": "1.0.0",
  "localPort": 3000
}
```

-	"version" — a user-defined project version string.
-	"localPort" — any valid port number to use for local development.

### Environment Variables (.env)

Create a .env file in the root of the project.

```dotenv
NODE_ENV="development"
APP_NAME="altair-light"
ACTIVE_SPACE="spaces/kinetic"
PUBLIC_LOCATION="public"
PAGES_LOCATION="pages"
MINIFY=true
DEBUG=true
```

-	APP_NAME — Your project’s application name.
-	ACTIVE_SPACE — Path to the working “space” or directory where app files are "sourced" from.
-	PUBLIC_LOCATION — Directory under ACTIVE_SPACE that acts as the public root for static assets.
- PAGES_LOCATION — Subdirectory under ACTIVE_SPACE containing HTML pages that map to routes.
-	MINIFY — If true, CSS and JS assets will be minified during build or serve.
- DEBUG — If true, debug output will be printed to the console.

## Usage

### Case 1

main.js

```js
import WebServer from '../altair/altair.js';

const wa = new WebServer();
wa.start();
```

### Case 2

web-app/web-app.js

```js
import WebServer from '../altair/altair.js';

class WebApp extends WebServer{

  constructor() {

    super();

  } // constructor

  // Depending on the application, override any methods from WebServer such as routes, additionalRoutes, etc.

} // WebApp

export default WebApp;
```

web-app/main.js

```js
import WebApp from './web-app.js';

export const main = () => {

    // Start web app
    const wa = new WebApp();
    wa.start();

    return;

}; // main
```

index.js

```js
'use strict';

import { main } from './web-app/main.js';

main();
```

## License

[MIT](LICENSE)

MIT License © 2025 [Rene' A. Gonzalez Torres and Lisa Gray-Gonzalez]

## Astronomy

**Altair in the night sky**, designated as Alpha Aquilae, is a prominent star located in the constellation Aquila, known as the Eagle. It is the brightest star in this constellation and ranks as the twelfth brightest star in the night sky, with an apparent magnitude of 0.76. Altair is approximately 16.7 light-years from Earth.