# Altair Module Architecture

| Metadata | Value |
| --- | --- |
| Altair version | 3.4.0 |
| Document owner | `altair/` module |
| Purpose | Canonical framework architecture and LLM agent reference |
| Application architecture | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) |

This document is versioned with the reusable Altair module. It describes
framework internals, supported extension points, rendering, caching, watching,
configuration, and framework tests. Application-specific decisions and custom
implementations belong in the repository-root `ARCHITECTURE.md`.

---

## Executive Summary

Minimalist Node.js web server framework for AI-assisted development:
- **File-based routing** - HTML files in `pages/` map to routes
- **Component system** - Reusable HTML/CSS/JS via template tags
- **Template engine (Tarazed)** - Five tag types: `@@ELEM_`, `@@REPEAT_`, `@@PARAM_`, `@@DATA_`, `@@VAR_`
- **Data cache (DATA.json)** - Environment-based config with hot-reload, variables auto-injected
- **Route cache** - Optional, bounded in-memory cache for public file-backed HTML
- **Conventional HTTP errors** - Real `404`/`500` responses and optional private error pages
- **Media publishing** - Explicit verified S3/R2 publication with stable `/media/...` URLs
- **On-demand processing** - No build step; templates processed on cache misses
- **Space-based** - Multiple projects in isolated `spaces/` directories
- **Small core** - Built-in Node.js primitives and no added cache dependency

**Philosophy:** Fork, configure, prompt AI to generate, build using conventions.

---

## Getting Started

### Prerequisites
- Node.js >= 24 < 25
- pnpm 12.8.1 (pinned by `packageManager` in `package.json`)
- `pnpm install`

The pnpm pin is an application-level toolchain choice rather than an Altair
runtime requirement. Forks inherit 12.8.1 as the recommended default, but may
select another Node-compatible pnpm version. A changed pin must be accompanied
by a lockfile verified or regenerated with that version and a successful test
run.

### Setup Steps

**1. Create `.env`** (project root):
```dotenv
NODE_ENV="development"
APP_NAME="MyApp"
ACTIVE_SPACE="spaces/kinetic"
PUBLIC_LOCATION="public"
PAGES_LOCATION="pages"
MEDIA_LOCATION="media"
MEDIA_CDN_FALLBACK=false
MEDIA_CDN_BASE_URL=""
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
MINIFY=false
DEBUG=true
HOST="127.0.0.1"
```

**2. Verify `config/default.json`**:
```json
{"version": "1.0.0", "localPort": 3000}
```

**3. Create minimum files** (in order):

`spaces/kinetic/globals/_header.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>@@VAR_APPNAME</title>
  <link href="/css/styles.css" rel="stylesheet">
</head>
<body>
  <header><h1>@@VAR_APPNAME</h1></header>
  <main>
```

`spaces/kinetic/globals/_footer.html`:
```html
  </main>
  <footer><p>© @@VAR_YEAR</p></footer>
  <script src="/js/scripts.js"></script>
</body>
</html>
```

`spaces/kinetic/pages/home.html`:
```html
@@ELEM_globals/_header.html
  <h1>Welcome</h1>
@@ELEM_globals/_footer.html
```

`spaces/kinetic/css/styles.css`: `body { font-family: system-ui; }`
`spaces/kinetic/js/scripts.js`: `console.log('App loaded');`

`spaces/kinetic/data/DATA.json` (optional):
```json
{
  "default": {
    "siteName": "MyApp",
    "tagline": "Built with Altair",
    "contact": {"email": "hello@example.com"}
  },
  "production": {
    "contact": {"email": "support@example.com"}
  }
}
```

**4. Start:** `pnpm start` → `http://localhost:3000`

---

## Class Hierarchy

```
Lib → HTTPServer → WebServer → WebApp
```

### Key Classes

**Lib** (`altair/lib.js`): Base utilities
- `this.settings` - Config object (appName, activeSpace, debug, minify, etc.)
- `trimSlashes(s)`, `readout(msg, tag)`, `nowToJSONDateUTC()`

**HTTPServer** (`altair/http-server.js`): Hono and Node.js HTTP setup
- `this.app` - Hono instance
- `this.dataCache` - In-memory cache from DATA.json (access via `getDataCache()`)
- `start()` - Loads DATA.json, sets up CORS, static files, routes, WebSockets, and listening
- `loadDataFile()` - Atomically loads DATA.json and returns a structured applied/changed result
- `reloadActiveSpace()` - Reloads DATA, refreshes watcher state, and invalidates routes
- `getDataCache()` - Returns dataCache object
- `redirects()`, `notFound()`, `serverError()`, `createErrorResponse()`
- `initializeMediaConfiguration()`, `mediaFallback()`

