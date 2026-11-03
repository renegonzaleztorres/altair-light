# Altair Module Architecture

| Metadata | Value |
| --- | --- |
| Altair version | 4.3.0 |
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
- **Extensions** - Opt-in reusable pieces (analytics, sitemaps, forms) through a small extension API
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
HOST="127.0.0.1"
PORT=3000
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
ROUTE_CACHE_IGNORED_COOKIES=""
MINIFY=false
DEBUG=true
```

**2. Verify `config/default.json`**:
```json
{"version": "1.0.0"}
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
- `this.settings` - Complete, validated, immutable application and runtime settings
- `trimSlashes(s)`, `readout(msg, tag)`, `nowToJSONDateUTC()`

**HTTPServer** (`altair/http-server.js`): Hono and Node.js HTTP setup
- `this.app` - Hono instance
- `this.dataCache` - In-memory cache from DATA.json (access via `getDataCache()`)
- `start()` - Loads settings and DATA, initializes services, awaits listener readiness, and rolls back partial startup on failure
- `prepare()` - Everything `start()` does before watching and listening: extension setup, settings, DATA, middleware and routes
- `static extensions` / `setupExtensions()` / `this.extensionRunner` - Extension API (see "Extension API")
- `loadDataFile()` - Atomically loads DATA.json and returns a structured applied/changed result
- `reloadActiveSpace()` - Reloads DATA, refreshes watcher state, and invalidates routes
- `getDataCache()` - Returns dataCache object
- `redirects()`, `notFound()`, `clientError()`, `serverError()`, `createErrorResponse()`
- `initializeMediaConfiguration()`, `mediaFallback()`
- `onSettingsReady()` - Optional one-time application hook after immutable settings and framework services exist, before DATA and listener startup

**WebServer** (`altair/altair.js`): Routing & rendering
- `this.tarazed` - Template engine instance
- `routes()` - `GET /` → home, `GET *.css` → CSS, `GET *.js` → JS, `GET *` → HTML
- `renderHTML(p, context)` - Apply cache eligibility, lookup/coalescing, rendering, and response construction
- `renderHTMLBody(p)` - Process `@@ELEM_`, `@@REPEAT_`, `@@DATA_`, `@@VAR_`, minification, and global replacements
- `renderCSS(p, context)` - Read CSS, process tags, minify with CleanCSS
- `renderJS(p, context)` - Read JS, process tags, minify with Terser
- Optional packages load on demand (`altair/dependencies.js`): CleanCSS and Terser load on the first minified response when `MINIFY=true`, and `websocket-server.js` (with `ws`) loads at startup only when `ENABLE_WEBSOCKET=true`. A disabled feature adds nothing to process memory.
- `pageNameValidation(p)` - Rejects traversal, malformed paths, and underscore-prefixed segments
- `handleMissingPage()` - Application policy hook for missing HTML pages only
- `renderErrorPage()` - Optional private `_404.html`/`_500.html` rendering outside the route cache
- `varDefinitions()` - Returns {year, timestamp, ts, currentpath} + extension vars + additionalVarDefinitions() + flattened DATA.json vars
- `additionalVarDefinitions()` - Override for custom variables
- `additionalRoutes()` - Override for custom routes; registered before the CSS/JS route, so custom paths ending in `.css` or `.js` are reachable
- `listPublicPages()` - Public page routes in the active space; backs the extension `site.listPages()`

**WebApp** (`web-app/web-app.js`): Application customization
- Extends WebServer
- `additionalVarDefinitions()` - Adds version, ver, appname

**Tarazed** (`altair/tarazed.js`): Template engine
- `replaceElemTags(s)` - Process `@@ELEM_path;{"param":"value"}` (async, recursive)
- `replaceRepeatTags(s)` - Process `@@REPEAT_componentPath;dataPath#arrayPath;{"Param":"item.path"}` (async)
- `replaceDataTags(s)` - Process `@@DATA_path/file.json#key.path?modifiers` (async)
- `replaceVarTags(s, vD)` - Process `@@VAR_name` (case-insensitive)
- `replaceParamTags(s, params)` - Process `@@PARAM_Name` (case-sensitive)
- All tag families replace complete parsed tokens, so prefix-related names are independent of source order
- Recursive element expansion detects repeated states and terminates after at most 50 passes
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

