# Altair (module)

A super minimalist and efficient web server module.

**Altair** is a Node.js module that provides a super minimalist and efficient foundation for developing websites and web applications using Generative AI. Designed for flexibility and performance, it simplifies the creation of customizable web services, APIs, and more.

**Altair** uses Hono with its Node.js adapter for lightweight HTTP routing and middleware.

**Altair** includes optional WebSocket support via the `ws` package for real-time bidirectional communication.

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
DATA_LOCATION="data"
DATA_FILE="DATA.json"
ENABLE_DATA_WATCH=true
ENABLE_ROUTE_CACHE=false
ROUTE_CACHE_MAX_ENTRIES=250
ROUTE_CACHE_WATCH=true
ROUTE_CACHE_QUIET_MS=250
ROUTE_CACHE_MAX_BATCH_MS=2000
ROUTE_CACHE_RECONCILE=false
ROUTE_CACHE_RECONCILE_MS=30000
ROUTE_CACHE_DEBUG=false
MINIFY=true
DEBUG=true
HOST="127.0.0.1"
ENABLE_WEBSOCKET=false
WEBSOCKET_PATH="/ws"
WEBSOCKET_HEARTBEAT_MS=30000
WEBSOCKET_SESSION_TTL_SECS=3600
WEBSOCKET_ALLOWED_ORIGINS=""
```

- HOST — HTTP bind address. Defaults to `127.0.0.1` for local/loopback access only; recommended for production behind Nginx or another reverse proxy. Set to `0.0.0.0` only when all IPv4 interfaces must be reachable, such as in Docker, containers, VMs, or LAN development.
-	APP_NAME — Your project’s application name.
-	ACTIVE_SPACE — Path to the working “space” or directory where app files are "sourced" from.
-	PUBLIC_LOCATION — Directory under ACTIVE_SPACE that acts as the public root for static assets.
- PAGES_LOCATION — Subdirectory under ACTIVE_SPACE containing HTML pages that map to routes.
- DATA_LOCATION — Subdirectory under ACTIVE_SPACE containing DATA files
- DATA_FILE — JSON file containing data
- ENABLE_DATA_WATCH — If true, watch for changes and reload DATA_FILE
- ENABLE_ROUTE_CACHE — Enable lazy in-memory caching of core file-backed HTML routes (default false)
- ROUTE_CACHE_MAX_ENTRIES — Maximum route entries per process (default 250)
- ROUTE_CACHE_WATCH — Observe the complete active space and batch cache invalidation
- ROUTE_CACHE_QUIET_MS / ROUTE_CACHE_MAX_BATCH_MS — Filesystem event batch timing
- ROUTE_CACHE_RECONCILE — Enable optional periodic snapshot comparison
- ROUTE_CACHE_RECONCILE_MS — Reconciliation interval (default 30000; valid 5000–3600000)
- ROUTE_CACHE_DEBUG — Emit safe cache diagnostics
-	MINIFY — If true, CSS and JS assets will be minified during build or serve.
- DEBUG — If true, debug output will be printed to the console.
- ENABLE_WEBSOCKET — If true, start WebSocket server on the HTTP server.
- WEBSOCKET_PATH — WebSocket endpoint path (default: `/ws`).
- WEBSOCKET_HEARTBEAT_MS — Ping interval in ms for dead connection detection (default: `30000`).
- WEBSOCKET_SESSION_TTL_SECS — TTL in seconds for disconnected sessions (default: `3600`).
- WEBSOCKET_ALLOWED_ORIGINS — Origin policy: `""` reject all (default), `"*"` allow all, `"same-origin"`, or comma-separated whitelist.

### DATA.json (Data Cache)

Location: `{ACTIVE_SPACE}/{DATA_LOCATION}/{DATA_FILE}`

Environment-based JSON configuration with hot-reload capability:

```json
{
  "default": {
    "siteName": "My Site",
    "contact": {"email": "info@example.com"}
  },
  "production": {
    "assetsVersion": "1.0",
    "contact": {"email": "support@production.com"}
  }
}
```

**Features:**
- Merges `default` + `NODE_ENV` sections
- Nested objects flatten to variables: `contact.email` → `@@VAR_contact_email` (lowercase)
- Hot-reload: path-based stat polling detects in-place edits and atomic/rsync replacements (1s debounce, no server restart)
- Atomic swap: invalid JSON keeps existing cache (site stays functional)
- Access: `this.getDataCache()` in code, `@@VAR_*` in templates

**Use for:** Site content, contact info, environment-specific config (not secrets)

### Route Cache

The optional Route Cache stores final HTML bodies and ETags in the current
Node.js process. Entries are created only when requested, bounded by an LRU
limit, and cleared after accepted active-space changes. Concurrent cold
requests for the same route share one render. Query strings, cookies,
authorization, custom routes, errors, redirects, and request-time timestamp
variables bypass shared storage.

`ROUTE_CACHE_WATCH=true` selects the generalized active-space watcher whenever
the route cache is enabled. That watcher also reloads DATA.json, regardless of
`ENABLE_DATA_WATCH`, so there is exactly one DATA observer. Otherwise the
existing DATA path watcher remains available. `reloadActiveSpace()` and
`SIGHUP` provide a deployment backstop; there is intentionally no cache-list
or cache-only-clear administration command in version 3.2.0.

## Usage

Custom HTTP routes use Hono contexts and return Hono responses:

```js
additionalRoutes = () => {
  this.app.get('/api/health', (context) => context.json({ ok: true }));
};
```

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

## Architecture

- [Altair module architecture](ARCHITECTURE.md) — framework internals,
  rendering, caching, watching, lifecycle, and supported extension points
- [Application architecture](../ARCHITECTURE.md) — project-specific Altair
  integration, kinetic content, configuration choices, and deployment model

## License

[MIT](LICENSE)

MIT License © 2025 [Rene' A. Gonzalez Torres and Lisa Gray-Gonzalez]

## Astronomy

**Altair in the night sky**, designated as Alpha Aquilae, is a prominent star located in the constellation Aquila, known as the Eagle. It is the brightest star in this constellation and ranks as the twelfth brightest star in the night sky, with an apparent magnitude of 0.76. Altair is approximately 16.7 light-years from Earth.