**WebServer** (`altair/altair.js`): Routing & rendering
- `this.tarazed` - Template engine instance
- `routes()` - `GET /` → home, `GET *.css` → CSS, `GET *.js` → JS, `GET *` → HTML
- `renderHTML(p, context)` - Apply cache eligibility, lookup/coalescing, rendering, and response construction
- `renderHTMLBody(p)` - Process `@@ELEM_`, `@@REPEAT_`, `@@DATA_`, `@@VAR_`, minification, and global replacements
- `renderCSS(p, context)` - Read CSS, process tags, minify with CleanCSS
- `renderJS(p, context)` - Read JS, process tags, minify with Terser
- `pageNameValidation(p)` - Rejects traversal, malformed paths, and underscore-prefixed segments
- `handleMissingPage()` - Application policy hook for missing HTML pages only
- `renderErrorPage()` - Optional private `_404.html`/`_500.html` rendering outside the route cache
- `varDefinitions()` - Returns {year, timestamp, ts, currentpath} + additionalVarDefinitions() + flattened DATA.json vars
- `additionalVarDefinitions()` - Override for custom variables
- `additionalRoutes()` - Override for custom routes

**WebApp** (`web-app/web-app.js`): Application customization
- Extends WebServer
- `additionalVarDefinitions()` - Adds version, ver, appname

**Tarazed** (`altair/tarazed.js`): Template engine
- `replaceElemTags(s)` - Process `@@ELEM_path;{"param":"value"}` (async, recursive)
- `replaceRepeatTags(s)` - Process `@@REPEAT_componentPath;dataPath#arrayPath;{"Param":"item.path"}` (async)
- `replaceDataTags(s)` - Process `@@DATA_path/file.json#key.path?modifiers` (async)
- `replaceVarTags(s, vD)` - Process `@@VAR_name` (case-insensitive)
- `replaceParamTags(s, params)` - Process `@@PARAM_Name` (case-sensitive)
- **Processing order:** 1) Elements (recursive, with params), 2) Repeat tags, 3) Data tags, 4) Variables

**Media publisher** (`altair/media-publisher.js`, CLI-only):
- Derives media and manifest paths from the selected active space
- Streams inspection and SHA-256 hashing, classifies changes, and atomically writes verified state
- Retains local and remote-only objects; never infers deletion

**S3-compatible adapter** (`altair/media-provider-s3.js`, CLI-only):
- Dynamically loaded by `media-publisher-cli.js`, never by the HTTP server
- Uses bounded multipart uploads and verifies remote size, type, and SHA-256 metadata
- Supports AWS S3 and Cloudflare R2 configuration

---

## Request Flow

**Startup:** `index.js` → `main.js::main()` → `new WebApp()` → `wa.start()`

**HTML Request:** Route → `renderHTML()` → Validate → Read file → `replaceElemTags()` (recursive) → `replaceRepeatTags()` → `replaceDataTags()` → `replaceVarTags()` → Minify comments (optional) → `applyGlobalReplacements()` → Send

With Route Cache enabled, the HTML flow becomes: eligibility check → cache
lookup → ETag comparison → cached `200`/`304`, or one coalesced
`renderHTMLBody()` call on a miss → generation-safe storage → response.

**CSS Request:** Route → `renderCSS()` → Validate → Read → `replaceElemTags()` → `replaceRepeatTags()` → `replaceDataTags()` → `replaceVarTags()` → Minify (CleanCSS, optional) → `applyGlobalReplacements()` → Send

**JS Request:** Route → `renderJS()` → Validate → Read → `replaceElemTags()` → `replaceRepeatTags()` → `replaceDataTags()` → `replaceVarTags()` → Minify (Terser, optional) → `applyGlobalReplacements()` → Send

**Media Request:** static `PUBLIC_LOCATION` lookup → local media response when
present → optional safe `307` to `MEDIA_CDN_BASE_URL` after a miss → normal
3.3+ `404` when fallback is disabled or the request is ineligible. Only `GET`
and `HEAD` under the normalized media namespace can use fallback; queries are
preserved. Altair never proxies remote media bytes.

### Error and Redirect Flow

- `/` explicitly renders `pages/home.html` and returns `200` or a cached `304`.
- Missing, invalid, or private HTML routes call `handleMissingPage()` and return
  `404` by default.
- Missing CSS, JavaScript, static files, and API paths return `404` directly;
  they do not use the HTML hook. Missing managed media returns `404` unless the
  explicit CDN fallback is enabled.
- Unexpected renderer or application exceptions reach `serverError()` and
  return `500` with an opaque UUID reference. Internal details are logged but
  never included in the visitor response.
- Optional private `pages/_404.html` and `pages/_500.html` files are processed
  through Tarazed on demand. They retain the error status, are marked
  `no-store` and `noindex`, and never enter the route cache. If an error page
  fails, Altair immediately uses a dependency-free fallback without recursion.
