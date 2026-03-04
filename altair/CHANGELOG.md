# Altair (module) – Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [2.3.0] - 2026-03-04

### Added
- New `@@REPEAT_` template tag in Tarazed for array-driven component repetition from JSON sources
- Support for selector-based row mapping in repeat tags (including virtual selectors `$index` and `$number`)
- Support for optional explicit data-source form inside repeat tags (`@@DATA_...`)

### Changed
- Template processing pipeline now resolves tags in order: `@@ELEM_` → `@@REPEAT_` → `@@DATA_` → `@@VAR_`
- HTML, CSS, and JS render paths now execute `replaceRepeatTags()` between element and data replacement

## [2.2.0] - 2026-03-02

### Added
- New overridable `applyGlobalReplacements({ content, type, routePath })` hook in `WebServer` for final, route-aware content replacement before responses are sent
- HTML, CSS, and JS render paths now call `applyGlobalReplacements()` after all template/data/variable replacements and minification (if enabled)

### Fixed
- `redirects()` now preserves the requested HTTP status code by using `res.redirect(statusCode, path)` (instead of defaulting to 302)

---

## [2.1.1] - 2026-03-02

### Fixed
- Hardened Tarazed tag replacement (`@@ELEM_`, `@@DATA_`, `@@VAR_`, `@@PARAM_`) by escaping dynamic regex tokens/prefixes and preserving literal `$` sequences in replacement values (including URL/query-string content)

---

## [2.1.0] - 2026-02-21

### Added
- New `@@DATA_` template tag support in Tarazed for loading values from JSON files in the active space
- Selector support with `#` syntax: `@@DATA_data/file.json#path.to.key`
- Root document support (no selector): `@@DATA_data/file.json`
- Query modifiers for data lookups: `ci`, `raw`, `default`, `behavior`
- Behavior modes for missing/invalid lookups: `strict`, `empty`, `null`, `default`, `pass`
- Dot and array selector path traversal (`a.b[0].c`)
- Per-render JSON file cache for repeated `@@DATA_` lookups in the same response

### Changed
- Template processing pipeline now resolves tags in order: `@@ELEM_` → `@@DATA_` → `@@VAR_`
- HTML, CSS, and JS render paths now execute `replaceDataTags()` before variable replacement

### Fixed
- Tarazed constructor now stores `readoutCallback` on the instance so template replacement errors can be logged reliably

---

## [2.0.0] - 2026-02-08

### Added
- WebSocket server support via `ws` package
- New `WSServer` class in `websocket-server.js` for real-time bidirectional communication
- Session management with automatic registration via `init` message
- Heartbeat/ping-pong for connection health monitoring
- Message queuing for temporarily disconnected clients
- Overridable `onWsMessage()` handler for custom message processing
- New environment variables: `ENABLE_WEBSOCKET`, `WEBSOCKET_PATH`, `WEBSOCKET_HEARTBEAT_MS`, `WEBSOCKET_SESSION_TTL_SECS`, `WEBSOCKET_ALLOWED_ORIGINS`
- New settings: `enableWebSocket`, `webSocketPath`, `webSocketHeartbeatMs`, `webSocketSessionTtlSecs`, `webSocketAllowedOrigins`

### Security
- Origin validation: Configurable allowed origins (reject-all, allow-all, same-origin, or whitelist)
- Session TTL cleanup: Expired disconnected sessions automatically removed (configurable, default 1 hour)
- Session ID validation: Regex pattern validation (3-64 chars, alphanumeric start, allows underscore/hyphen)
- Message size limits: 64KB max payload enforced at WebSocket and application level
- Queue size limits: Max 100 queued messages per session, FIFO eviction when exceeded
- Rate limiting: 30 messages per 10-second sliding window per session

### Changed
- `express-server.js` now creates HTTP server explicitly to support WebSocket attachment
- Graceful shutdown now includes HTTP server and WebSocket server cleanup

---

## [1.4.0] - 2026-01-14

### Added
- Data cache with hot-reload support via DATA.json (scoped to active space)
- Support for nested objects in DATA.json with automatic flattening to underscore-separated lowercase variables
- Environment-based configuration in DATA.json with default and NODE_ENV-specific overrides
- Atomic swap for data reload: keeps existing cache on parse errors (preserves website functionality)
- Debouncing for hot-reload: prevents multiple reloads during rapid edits (1s delay)
- Retry logic for mid-write scenarios: retries once after 500ms if file read fails (handles editor atomic saves)
- Graceful shutdown handlers for SIGTERM and SIGINT (proper resource cleanup on exit)

### Changed
- Disabled X-Powered-By header exposure

---

## [1.3.1] - 2026-01-05

### Fixed
- Normalize 'home' to '/'

---

## [1.3.0] - 2026-01-05

### Added
- Support method arguments in varDefinitions()
- New variable currentpath for @@VAR_CURRENTPATH

---

## [1.2.0] - 2025-12-08

### Changed
- Removed unused packages to reduce memory footprint: jasonwebtoken, jsdom & chokidar.
- Made a few small modifications to the files in the css/js directories.
- Incorporated /ARCHITECTURE.md v1 doc for AI agents.

---

## [1.1.0] - 2025-07-21

### Added
- Tarazed utility.

---

## [1.0.0] - 2025-01-01

### Added
- Initial release of Altair module.