**Startup:** `index.js` → async `main()` → `new WebApp()` → `await wa.start()` → running `WebApp`. Rejection returns to the explicit entry-point error boundary.

**HTML Request:** Route → `renderHTML()` → Validate → Read file → `replaceElemTags()` (recursive) → `replaceRepeatTags()` → `replaceDataTags()` → `replaceVarTags()` → Minify comments (optional) → extension `transformHTML` → `applyGlobalReplacements()` → Send

With Route Cache enabled, the HTML flow becomes: eligibility check → cache
lookup → ETag comparison → cached `200`/`304`, or one coalesced
`renderHTMLBody()` call on a miss → generation-safe storage → response.

**CSS Request:** Route → `renderCSS()` → Validate → Read → `replaceElemTags()` → `replaceRepeatTags()` → `replaceDataTags()` → `replaceVarTags()` → Minify (CleanCSS, optional) → extension `transformCSS` → `applyGlobalReplacements()` → Send

**JS Request:** Route → `renderJS()` → Validate → Read → `replaceElemTags()` → `replaceRepeatTags()` → `replaceDataTags()` → `replaceVarTags()` → Minify (Terser, optional) → extension `transformJS` → `applyGlobalReplacements()` → Send

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
- A `4xx` `HTTPException` thrown by Hono middleware such as `csrf()`,
  `bodyLimit()`, or `basicAuth()` reaches `clientError()` instead, keeping its
  status and headers (for example `403` or `401` with `WWW-Authenticate`) and
  adding `Cache-Control: no-store`. A `5xx` `HTTPException` is still treated
  as a server error.
- Optional private `pages/_404.html` and `pages/_500.html` files are processed
  through Tarazed on demand. They retain the error status, are marked
  `no-store` and `noindex`, and never enter the route cache. If an error page
  fails, Altair immediately uses a dependency-free fallback without recursion.
- Each page has one canonical URL: `/about/` (any number of trailing
  slashes) redirects `301` to `/about`, and `/home` to `/`, keeping the query
  string. Pages render and cache only under the canonical path, so
  `@@VAR_CURRENTPATH` always matches the cache key.
- Error responses omit bodies for `HEAD`. Other redirects remain available only
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

Only core file-backed `GET`/`HEAD` pages without a query delimiter or
Authorization header are eligible. A Cookie header is eligible only when every
cookie name matches an exact name or trailing-prefix pattern configured by
`ROUTE_CACHE_IGNORED_COOKIES`; its empty default makes every cookie bypass.
Unknown or malformed cookies, timestamp variables, custom routes, redirects,
and errors bypass shared storage. Cookie values are never inspected beyond
parsing their names and are never logged. Cached responses use
`Cache-Control: no-cache` and an ETag, so clients may store them but must
revalidate before reuse. With `ROUTE_CACHE_DEBUG=true`, Altair emits concise
cache decisions for hits, misses, stores, bypasses, coalesced requests, `304`
revalidation, eviction, skipped admission, and invalidation. Messages include
route paths and cache reasons but never response bodies, cookies,
authorization values, or ETags. The diagnostics are silent by default.

`SpaceWatcher` (`altair/space-watcher.js`) observes the complete active space
when both route caching and `ROUTE_CACHE_WATCH` are enabled. It batches rapid
events, blocks new cache admission while changes settle, safely reloads
DATA.json, refreshes its in-memory metadata snapshot, and invalidates once per
accepted batch. Changes made while a batch is processing start a new quiet
window. When recovery keeps failing (for example while DATA.json is invalid),
retries back off from the quiet window up to 30 seconds and reset after a
successful recovery. Optional reconciliation periodically compares that snapshot;
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
and stored SHA-256 metadata. The manifest is replaced atomically after the
batch, and also when a batch fails or is interrupted, so uploads that already
succeeded are recorded and not repeated on the next run.