- Error responses omit bodies for `HEAD`. Redirects remain available only
  through explicit application decisions; `307` and `308` are recommended.

An application may override `handleMissingPage(context, { path, reason })` to
return a `307` redirect to `/` for unknown HTML pages. Such an override must
return a real `404` when `path === '/'` to avoid a missing-home loop. The hook
cannot affect assets, APIs, or server failures.

Path resolution remains contained within the configured active-space or pages
directory. Every route segment beginning with `_` is private, and malformed or
traversal paths receive `404` without disclosing whether a file exists.

Tarazed lookup failures inside otherwise valid templates retain their existing
`'UNDEFINED'` behavior.

## Route Cache and Active-Space Freshness

`RenderCache` (`altair/render-cache.js`) is process-local and stores only final
HTML strings plus weak ETags. A `Map` provides lazy creation and LRU ordering;
another temporary `Map` coalesces concurrent misses. A monotonically increasing
generation prevents a render begun before invalidation from repopulating the
cache. The first lookup after the local New Year boundary invalidates once so
`@@VAR_YEAR` remains current.

Only core file-backed `GET`/`HEAD` pages without a query delimiter, Cookie, or
Authorization header are eligible. Timestamp variables, custom routes,
redirects, and errors bypass shared storage. Cached responses use
`Cache-Control: no-cache` and an ETag, so clients may store them but must
revalidate before reuse.

`SpaceWatcher` (`altair/space-watcher.js`) observes the complete active space
when both route caching and `ROUTE_CACHE_WATCH` are enabled. It batches rapid
events, blocks new cache admission while changes settle, safely reloads
DATA.json, refreshes its in-memory metadata snapshot, and invalidates once per
accepted batch. Optional reconciliation periodically compares that snapshot;
the snapshot contains paths and file metadata only and is never persisted.
The configured `<PUBLIC_LOCATION>/<MEDIA_LOCATION>` subtree and `.altair`
operational directory are automatically excluded because their changes cannot
alter cached HTML under the framework contract. This prevents large media
libraries and publisher lock/manifest writes from consuming snapshot memory or
invalidating the HTML route cache.

Watcher ownership is exclusive: full-space watching owns DATA observation;
otherwise `ENABLE_DATA_WATCH=true` uses the specialized path-polling watcher.
`reloadActiveSpace()` or Unix `SIGHUP` is the deployment backstop. Shutdown
closes all watchers, timers, in-flight cache state, WebSockets, and HTTP state.
There is no user-facing cache inspection or cache-only clear command.

## Media Publishing and CDN Delivery

`MEDIA_LOCATION` is a safe relative path beneath `PUBLIC_LOCATION`; the default
is `media`. Runtime and publisher paths are always derived as:

```text
media:    <APP_ROOT>/<ACTIVE_SPACE>/<PUBLIC_LOCATION>/<MEDIA_LOCATION>
manifest: <APP_ROOT>/<ACTIVE_SPACE>/.altair/media-publication.json
```

Configuration is split between the lightweight HTTP behavior and the
short-lived publisher:

| Variable | Default | Framework contract |
| --- | --- | --- |
| `MEDIA_LOCATION` | `media` | Safe relative directory below `PUBLIC_LOCATION`. |
| `MEDIA_CDN_FALLBACK` | `false` | Boolean controlling missing-local-media redirects. |
| `MEDIA_CDN_BASE_URL` | None | Public HTTPS origin; required by enabled fallback or public verification. |
| `MEDIA_PUBLISH_ENABLED` | `false` | Boolean gate for the explicit publisher command. |
| `MEDIA_PUBLISH_PROVIDER` | `s3-compatible` | The only version 1 adapter and accepted value. |
| `MEDIA_PUBLISH_BUCKET` | None | Required publication bucket. |
| `MEDIA_PUBLISH_ENDPOINT` | Empty | Standard AWS S3 resolution when empty; otherwise an S3-compatible API origin. |
| `MEDIA_PUBLISH_REGION` | None | Required provider region; R2 uses `auto`. |
| `MEDIA_PUBLISH_FORCE_PATH_STYLE` | `false` | Boolean for providers requiring path-style addressing. |
| `MEDIA_PUBLISH_VERIFY_PUBLIC` | `false` | Boolean enabling a post-upload public delivery check. |
| `MEDIA_PUBLISH_ACCESS_KEY_ID` | None | Required publisher-scoped access-key ID. |
| `MEDIA_PUBLISH_SECRET_ACCESS_KEY` | None | Required publisher-scoped secret key. |
| `MEDIA_PUBLISH_SESSION_TOKEN` | Empty | Optional temporary-credential token. |

