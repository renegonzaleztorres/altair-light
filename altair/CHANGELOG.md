# Altair (module) – Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

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