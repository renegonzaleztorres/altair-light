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
MEDIA_LOCATION="media"
MEDIA_CDN_FALLBACK=false
MEDIA_CDN_BASE_URL=""
MEDIA_PUBLISH_ENABLED=false
MEDIA_PUBLISH_PROVIDER="s3-compatible"
MEDIA_PUBLISH_BUCKET=""
MEDIA_PUBLISH_ENDPOINT=""
MEDIA_PUBLISH_REGION=""
MEDIA_PUBLISH_FORCE_PATH_STYLE=false
MEDIA_PUBLISH_VERIFY_PUBLIC=false
MEDIA_PUBLISH_ACCESS_KEY_ID=""
MEDIA_PUBLISH_SECRET_ACCESS_KEY=""
MEDIA_PUBLISH_SESSION_TOKEN=""
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
- MEDIA_LOCATION — Managed media directory relative to PUBLIC_LOCATION (default `media`).
- MEDIA_CDN_FALLBACK — Redirect a missing local managed-media request to the configured CDN origin.
- MEDIA_CDN_BASE_URL — HTTPS public delivery origin used only by missing-media fallback.
- MEDIA_PUBLISH_ENABLED — Enables the explicit publisher command (default false).
- MEDIA_PUBLISH_PROVIDER — Publisher adapter (default and only v1 value: `s3-compatible`).
- MEDIA_PUBLISH_BUCKET / MEDIA_PUBLISH_ENDPOINT / MEDIA_PUBLISH_REGION — Remote storage destination.
- MEDIA_PUBLISH_FORCE_PATH_STYLE — Enable only when the provider requires path-style addressing (default false).
- MEDIA_PUBLISH_VERIFY_PUBLIC — Verify public CDN delivery after storage verification (default false).
- MEDIA_PUBLISH_ACCESS_KEY_ID / MEDIA_PUBLISH_SECRET_ACCESS_KEY / MEDIA_PUBLISH_SESSION_TOKEN — Provider-neutral publisher credentials; the session token is optional.
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

#### Media configuration reference

| Variable | Default | Accepted value and purpose |
| --- | --- | --- |
| `MEDIA_LOCATION` | `media` | Safe relative directory beneath `PUBLIC_LOCATION`; absolute paths, traversal, and private `_` segments are rejected. |
| `MEDIA_CDN_FALLBACK` | `false` | Boolean. Enables post-static-miss CDN redirects for safe media `GET` and `HEAD` requests. |
| `MEDIA_CDN_BASE_URL` | None | Public HTTPS origin without a path, query, fragment, or embedded credentials. Local HTTP is accepted only for localhost testing. |
| `MEDIA_PUBLISH_ENABLED` | `false` | Boolean. The publisher refuses to run unless enabled. |
| `MEDIA_PUBLISH_PROVIDER` | `s3-compatible` | Only v1 choice; covers AWS S3, Cloudflare R2, and compatible storage. |
| `MEDIA_PUBLISH_BUCKET` | None | Required bucket name. |
| `MEDIA_PUBLISH_ENDPOINT` | Empty | Empty selects standard AWS S3 endpoint resolution; otherwise set the provider's S3 API origin. |
| `MEDIA_PUBLISH_REGION` | None | Required AWS region, or `auto` for Cloudflare R2. |
| `MEDIA_PUBLISH_FORCE_PATH_STYLE` | `false` | Boolean. Enable only when required by the compatible provider. |
| `MEDIA_PUBLISH_VERIFY_PUBLIC` | `false` | Boolean. Performs an additional public `HEAD` check through `MEDIA_CDN_BASE_URL`. |
| `MEDIA_PUBLISH_ACCESS_KEY_ID` | None | Required media-publisher access-key ID. |
| `MEDIA_PUBLISH_SECRET_ACCESS_KEY` | None | Required media-publisher secret key. |
| `MEDIA_PUBLISH_SESSION_TOKEN` | Empty | Optional temporary-credential token. |

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
or cache-only-clear administration command. Managed media and `.altair`
publisher state are excluded from watcher events and reconciliation snapshots
because they do not alter cached HTML.