Small sites need no CDN configuration and use normal static serving. When
`MEDIA_CDN_FALLBACK=true`, a missing local `GET` or `HEAD` under the configured
media URL prefix receives a `307` to the validated HTTPS
`MEDIA_CDN_BASE_URL`, with the normalized path and query preserved and
`Cache-Control: no-store`. Local files always win. Pages, APIs, non-media
assets, private segments, malformed paths, traversal, and other methods never
use the fallback.

Publication is an explicit, short-lived command:

```text
pnpm media:publish -- --dry-run
pnpm media:publish
pnpm media:publish -- --json
```

The publisher scans regular files without following symbolic links, detects
allowed media from file signatures, hashes through streams, and compares
SHA-256 values with the shared manifest. New and edited objects upload;
unchanged objects skip; manifest-only remote objects remain. A manifest entry
is updated only after the adapter verifies remote key, byte size, content type,
and stored SHA-256 metadata. The complete manifest is atomically replaced only
after a successful batch. Publication never removes local or remote objects.
Provider-neutral `MEDIA_PUBLISH_*` credentials are scoped to this command and
passed explicitly to the adapter; global AWS SDK credential variables are not
used.

The v1 upload policy uses stable object keys and
`Cache-Control: public, max-age=300, must-revalidate`. Replacements may require
provider/CDN purging or up to the conservative TTL to settle. Content-hashed
immutable objects remain future work.