The first `Ctrl+C` (or `SIGTERM`) aborts the upload in flight, writes that
checkpoint, releases `.altair/media-publication.lock` and exits; a second
signal exits at once. The lock records its PID and host. A later run removes a
lock whose process on this host has exited, and refuses a lock held by a live
process, a lock from another host, or an unreadable lock (delete it by hand
only when no publication is running). Publication never removes local or remote objects.
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
- Optional params: `@@ELEM_path/file.html;{"Key":"value"}`. The JSON may nest, contain `}` inside strings, and span lines; invalid or unterminated JSON is reported as an `Error` readout and the include renders without parameters
- Path relative to `activeSpace`
- On error: `'UNDEFINED'`
- Direct or indirect include cycles terminate as `'UNDEFINED'`; nesting is bounded to 50 expansion passes

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
- Security: JSON path must resolve inside the active space and use `.json` extension (see **Path containment** below)

**`@@REPEAT_component/path.html;data/file.json#items`** - Repeat a component for each array item
- Optional explicit `@@DATA_` source: `@@REPEAT_component/path.html;@@DATA_data/file.json#items`
- Optional key mapping: `@@REPEAT_component/path.html;data/file.json#items;{"Title":"title","Url":"url","Index":"$index"}`
- Without mapping: object item keys become params directly (`item.title` -> `@@PARAM_title`)
- Built-in params per row: `index` (0-based), `number` (1-based)
- `data/file.json#items` must resolve to an array; fallback behavior uses the same `behavior` modifiers as `@@DATA_`

**Path containment.** `@@ELEM_`, `@@DATA_` and `@@REPEAT_` share one rule: a
path must be relative, must stay inside the active space after resolving `..`
and symbolic links, and may not contain a segment starting with `.` (so
`.env`, `.git/` and `.altair/` never render). A path that breaks the rule
renders `'UNDEFINED'` (or the `behavior` fallback for `@@DATA_` and
`@@REPEAT_`) and logs an `Error` readout. Symbolic links that point to another
file inside the space still work.

`@@VAR_` resolves only variables that are actually defined, never inherited
object members: `@@VAR_constructor` renders `'UNDEFINED'`. DATA.json keys named
`hasOwnProperty` work like any other key, and `__proto__` keys are ignored.

Every tag is replaced as one complete parser match. A shorter name such as
`date` cannot consume the beginning of `dateDisplay`, regardless of which token
appears first. A pipe (`|`) is a supported visible separator between DATA or
REPEAT tokens and is not part of either token.