### HTTP Errors and Redirects

Altair uses conventional HTTP status semantics. `/` maps to
`pages/home.html` and returns `200` when it renders successfully. Missing HTML
pages, stylesheets, scripts, static files, and APIs return `404`; they are not
redirected to the homepage. Missing managed media also returns `404` unless its
explicit CDN fallback is enabled. Unexpected failures return `500` with an
opaque reference while internal error detail remains in the server log.

The starter kinetic space includes private `pages/_404.html` and
`pages/_500.html` files that sites may customize or remove. They use the normal
Altair template pipeline but retain their `404` or `500` status, bypass route
caching, and are never public pages. Framework error responses use
`Cache-Control: no-store`; HTML errors also use `X-Robots-Tag: noindex`.

Redirects are reserved for intentional application routes. Use `307` for a
temporary method-preserving redirect and `308` for a permanent one:

```js
additionalRoutes = () => {
  this.app.get('/old-about', (context) =>
    this.redirects(308, '/about', context)
  );
};
```

A site that deliberately wants unknown HTML pages sent to `/` can override the
narrow missing-page hook. The root guard prevents a loop if `home.html` is
missing; asset and API requests never use this hook:

```js
handleMissingPage(context, { path }) {
  if (path === '/') {
    return this.notFound(context, {
      path,
      reason: 'root-page-missing',
      resourceType: 'html'
    });
  }

  context.header('Cache-Control', 'no-store');
  return this.redirects(307, '/', context);
}
```

### Media Publishing and CDN Delivery

Keep stable provider-neutral references in content:

```html
<img src="/media/images/team.jpg" alt="Our team">
```

Save managed files beneath
`<ACTIVE_SPACE>/<PUBLIC_LOCATION>/<MEDIA_LOCATION>`. Media bytes are ignored by
Git; the verified manifest at
`<ACTIVE_SPACE>/.altair/media-publication.json` is retained as shared metadata.
If a project changes `PUBLIC_LOCATION` or `MEDIA_LOCATION`, it must also update
the concrete managed-media path in `.gitignore`.

For AWS S3:

```dotenv
MEDIA_PUBLISH_ENABLED=true
MEDIA_PUBLISH_PROVIDER="s3-compatible"
MEDIA_PUBLISH_BUCKET="site-media"
MEDIA_PUBLISH_ENDPOINT=""
MEDIA_PUBLISH_REGION="us-east-1"
MEDIA_PUBLISH_FORCE_PATH_STYLE=false
MEDIA_PUBLISH_VERIFY_PUBLIC=false
MEDIA_PUBLISH_ACCESS_KEY_ID=""
MEDIA_PUBLISH_SECRET_ACCESS_KEY=""
MEDIA_PUBLISH_SESSION_TOKEN=""
```

For Cloudflare R2, use the account S3 endpoint, region `auto`, and R2 API
credentials. Altair does not make a bucket public; configure a public custom
domain separately and place that origin in `MEDIA_CDN_BASE_URL`.

These credential names belong specifically to Altair media publishing and are
provider-neutral. They do not reuse the AWS SDK's global credential variables,
so unrelated AWS or Cloudflare integrations cannot be selected accidentally.

Preview and publish explicitly:

```sh
pnpm media:publish -- --dry-run
pnpm media:publish
pnpm media:publish -- --json
```

The command accepts common raster images, audio, video, and PDF content
recognized from its bytes, with a 20 GiB per-file v1 limit. SVG and executable
or unrecognized content are rejected. Files stream during hashing and upload;
local files are retained, and a missing local file never deletes its remote
object.

When fallback is enabled, normal local static serving runs first. A missing,
safe `GET` or `HEAD` under `/media/` receives a temporary `307` to the same CDN
path and query. Other missing resources retain normal `404` behavior. For
maximum production performance, route `/media/*` directly to the object store's
public delivery domain at Cloudflare or another edge provider so the request
never reaches Altair.

Publish and verify media before activating HTML or kinetic content that first
references it. Stable v1 object names use a conservative five-minute cache
policy; purge a provider cache after replacement when immediate propagation is
required.

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