`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, and `file-type` belong only to the
publisher path. The provider module is dynamically imported by the CLI. The
HTTP process retains no provider client, manifest, checksum inventory, upload
buffer, publisher timer, or publisher watcher. Hashing and uploads stream, and
multipart concurrency is bounded at two. Version 1 limits an individual file
to 20 GiB so its fixed multipart policy retains a predictable memory bound.

Production media-heavy sites should route `/media/*` at their edge provider
directly to a public delivery domain backed by the object store. Redirect
fallback is the simpler development or small-production option; Altair never
serves as a media proxy.

---

## Template System (Tarazed)

### Tag Types

**`@@ELEM_path/file.html`** - Include file (case-insensitive tag, recursive)
- Optional params: `@@ELEM_path/file.html;{"Key":"value"}`
- Path relative to `activeSpace`
- On error: `'UNDEFINED'`

**`@@VAR_variablename`** - Insert variable (case-insensitive, supports hyphens/underscores)
- Default: `'UNDEFINED'` if not found
- Built-in: `year`, `timestamp`, `ts`, `currentpath`
- Custom: from `varDefinitions()` / `additionalVarDefinitions()`

**`@@PARAM_ParameterName`** - Insert parameter (case-sensitive)
- Used within element files receiving params
- Default: empty string if not found
- Special: `FORMAT_PARAMS_FOR_JS: true` → `{ParamName}` for template literals

**`@@DATA_path/file.json`** - Load JSON from file (path relative to `activeSpace`)
- Optional selector: `@@DATA_path/file.json#key.path[0]`
- Optional modifiers (query style): `?ci=true&raw=true&default=...&behavior=...`
- Root retrieval (full document): omit selector (no `#`)
- Key matching default: case-sensitive (`ci=true` for case-insensitive lookup)
- Path traversal supports dot + array index: `team.members[0].name`
- On missing/invalid lookup: controlled by `behavior` (`strict|empty|null|default|pass`)
- `raw=true`: outputs JSON text with `JSON.stringify(...)` (recommended for `<script>` embedding)
- Security: JSON path must resolve inside the active space and use `.json` extension

**`@@REPEAT_component/path.html;data/file.json#items`** - Repeat a component for each array item
- Optional explicit `@@DATA_` source: `@@REPEAT_component/path.html;@@DATA_data/file.json#items`
- Optional key mapping: `@@REPEAT_component/path.html;data/file.json#items;{"Title":"title","Url":"url","Index":"$index"}`
- Without mapping: object item keys become params directly (`item.title` -> `@@PARAM_title`)
- Built-in params per row: `index` (0-based), `number` (1-based)
- `data/file.json#items` must resolve to an array; fallback behavior uses the same `behavior` modifiers as `@@DATA_`

### Processing Order
1. `@@ELEM_` tags (recursive, depth-first)
2. `@@PARAM_` tags (within each included element)
3. `@@REPEAT_` tags (array-driven component repetition)
4. `@@DATA_` tags (after include expansion and repetition)
5. `@@VAR_` tags (last step)

### `@@DATA_` Quick Rules (For AI Agents)
- Use `#` to target a key path: `@@DATA_data/_about-content.json#bio`
- Use no selector for full object: `@@DATA_data/_about-content.json?raw=true`
- Use `raw=true` when injecting objects/arrays into JavaScript
- Prefer case-sensitive keys; only use `ci=true` when schema casing is inconsistent
- Do not expect `@@DATA_` output to trigger another `@@ELEM_` expansion pass
- When passing component params, map keys explicitly in ELEM JSON:
  `@@ELEM_components/bio/_bio.html;{"name":"@@DATA_data/_about-content.json#name"}`

---

## File Structure

### Space Structure
```
spaces/[ACTIVE_SPACE]/
  ├── pages/          # HTML pages (routes: /about → pages/about.html)
  ├── globals/        # _header.html, _footer.html, _nav.html
  ├── components/     # Reusable components (prefix with _)
  ├── css/            # styles.css + _styles/ partials
  ├── js/             # scripts.js + _scripts/ partials
  ├── data/           # DATA.json (environment-based config, hot-reload)
  ├── public/         # Static assets (served directly)
  │   └── media/      # Managed media; bytes ignored by Git
  ├── .altair/        # Verified media manifest and ignored operational state
  └── templates/      # Optional page templates
```

### Naming Conventions
- **Private files:** Must start with `_` (not accessible via HTTP)
- **Public files:** No `_` prefix (accessible via routes)
- **Components:** `components/[name]/_[name].html`

### Route Mapping
- `pages/home.html` → `/` and `/home`
- `pages/about.html` → `/about`
- `pages/blog/post.html` → `/blog/post`
- Any route segment starting with `_` → `404` (private)
- Optional `pages/_404.html` and `pages/_500.html` → error presentation only,
  never public `200` routes

---

## Configuration

### Configuration Types Overview

**Three configuration methods with different use cases:**

| Type | Use For | Restart Required | Security | Hot-Reload |
|------|---------|------------------|----------|------------|
| **ENV** (.env) | Infrastructure, secrets, deployment settings | ✅ Yes (server) | ⚠️ Sensitive OK | ❌ No |
| **Config** (*.json) | App constants, versioning, fixed settings | ✅ Yes (server) | ⚠️ Check into git | ❌ No |
| **DATA.json** | Site content, editable config, environment overrides | ❌ No (auto-reload) | ❌ No secrets | ✅ Yes (1s) |

**When to use ENV:**
- Database credentials, API keys, secrets
- Deployment-specific: `NODE_ENV`, `HOST`, `PORT`, `ACTIVE_SPACE`
- Infrastructure paths: `PUBLIC_LOCATION`, `DATA_LOCATION`
- Feature flags: `MINIFY`, `DEBUG`, `ENABLE_DATA_WATCH`, `ENABLE_ROUTE_CACHE`, `ROUTE_CACHE_WATCH`, `ROUTE_CACHE_RECONCILE`
- **Never:** Site content, frequently-changing values
- **Restart:** Required (process.env loaded at startup only)

**When to use config/*.json:**
- Application version numbers
- Default port, fixed constants
- Rarely-changing technical settings
- **Never:** Secrets, deployment-specific values
- **Restart:** Required (loaded at startup only)
- **Version control:** Check into git

**When to use DATA.json:**
- Site name, tagline, contact info, footer text
- Feature descriptions, pricing, team members
- Environment-specific overrides (prod vs dev email addresses)
- Content that non-developers edit
- Values that change without redeployment
- **Never:** Secrets, API keys, database credentials
- **Restart:** NOT required (hot-reload every 1s)
- **Version control:** Optional (can be deployment-specific)

**Example usage:**
```
ENV:         DATABASE_URL="postgresql://..."       (secret, restart required)
config:      {"version": "1.4.0", "port": 3000}    (constant, restart required)
DATA.json:   {"siteName": "My Site", ...}          (content, hot-reload)
```

**Security warning:** DATA.json values become template variables accessible client-side via view source. Never put secrets in DATA.json.

---

### Environment Variables (.env)
```dotenv
NODE_ENV="development"
APP_NAME="MyApp"
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
HOST=127.0.0.1
PORT=3000
```

`HOST` defaults to `127.0.0.1`, limiting access to the local machine. This is the recommended production setting behind Nginx or another reverse proxy. Set `HOST=0.0.0.0` only when Docker, containers, VMs, LAN development, or another deployment explicitly requires access through all IPv4 interfaces.

### Config Files
`config/default.json` (required):
```json
{"version": "1.0.0", "localPort": 3000}
```

Environment-specific: `development.json`, `production.json`, `staging.json`

### DATA.json (Data Cache)
Location: `{activeSpace}/data/DATA.json`

**Structure:**
```json
{
  "default": {
    "siteName": "MyApp",
    "contact": {"email": "info@example.com", "phone": "555-1234"}
  },
  "production": {
    "contact": {"email": "support@production.com"}
  }
}
```

**Behavior:**
- Loaded at startup, merged: `default` + `NODE_ENV` section
- Nested objects flattened: `contact.email` → `@@VAR_contact_email` (lowercase, underscore-separated)
- Hot-reload: path-based stat polling detects in-place edits and atomic/rsync replacements, then reloads with a 1s debounce and one retry on errors
- Atomic swap: invalid JSON keeps existing cache (website stays functional)
- Access in code: `this.getDataCache()` returns original nested structure

**Variable injection:**
All DATA.json values available as `@@VAR_*` in templates (after flattening).

### Settings Object
Available via `this.settings`: `appName`, `nodeEnv`, `activeSpace`, `publicLocation`, `pagesLocation`, `dataLocation`, `dataFile`, `enableDataWatch`, `debug`, `minify`, `appRootPath`, `dirName`, `localPort`, `version`

---

## Extension Points

**Custom Routes:**
```javascript
additionalRoutes() {
  this.app.get('/api/data', (context) => context.json({ data: 'value' }));
}
```

**Custom Variables:**
```javascript
additionalVarDefinitions() {
  return { apiendpoint: '/api/data', theme: 'dark' };
}
```

**Custom Rendering:**
```javascript
renderHTML = async (p, context) => {
  // Custom preprocessing
  return super.renderHTML(p, context);
}
```

**Custom Middleware:**
```javascript
async start() {
  this.app.use('*', async (context, next) => { /* custom */ await next(); });
  return super.start();
}
```

---

## Usage Patterns

### Pattern 1: Basic Page
`spaces/kinetic/pages/home.html`:
```html
@@ELEM_globals/_header.html
<main><h1>Welcome to @@VAR_APPNAME</h1></main>
@@ELEM_globals/_footer.html
```

### Pattern 2: Component with Parameters
Component: `components/callout/_callout.html`:
```html
<div class="callout @@PARAM_Type">
  <h3>@@PARAM_Title</h3>
  <p>@@PARAM_Message</p>