### Processing Order
1. `@@ELEM_` tags (recursive, pass-by-pass)
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
- `pages/home.html` → `/` (`/home` redirects to `/`)
- `pages/about.html` → `/about`
- `pages/blog/post.html` → `/blog/post`
- Trailing slashes redirect: `/about/` → `/about`
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
- Application-owned structured settings and fixed constants
- Environment-specific application behavior selected by `NODE_ENV`
- **Never:** Listener ports, bind addresses, secrets, deployment-specific values
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
ENV:         PORT=4000                              (deployment, restart required)
config:      {"version": "1.4.0", "theme": {...}} (application, restart required)
DATA.json:   {"siteName": "My Site", ...}         (content, hot-reload)
```

**Security warning:** DATA.json values become template variables accessible client-side via view source. Never put secrets in DATA.json.

---

### Environment Variables (.env)
```dotenv
NODE_ENV="development"
APP_NAME="MyApp"
HOST=127.0.0.1
PORT=3000
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
ROUTE_CACHE_IGNORED_COOKIES=""
MINIFY=true
DEBUG=true
```

`HOST` defaults to `127.0.0.1`, limiting access to the local machine. This is the recommended production setting behind Nginx or another reverse proxy. Set `HOST=0.0.0.0` only when Docker, containers, VMs, LAN development, or another deployment explicitly requires access through all IPv4 interfaces.

### Config Files
`config/default.json` (required):
```json
{"version": "1.0.0"}
```

Environment-specific: `development.json`, `production.json`, `staging.json`.
dotenv runs before node-config, so `.env` can select the file for local use;
an exported `NODE_ENV` takes precedence in production. The merged config is
copied into `this.settings`, recognized environment variables override their
runtime counterparts, and the complete tree is deeply frozen. `HOST` and
`PORT` are environment-only deployment settings. Startup rejects a conflicting
node-config environment override so `NODE_ENV` and the selected config file
cannot silently disagree.

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
Every merged `config/*.json` key is available via `this.settings`, together
with validated framework fields such as `appName`, `nodeEnv`, `host`, `port`,
`activeSpace`, `publicLocation`, `pagesLocation`, `dataLocation`, `dataFile`,
`enableDataWatch`, `debug`, `minify`, `appRootPath`, and `version`. The object
and all nested values are immutable and shared with composed framework
services.

Only environment variables explicitly recognized by Altair are copied into
`this.settings`. Application-specific secrets and provider configuration—such
as AWS SES credentials, database credentials, payment keys, or Cloudflare
Turnstile secrets—must not be added to the framework-wide settings object.

An application that needs such values should create an application-owned
configuration boundary under `web-app/`. That module reads only the required
environment variables, validates and normalizes them once during startup,
returns a narrow immutable configuration object, and injects that object into
the service that needs it. Settings-dependent setup belongs in
`onSettingsReady()` or another method called during `start()`, not in the
`WebApp` constructor. Business methods then consume the injected configuration
instead of reading `process.env` repeatedly or receiving the complete process
environment.

```javascript
// web-app/form-config.js
export const loadFormConfig = () => Object.freeze({
  turnstileSecret: requireEnvironmentVariable('TURNSTILE_SECRET_KEY'),
  sesRegion: process.env.FORM_SES_REGION || 'us-east-1'
});

// web-app/web-app.js
onSettingsReady() {
  this.formProcessor = new FormProcessor(loadFormConfig());
}
```

The application should prefer workload identity or the provider's normal
credential chain when available. If explicit credentials are necessary, their
names should be scoped to the application feature. Public browser values, such
as a Turnstile site key, should be kept separate from server-only secrets.

---

## Extension Points

Applications extend `WebServer` (see `web-app/web-app.js`) and override its
hooks. Reusable pieces meant for more than one application are written as
extensions instead (see "Extension API" below). The framework declares every hook as a prototype method, so a subclass
may override it with either syntax:

- **Method syntax** (`additionalRoutes() { ... }`) is the default style for new
  code.
- **Class-field syntax** (`additionalRoutes = () => { ... };`) is also
  supported. It is the style used by the bundled `web-app/web-app.js`.

Either way, the override replaces the framework default, and
`super.hookName(...)` calls the framework implementation. Override each hook
once per class; if a class declares both forms for the same name, the
class-field form wins.

Overridable hooks: `routes`, `additionalRoutes`, `renderHTML`,
`renderHTMLBody`, `renderCSS`, `renderJS`, `applyGlobalReplacements`,
`pageNameValidation`, `varDefinitions`, `additionalVarDefinitions`,
`handleMissingPage`, `notFound`, `serverError`, `routeCacheEligibility`,
`onSettingsReady`.

Hooks are called with the server as `this`. Code that copies a hook into a
variable and calls it later must bind it first:
`const original = server.applyGlobalReplacements.bind(server);`.

**Custom Routes:**
```javascript
additionalRoutes() {
  this.app.get('/api/data', (context) => context.json({ data: 'value' }));
}

// Equivalent class-field form
additionalRoutes = () => {
  this.app.get('/api/data', (context) => context.json({ data: 'value' }));
};
```

**Custom Variables:**
```javascript
additionalVarDefinitions() {
  return { apiendpoint: '/api/data', theme: 'dark' };
}

// Equivalent class-field form
additionalVarDefinitions = () => {
  return { apiendpoint: '/api/data', theme: 'dark' };
};
```

**Custom Rendering:**
```javascript
async renderHTML(p, context, options) {
  // Custom preprocessing
  return super.renderHTML(p, context, options);
}

// Equivalent class-field form
renderHTML = async (p, context, options) => {
  // Custom preprocessing
  return super.renderHTML(p, context, options);
};
```

Pass `options` through. The framework's own routes use it to mark core routes;
without it, pages are treated as custom routes and are never route-cached.

**Custom Middleware:**
```javascript
async start() {
  this.app.use('*', async (context, next) => { /* custom */ await next(); });
  return super.start();
}
```

---

## Extension API

Extensions are reusable pieces (analytics, sitemaps, SEO tags, forms) that an
application turns on without subclassing. Subclass hooks (above) remain the
way an application customizes itself; extensions never subclass `WebServer`.
The runner lives in `altair/extensions.js`. Extension API version: **1**.

### Writing an extension

```js
// @ts-check
import { defineExtension } from '../../altair/extensions.js';

