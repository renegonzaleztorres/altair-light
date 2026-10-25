# altair-light

Altair Light is a foundational, minimalist Node.js web server framework designed for **AI-assisted development**. Fork this repository, configure it, and use AI assistants and tools to generate websites and applications by working with Altair-Light's primitives and component system.

**Source code**: https://github.com/renegonzaleztorres/altair-light.git

## Philosophy

Altair Light is built on a simple premise: **fork, configure, prompt, build**.

1. **Fork** this repository to create your own foundation
2. **Configure** basic settings (project name, port, etc.)
3. **Prompt** AI assistants and tools to generate pages, components, and features
4. **Build** using Altair-Light's primitives and conventions — let the AI assistant generate and manage all the code

The framework provides a structured foundation with clear conventions, making it easy for AI assistants to understand your project structure and generate code that fits seamlessly into your application.

## Prerequisites

- **Node.js**: >= 24 < 25 (the `.nvmrc` selects Node.js 24)
- **pnpm**: 12.8.1 (pinned by `packageManager` in `package.json`)

### One-time Local Setup

If Node.js 24 is not already installed on your computer, run these commands
once. These commands assume that [nvm](https://github.com/nvm-sh/nvm) is
installed. Corepack reads the project's `packageManager` field and provides the
pinned pnpm version:

```sh
nvm install 24
nvm use 24
corepack enable
pnpm --version
```

Alternatively, install the pinned version directly with
`npm install --global pnpm@12.8.1`.

You do not need to repeat this setup for each altair-light project. Use
`nvm use` and `pnpm install` in each newly cloned project instead.

The `packageManager` field belongs to the application repository. New Altair
Light forks inherit pnpm 12.8.1 as the recommended default, but an application
may pin another pnpm version that is compatible with its Node.js version and
dependencies. When changing the pin, verify or regenerate `pnpm-lock.yaml` with
the selected pnpm version and run the application's tests before committing the
toolchain change.

## Getting Started

### Fork and Configure

1. **Fork this repository** to create your own foundation:
   
   If you want your fork to use a different name:
   - Fork the repo normally on GitHub
   - Open Settings → Repository name in your fork
   - Rename it to whatever you prefer (example: my-app)
   - Clone your renamed fork

2. **Configure for your project**:
   - Update `package.json` with your project name, version, description, author and license
   - Update `CHANGELOG.md` with your project name and dates
   - Adjust `config/default.json` with your settings
   - Use the existing `kinetic` space or create your own space in `spaces/`
   - Modify `LICENSE.md` to reflect your project!
   - Modify `README.md` (this file) to reflect your project!

### Installation

1. **Install dependencies**:

   ```sh
   nvm use
   node -v
   pnpm install
   ```

2. **Create environment file**:
   Create a `.env` file in the project root (see [Configuration](#configuration) section below for details)

3. **Verify configuration**:
   Ensure `/config/default.json` exists with at minimum:
   ```json
   {
     "version": "1.0.0",
     "localPort": 3000
   }
   ```

## Quick Start

Start the development server:

```sh
pnpm start
```

The server will start on **http://localhost:3000** (or the port specified in your config).

To change the port, edit `/config/default.json` and set `localPort` to your desired value.

## Configuration

### Environment Variables (.env)

Create a `.env` file in the project root (copy from `.env.example`):

```dotenv
NODE_ENV="development"
APP_NAME="<PROJECT_NAME>"
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

**Variable Descriptions:**
- `HOST` — HTTP bind address. Defaults to `127.0.0.1` for local/loopback access only; recommended for production behind Nginx or another reverse proxy. Set to `0.0.0.0` only when all IPv4 interfaces must be reachable, such as in Docker, containers, VMs, or LAN development.
- `APP_NAME` — Your project's application name
- `ACTIVE_SPACE` — Path to the working "space" or directory where app files are sourced from
- `PUBLIC_LOCATION` — Directory under ACTIVE_SPACE that acts as the public root for static assets
- `PAGES_LOCATION` — Subdirectory under ACTIVE_SPACE containing HTML pages that map to routes
- `DATA_LOCATION` — Subdirectory under ACTIVE_SPACE containing DATA files
- `DATA_FILE` — JSON file containing data
- `ENABLE_DATA_WATCH` — If `true`, watch for changes and reload DATA_FILE
- `ENABLE_ROUTE_CACHE` — Enables the bounded, in-memory cache for public file-backed HTML routes; defaults to `false`
- `ROUTE_CACHE_MAX_ENTRIES` — Maximum cached pages per process; defaults to `250`
- `ROUTE_CACHE_WATCH` — Watches the complete active space and invalidates cached pages after settled changes
- `ROUTE_CACHE_QUIET_MS` / `ROUTE_CACHE_MAX_BATCH_MS` — Control how rapid deployment changes are grouped
- `ROUTE_CACHE_RECONCILE` — Enables an optional recurring metadata scan to catch missed filesystem events
- `ROUTE_CACHE_RECONCILE_MS` — Reconciliation interval, from 5 seconds to 1 hour; defaults to 30 seconds
- `ROUTE_CACHE_DEBUG` — Enables cache diagnostics without logging response or private request data
- `MINIFY` — If `true`, CSS and JS assets will be minified during build or serve
- `DEBUG` — If `true`, debug output will be printed to the console
- `ENABLE_WEBSOCKET` — If `true`, start WebSocket server on the HTTP server
- `WEBSOCKET_PATH` — WebSocket endpoint path (default: `/ws`)
- `WEBSOCKET_HEARTBEAT_MS` — Ping interval in ms for dead connection detection (default: `30000`)
- `WEBSOCKET_SESSION_TTL_SECS` — TTL in seconds for disconnected sessions (default: `3600`)
- `WEBSOCKET_ALLOWED_ORIGINS` — Origin policy: `""` reject all (default), `"*"` allow all, `"same-origin"`, or comma-separated whitelist

### Config File

Edit `/config/default.json` to change the port and/or version number. At minimum, it should contain:

```json
{
  "version": "1.0.0",
  "localPort": 3000
}
```

Environment-specific configs (`development.json`, `production.json`, `staging.json`) can override or extend these settings.

### data/DATA.json (Data Cache)

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

Hot reload follows the configured DATA file path with stat polling, so editor
atomic saves and rsync rename-overwrite deployments continue to be detected
after the original file inode is replaced.

### HTML Route Cache

When `ENABLE_ROUTE_CACHE=true`, Altair stores final public, file-backed HTML in
the running process after each route is first requested. The cache is lazy,
limited by `ROUTE_CACHE_MAX_ENTRIES`, and uses least-recently-used eviction.
It is never written to disk and starts empty after a process restart.

Requests with a query string, cookie, or authorization header bypass the
shared cache. Custom routes, errors, redirects, and pages using
`@@VAR_TIMESTAMP` or `@@VAR_TS` are not cached. Eligible responses include an
ETag and `Cache-Control: no-cache`, allowing browsers and CDNs to revalidate
with a small `304 Not Modified` response.

With `ROUTE_CACHE_WATCH=true`, one active-space watcher batches kinetic edits,
reloads DATA.json safely, and clears the page cache once. It subsumes
`ENABLE_DATA_WATCH`, so two DATA observers are never started. If full-space
watching is disabled, `ENABLE_DATA_WATCH=true` retains the specialized DATA
watcher, but other kinetic changes require `reloadActiveSpace()` or a Unix
`SIGHUP`. Optional snapshot reconciliation adds periodic metadata scans for
uncontrolled in-place deployments.

## Testing

- `pnpm test` runs both the Altair framework tests and application tests.
- `pnpm test:altair` runs only tests belonging to the Altair framework.
- `pnpm test:app` runs only application tests under `tests/`.

The Altair HTTP tests use a minimal test-only server and do not execute the
application's root `index.js` or custom `WebApp` startup behavior.

## Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — This project’s application architecture, custom integration, content model, and deployment decisions
- **[altair/ARCHITECTURE.md](./altair/ARCHITECTURE.md)** — Versioned Altair module internals and framework extension contract
- **[altair/README.md](./altair/README.md)** — Altair module documentation

## License

[MIT](./LICENSE)

## Astronomy

**Altair in the night sky**, designated as Alpha Aquilae, is a prominent star located in the constellation Aquila, known as the Eagle. It is the brightest star in this constellation and ranks as the twelfth brightest star in the night sky, with an apparent magnitude of 0.76. Altair is approximately 16.7 light-years from Earth.