</div>
```
Usage: `@@ELEM_components/callout/_callout.html;{"Type":"success","Title":"Done","Message":"Complete"}`

### Pattern 3: CSS/JS Partials
`css/styles.css`:
```css
@@ELEM_css/_styles/_theme.css
@@ELEM_components/callout/_callout.css
@@ELEM_css/_styles/_additionals.css
```

`js/scripts.js`:
```javascript
@@ELEM_js/_scripts/_app.js
@@ELEM_components/callout/_callout.js
```

### Pattern 4: DATA.json Variables
`data/DATA.json`:
```json
{
  "default": {
    "siteName": "My Site",
    "footer": {"copyright": "2026 MyCompany", "link": "/about"}
  },
  "production": {
    "siteName": "My Site (Production)"
  }
}
```

Usage in templates:
```html
<h1>@@VAR_sitename</h1>
<footer>@@VAR_footer_copyright | <a href="@@VAR_footer_link">About</a></footer>
```

### Pattern 5: JSON File Data Tags (`@@DATA_`)
Component: `components/bio/_bio.html`:
```html
<div class="c-bio">
  <h2>@@PARAM_name</h2>
  <p>@@PARAM_bio</p>
  <img src="@@PARAM_photo" alt="@@PARAM_name" />
</div>
```

Page usage:
```html
<main>
  @@ELEM_components/bio/_bio.html;{"name":"@@DATA_data/_about-content.json#name","bio":"@@DATA_data/_about-content.json#bio","photo":"@@DATA_data/_about-content.json#photo"}
</main>
```

Root object in script:
```html
<script>
  const aboutContent = @@DATA_data/_about-content.json?raw=true;
</script>
```

---

## WebSocket Server

Altair includes an optional WebSocket server (`altair/websocket-server.js`) for real-time bidirectional communication, built on the `ws` package. It is disabled by default.

### Enabling WebSockets

Add to `.env`:
```dotenv
ENABLE_WEBSOCKET=true
WEBSOCKET_ALLOWED_ORIGINS="same-origin"
```

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_WEBSOCKET` | `false` | Enable WebSocket server |
| `WEBSOCKET_PATH` | `/ws` | Server endpoint path |
| `WEBSOCKET_HEARTBEAT_MS` | `30000` | Ping interval (ms) for dead connection detection |
| `WEBSOCKET_SESSION_TTL_SECS` | `3600` | TTL for disconnected sessions (seconds) |
| `WEBSOCKET_ALLOWED_ORIGINS` | `""` (reject all) | Origin policy (see below) |

**Origin policies:** `""` reject all, `"*"` allow all (dev only), `"same-origin"`, or comma-separated whitelist (e.g. `"https://example.com,https://app.example.com"`).

### Architecture

When enabled, `HTTPServer.start()` creates a `WSServer` instance attached to the Node.js HTTP server returned by Hono's adapter. The WebSocket server is available as `this.wsServer` in any subclass.