export const example = defineExtension({
  name: 'example',          // lowercase kebab-case, unique
  apiVersion: 1,            // extension API version it was written for
  configKey: 'example',     // reads settings.extensions.example
  async setup(api) {        // runs once at startup, only when the config block exists; may be async
    // validate api.config, read files, register routes or middleware, prepare state
    return {                // the hooks this extension implements
      transformHTML: ({ content }) => content
    };
  }
});
```

`// @ts-check` gives editor completion and errors from the JSDoc types in
`extensions.js` with no TypeScript install. The runner checks the same rules
at startup.

### Turning one on

An extension is **installed** when the application lists it and **active**
only when its config block is present:

```js
// web-app/web-app.js
class WebApp extends WebServer {
  static extensions = [sitemap, googleAnalytics];
}
```

```json
// config/production.json
{ "extensions": { "googleAnalytics": { "measurementId": "G-XXXXXXXXXX" } } }
```

- No config block, nothing happens. An extension with no settings is turned on
  with an empty block: `"sitemap": {}`.
- A config block must be an object, and `extensions` itself must be an object.
- Startup logs (with `DEBUG=true`) one line per extension: `active`, or
  `inactive (no extensions.<configKey> config)`. The same list is available
  as `server.extensionRunner.status`.
- Shared extensions live in `extensions/`; extensions for one site live in
  `web-app/extensions/`.

### Hooks returned from `setup`

| Hook | Runs | Input | Returns | Combined |
| --- | --- | --- | --- | --- |
| `transformHTML` | Every rendered page and custom error page, before the app's `applyGlobalReplacements` | `{ content, path, routePath, kind }` | string (or promise) | Waterfall in list order |
| `transformCSS` | Every rendered CSS file, after minification, before `applyGlobalReplacements` | `{ content, path }` | string (or promise) | Waterfall |
| `transformJS` | Every rendered JS file, same position | `{ content, path }` | string (or promise) | Waterfall |
| `vars` | Every render | `{ currentPath }` | plain object (synchronous) | Merged; keys lowercased |
| `contentChanged` | After a DATA change, a kinetic-content batch, or `reloadActiveSpace()` has cleared the route cache | `{ reason }` | nothing (may be async) | Sequential; errors logged |
| `shutdown` | Graceful shutdown, before watchers and the listener close | none | nothing (may be async) | Reverse order; errors logged |

- In `transformHTML`, `path` is the normalized route (`/`, `/about`,
  `/blog/post`; `/_404` and `/_500` for error pages) and `kind` is `'page'`
  or `'error'`. `routePath` is Altair's internal page name (`home`,
  `/blog/post`, `_404`); match on `path`.
- Template variables, lowest priority first: core (`year`, `timestamp`,
  `ts`, `currentpath`), extensions, the app's `additionalVarDefinitions()`,
  DATA.json, per-call values. When two extensions define the same variable the
  later one wins, with one warning per name.
- Any other key returned from `setup` stops startup, so a misspelled hook
  can't be silently ignored.

### The `api` object passed to `setup`