**Session model:** Clients send an `init` message with a `session_id`. The server maps sessions to WebSocket connections, enabling message queuing for temporarily disconnected clients and session reconnection.

### Handling Messages

Override `onWsMessage()` in `web-app/web-app.js`:
```javascript
onWsMessage(sessionId, message, ws) {
  if (message.type === 'chat') {
    // Echo back to sender
    this.wsServer.sendToSession(sessionId, { type: 'chat', text: message.text });
  }
}
```

This handler receives all messages except built-in types (`init`, `ping`).

### Client Connection

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'init', session_id: 'user-abc123' }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'connected') {
    console.log('Session established:', msg.session_id);
  }
};
```

**Session ID rules:** 3-64 characters, must start with alphanumeric, may contain alphanumeric, underscore, or hyphen.

### Server API (`this.wsServer`)

| Method | Description |
|--------|-------------|
| `sendToSession(sessionId, data)` | Send to session (queues if disconnected) |
| `broadcast(data)` | Send to all connected clients |
| `isConnected(sessionId)` | Check if session has active connection |
| `getConnectedSessions()` | List all connected session IDs |
| `getSession(sessionId)` | Get session object |
| `getStats()` | Connection stats (total, connected, queued, near rate limit) |

### Built-in Security

- **Origin validation** — configurable per environment
- **Rate limiting** — 30 messages per 10-second window per session
- **Message size limit** — 64KB max payload
- **Queue size limit** — 100 queued messages per session (FIFO eviction)
- **Session TTL** — expired disconnected sessions auto-cleaned (default 1 hour)
- **Graceful shutdown** — WebSocket server closed on SIGTERM/SIGINT

### Protocol Messages

**Client → Server:**
| Type | Payload | Purpose |
|------|---------|---------|
| `init` | `{ type: "init", session_id: "..." }` | Register session |
| `ping` | `{ type: "ping" }` | Application-level keepalive |
| Custom | `{ type: "yourtype", ... }` | Routed to `onWsMessage()` |

**Server → Client:**
| Type | Payload | Purpose |
|------|---------|---------|
| `connected` | `{ type: "connected", session_id: "..." }` | Session confirmed |
| `pong` | `{ type: "pong" }` | Ping reply |
| `error` | `{ type: "error", error: "..." }` | Validation/rate limit error |

---

## Common Patterns

**Multi-Language:** Use different spaces (`spaces/en/`, `spaces/es/`), switch via `ACTIVE_SPACE` in `.env`

**Multi-Tenant:** Custom routing to select space dynamically:
```javascript
additionalRoutes() {
  this.app.use('*', async (context, next) => {
    const subdomain = new URL(context.req.url).hostname.split('.')[0];
    this.currentSpace = `spaces/${subdomain}`;
    await next();
  });
}
```

**API + Frontend:**
```javascript
additionalRoutes() {
  this.app.get('/api/users', (context) => context.json({ users: [] }));
}
```

**Dynamic Data:**
```javascript
renderHTML = async (p, context) => {
  this.customData = await this.fetchData(p);
  return super.renderHTML(p, context);
}
additionalVarDefinitions() {
  return { ...this.customData };
}
```

---

## Common Tasks

**Task 1: Create Page**
1. Create `spaces/[ACTIVE_SPACE]/pages/[name].html`
2. Include `@@ELEM_globals/_header.html` and `@@ELEM_globals/_footer.html`
3. Accessible at `/[name]`

**Task 2: Create Component**
1. Create `components/[name]/_[name].html` (must start with `_`)
2. Use `@@PARAM_` for customization
3. If creating `_[name].css` or `_[name].js`, include in `css/styles.css` or `js/scripts.js`
4. Include: `@@ELEM_components/[name]/_[name].html;{"param":"value"}`

**Task 3: Add Variables**
Override `additionalVarDefinitions()` in `web-app/web-app.js`, return object, use `@@VAR_KEYNAME`

**Task 4: Add Route**
Override `additionalRoutes()` in `web-app/web-app.js`; use Hono methods such as `this.app.get()` and `this.app.post()`, and return responses from the route context.

**Task 5: Organize CSS/JS**
1. **CSS:** Include `_theme.css` first, `_additionals.css` last, component CSS files in between
2. **JS:** Include `_app.js` first, then component JS files
3. Include via `@@ELEM_` tags in main `css/styles.css` or `js/scripts.js`

**Task 6: Add Data Variables (DATA.json)**
1. Create/edit `{activeSpace}/data/DATA.json`
2. Structure: `{"default": {...}, "production": {...}}`
3. Nested objects auto-flatten: `contact: {email: "..."}` → `@@VAR_contact_email`
4. Arrays convert to CSV: `["a","b"]` → `"a, b"`
5. Keys forced lowercase in variables
6. Hot-reload enabled by default (file changes auto-update)

**Task 7: Use JSON File Data Tags (`@@DATA_`)**
1. Add JSON content file in `{activeSpace}/data/` (or another folder under active space)
2. For single values, use selector paths: `@@DATA_data/file.json#section.title`
3. For arrays, use index selectors: `@@DATA_data/file.json#items[0].name`
4. For full object in JS, use: `@@DATA_data/file.json?raw=true`
5. In ELEM params, pass `@@DATA_` tokens as string values; they resolve after ELEM expansion
6. Use `behavior=default&default=...` for graceful fallbacks on missing keys

---

## Troubleshooting

**"UNDEFINED" in page:** Check tag spelling, verify file exists, ensure variable defined, set `DEBUG=true`

**Component not rendering:** Verify path relative to `activeSpace`, check `@@PARAM_` names match (case-sensitive), ensure valid JSON in `@@ELEM_`

**Page returns 404:** Ensure no route segment starts with `_`, check the file in `{activeSpace}/pages/`, and verify `PAGES_LOCATION` in `.env`

**Custom error page not shown:** Verify `_404.html` or `_500.html` is directly in `{activeSpace}/pages/` and can render without missing template dependencies

**CSS/JS not minifying:** Check `MINIFY=true` in `.env`, review logs, validate syntax

**Static files 404:** Ensure files in `{activeSpace}/public/`, verify `PUBLIC_LOCATION="public"` in `.env`

---

## Quick Reference

### File Locations
| File | Purpose |
|------|---------|
| `index.js` | Entry point |
| `web-app/web-app.js` | Custom WebApp class |
| `altair/altair.js` | Core WebServer |
| `altair/tarazed.js` | Template engine |
| `.env` | Environment variables |
| `config/default.json` | Base config |
| `spaces/{name}/pages/` | HTML pages |
| `spaces/{name}/globals/` | Shared fragments |
| `spaces/{name}/components/` | Components |
| `spaces/{name}/data/DATA.json` | Data cache (hot-reload) |
| `spaces/{name}/public/` | Static assets |

### Template Tags
| Tag | Syntax | Case |
|-----|--------|------|
| Element | `@@ELEM_path/file.html` | No |
| Element+Params | `@@ELEM_path/file.html;{"K":"v"}` | No/Yes |
| Repeat | `@@REPEAT_component/path.html;data/file.json#items` | No |
| Data | `@@DATA_path/file.json#key.path?mods` | Selector Yes (`ci=true` optional) |
| Variable | `@@VAR_name` | No |
| Parameter | `@@PARAM_Name` | Yes |

### Built-in Variables
| Variable | Value | Source |
|----------|-------|--------|
| `@@VAR_year` | `2026` | `Date.getFullYear()` |
| `@@VAR_timestamp` | ISO string | `nowToJSONDateUTC()` |
| `@@VAR_ts` | ISO string | Alias |
| `@@VAR_appname` | App name | `WebApp.additionalVarDefinitions()` |
| `@@VAR_version` | Version | `WebApp.additionalVarDefinitions()` |
| `@@VAR_currentpath` | Path (Route) | `WebServer.varDefinitions()` |
| `@@VAR_*` | Any value | DATA.json (flattened, e.g., `contact_email`) |

### Settings
Available via `this.settings`: `appName`, `nodeEnv`, `activeSpace`, `publicLocation`, `pagesLocation`, `dataLocation`, `dataFile`, `enableDataWatch`, `debug`, `minify`, `appRootPath`, `dirName`, `localPort`, `version`

---

## Summary

**Key Points:**
- File-based routing (no config)
- Component system via `@@ELEM_` tags
- Array-driven component repetition via `@@REPEAT_` tags
- File-backed JSON selectors via `@@DATA_` tags
- Variables via `@@VAR_` tags (includes DATA.json auto-injection)
- Parameters via `@@PARAM_` tags
- DATA.json: environment-based config with hot-reload, nested objects flattened
- Processing order: Elements/Parameters → Repeat tags → Data tags → Variables
- Private files use `_` prefix (blocked from HTTP)
- Override methods in `WebApp` for customization
- Templates processed on each request

**Operational Notes:**
- Understand hierarchy: Lib → HTTPServer → WebServer → WebApp
- Know five tag types and processing order
- Use DATA.json for site-wide config/content (auto-injected as variables)
- Nested DATA.json objects flatten: `contact.email` → `@@VAR_contact_email`
- Use `@@DATA_` for direct JSON file lookups when component/page content needs non-flattened structures
- For object/array injection in JS, use `?raw=true`
- Follow naming conventions (`_` prefix for private)
- Use extension points for customization