| Member | Purpose |
| --- | --- |
| `name` | This extension's name |
| `config` | Its frozen `settings.extensions[configKey]` block |
| `settings` | The application's frozen settings: the same object as `this.settings` |
| `site.listPages()` | Promise of public page routes (`/`, `/about`, `/blog/first-post`), sorted; skips `_` files and folders |
| `site.data()` | Current DATA.json contents as a deep-frozen copy (one copy per DATA load); reflects reloads |
| `env(name, { required = true })` | **During setup only.** Reads one uppercase environment variable. A missing required value stops startup naming the variable; an optional one returns `undefined`. |
| `log(message)` | Debug line prefixed with the extension name; printed only when `DEBUG=true` |
| `warn(message)` | Always-printed warning, `[Extension] <name>: …` |
| `addRoute(method, path, ...handlers)` | **During setup only.** `GET`, `POST`, `PUT`, `PATCH` or `DELETE`; mounted before the app's and Altair's routes. Earlier handlers act as route middleware (Hono's `csrf()`, `bodyLimit()`). `/`, `*` and `/*` belong to Altair. Two extensions registering the same method and path stop startup. |
| `addMiddleware(handler)` | **During setup only.** Hono middleware for every request, mounted after CORS and before static files |
| `invalidateRouteCache(reason)` | Clears rendered pages, for example after the extension's own data changes |

Extensions have no access to the server instance (`this`) or the raw Hono
app. **Secrets come from `api.env()`, never from config**: application
secrets must stay out of the shared `settings` object. `status` records the
names of the variables each extension read, never their values.

### Lifecycle

```text
start() → prepare()
  setupExtensions()        awaited in list order; routes and middleware collected
  initialize()             the app's onSettingsReady() runs after every extension's setup
  DATA loaded
  cors → extension middleware → static files → media fallback
  extension routes → routes(): "/" → additionalRoutes() → CSS/JS → page catch-all
→ watchers → listening
(any failure: shutdown(), including the extensions already set up, then start() rejects)

page request: middleware → render → transformHTML (list order) → applyGlobalReplacements → route cache
content change: DATA reload → route cache cleared → contentChanged
shutdown(): extension shutdown (reverse order) → watchers → listener
```

`prepare()` is everything `start()` does before watching and listening.
Tests use it to serve requests in-process.

### The cache contract

Rendered pages are stored in the route cache **after** transforms and
variables run, then served to every visitor. So `transformHTML`,
`transformCSS`, `transformJS` and `vars` may depend **only on the path, the
content and configuration**, never on the request (cookies, headers, query,
user). Per-request behavior belongs in `addMiddleware`, which runs on every
request, including cached ones. Extensions that derive data from content
rebuild it in `contentChanged`.

### Errors

| Where | What happens |
| --- | --- |
| `defineExtension` | Throws at module load: bad name, wrong `apiVersion`, missing `configKey` or `setup` |
| Listing an object not made by `defineExtension`, or the same name twice | Startup fails |
| `setup` throws or rejects | `start()` rejects with `Extension <name> failed to set up: …`; extensions already set up get `shutdown` |
| Unknown hook returned | Startup fails |
| `addRoute`, `addMiddleware` or `env` after setup | Throws `… is only available during setup` |
| Duplicate route, or a route Altair owns | Startup fails |
| `transformHTML/CSS/JS` throws or returns a non-string | The request gets Altair's safe `500` (error reference, logged detail) |
| `contentChanged` or `shutdown` throws | Logged; the remaining extensions still run |

### Testing an extension

`altair/test/helpers.js` exports `createExtensionTestServer`, which builds a
temporary active space and prepares the server exactly as `start()` does,
without opening a port:

```js
import { createExtensionTestServer } from '../../altair/test/helpers.js';

const { request, server, cleanup } = await createExtensionTestServer({
  extensions: [example],
  config: { example: {} },                     // settings.extensions
  pages: { 'home.html': '<html><head></head><body></body></html>' },
  data: {},                                     // DATA.json
  env: {},                                      // what api.env() reads
  settings: {}                                  // other settings overrides
});
try {
  const response = await request('/');
} finally {
  await cleanup();
}
```

The contract itself is pinned by `altair/extensions.test.js`.

### Versioning

Adding a hook or an `api` member keeps extension API version 1. Changing or
removing one increments it; a later Altair major release can accept both
versions during a transition. Not in version 1, and added only when a real
extension needs it: ordering constraints between extensions, raw Hono access,
per-request render hooks, route-cache eligibility and missing-page hooks,
WebSocket and post-listen hooks, dependencies between extensions, and a setup
timeout (an extension that fetches at startup should bound its own I/O).

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

Altair includes an optional WebSocket server (`altair/websocket-server.js`) for real-time bidirectional communication, built on the `ws` package. It is disabled by default. The module and `ws` are loaded only when WebSockets are enabled.

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

**Session model:** The server issues session IDs. A client sends `init` once per connection and receives a `session_id` and a `resume_token`. To resume after a reconnect, the client sends both back; the server then restores the session, delivers queued messages, and issues a new token (each token works once). An ID without its matching token gets a new session, so knowing or guessing an ID never grants access to it. To tie a session to a signed-in user, authenticate in `onWsMessage()` and keep your own mapping from user to session ID.

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

This handler receives all messages except built-in types (`init`, `ping`), and only from connections that have sent `init`, so `sessionId` is always set. Messages sent before `init` get an `error` reply.

### Client Connection

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onopen = () => {
  // Resume the previous session if this tab has one; otherwise start a new one
  const saved = JSON.parse(sessionStorage.getItem('altair-ws') || '{}');
  ws.send(JSON.stringify({ type: 'init', session_id: saved.session_id, resume_token: saved.resume_token }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'connected') {
    // The token rotates on every resume, so always store the latest pair
    sessionStorage.setItem('altair-ws', JSON.stringify({ session_id: msg.session_id, resume_token: msg.resume_token }));
    console.log(msg.resumed ? 'Session resumed:' : 'Session started:', msg.session_id);
  }
};
```

Store the resume token like a session cookie: `sessionStorage` scopes it to the tab and clears it when the tab closes.

### Server API (`this.wsServer`)

| Method | Description |
|--------|-------------|
| `sendToSession(sessionId, data)` | Send to session (queues if disconnected; ignored for IDs the server never issued) |
| `broadcast(data)` | Send to all connected clients |
| `isConnected(sessionId)` | Check if session has active connection |
| `getConnectedSessions()` | List all connected session IDs |
| `getSession(sessionId)` | Get session object |
| `getStats()` | Connection stats (total, connected, queued, near rate limit) |

### Built-in Security

- **Origin validation** — configurable per environment
- **Server-issued sessions** — random session IDs; resuming requires the matching one-time resume token
- **One `init` per connection** — a second `init` on the same connection is rejected
- **Rate limiting** — 30 messages per 10-second window per connection, `init` included
- **Message size limit** — 64KB max payload
- **Queue size limit** — 100 queued messages per session (FIFO eviction)
- **Session TTL** — expired disconnected sessions auto-cleaned (default 1 hour)
- **Graceful shutdown** — WebSocket server closed on SIGTERM/SIGINT

### Protocol Messages

**Client → Server:**
| Type | Payload | Purpose |
|------|---------|---------|
| `init` | `{ type: "init" }`, or `{ type: "init", session_id: "...", resume_token: "..." }` to resume | Start or resume a session |
| `ping` | `{ type: "ping" }` | Application-level keepalive |
| Custom | `{ type: "yourtype", ... }` | Routed to `onWsMessage()` |

**Server → Client:**
| Type | Payload | Purpose |
|------|---------|---------|
| `connected` | `{ type: "connected", session_id: "...", resume_token: "...", resumed: true\|false }` | Session started or resumed |
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
async renderHTML(p, context, options) {
  this.customData = await this.fetchData(p);
  return super.renderHTML(p, context, options);
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

**Component not rendering:** Verify path relative to `activeSpace` (paths that leave the space or contain a `.`-prefixed segment are refused), check `@@PARAM_` names match (case-sensitive), ensure valid JSON in `@@ELEM_` (errors appear as `Error` readouts)

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
| `altair/extensions.js` | Extension API runner and types |
| `extensions/` | Shared extension library |
| `web-app/extensions/` | Site-specific extensions |
| `altair/settings.js` | Validated immutable settings loader |
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
Available via immutable `this.settings`: all merged application config keys and
the validated framework runtime fields, including `nodeEnv`, `host`, `port`,
`activeSpace`, and watcher/cache settings.

---

## Summary

**Key Points:**
- File-based routing (no config)
- Component system via `@@ELEM_` tags
- Array-driven component repetition via `@@REPEAT_` tags
- File-backed JSON selectors via `@@DATA_` tags
- Variables via `@@VAR_` tags (includes DATA.json auto-injection)
- Parameters via `@@PARAM_` tags
- Reusable features through the extension API (`static extensions` plus an `extensions.<key>` config block)
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
