# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Altair Light is a minimalist Node.js web server framework built on Express, designed specifically for AI-assisted development. It uses a component-based architecture with a custom templating system called Tarazed that enables composable HTML/CSS/JS through special tags.

**Key Features (v1.4.0):**
- Template system: `@@ELEM_`, `@@VAR_`, `@@PARAM_` tags
- DATA.json: Environment-based config cache with hot-reload (1s debounce)
- Space-based: Multi-tenant architecture with isolated directories
- No build step: Templates processed on-demand per request

## Development Commands

### Starting the Server
```bash
npm start
```
Starts the development server on port 3000 (or `PORT` env var / `localPort` in config).

### Node Version
- Required: Node.js >= 24 <25
- Check version: `node -v`

### Installation
```bash
npm install
```

## Architecture Overview

### Core Class Hierarchy
The framework uses inheritance in this order:
1. **Lib** (`altair/lib.js`) - Base utilities and settings management
2. **ExpressServer** (`altair/express-server.js`) - Express server initialization and basic routing
3. **WebServer** (`altair/altair.js`) - Template rendering and route definitions
4. **WebApp** (`web-app/web-app.js`) - Your application (extend/override as needed)

Entry point: `index.js` → `web-app/main.js` → instantiates `WebApp`

### Tarazed Templating System

Tarazed (`altair/tarazed.js`) is the core templating engine that processes three types of tags:

#### 1. Element Tags (`@@ELEM_`)
Include files from the active space with optional parameters:
- Basic: `@@ELEM_globals/_header.html`
- With params: `@@ELEM_components/callout/_callout.html;{"Class":"color-secondary"}`
- Nested includes are processed recursively
- Files starting with `_` are private (cannot be accessed via URL)

#### 2. Variable Tags (`@@VAR_`)
Dynamic values replaced at render time (case-insensitive, matched as lowercase):
- Built-in: `@@VAR_YEAR`, `@@VAR_TIMESTAMP`, `@@VAR_CURRENTPATH`
- Custom vars: Add via `additionalVarDefinitions()` method
- DATA.json vars: Auto-injected from `{activeSpace}/data/DATA.json` (flattened)
  - Example: `{"contact": {"email": "test@example.com"}}` → `@@VAR_contact_email`
  - Nested objects flattened with underscores, forced lowercase
  - Arrays converted to CSV: `["a", "b"]` → `"a, b"`

#### 3. Parameter Tags (`@@PARAM_`)
Used within components to accept parameters from element includes:
- Example: `@@PARAM_Class` in component, passed via `{"Class":"value"}`
- Case-sensitive matching
- Missing params replaced with empty string

### Space Structure

A "space" is a self-contained application directory specified by `ACTIVE_SPACE` env var (default: `spaces/kinetic`).

Expected structure:
```
spaces/kinetic/
├── pages/          # HTML pages that map to routes (e.g., home.html → /)
├── data/           # DATA.json - environment-based config with hot-reload
├── public/         # Static assets served directly
├── templates/      # Page templates (e.g., _default.html)
├── globals/        # Reusable fragments (_header.html, _footer.html, _nav.html)
├── components/     # Reusable components with their HTML/CSS/JS
├── css/            # Stylesheets (processed through Tarazed)
└── js/             # JavaScript files (processed through Tarazed)
```

### Routing Logic

Routes are defined in `WebServer.routes()`:
1. `/` → renders `pages/home.html`
2. `*.css` → processes CSS through Tarazed, optionally minifies
3. `*.js` → processes JS through Tarazed, optionally minifies
4. Custom routes via `additionalRoutes()` override
5. `*` (catch-all) → attempts to render corresponding HTML page

Files/pages starting with `_` are inaccessible via URL (returns 301 to `/`).

### Configuration

**Three configuration layers with different purposes:**

**1. Environment Variables (`.env`)** - Infrastructure & Secrets
- **Use for:** API keys, database URLs, deployment settings, feature flags
- **Restart required:** Yes (loaded at process start only)
- **Security:** Can contain secrets (excluded from git via `.gitignore`)
- **Variables:**
  - `NODE_ENV` - Environment (development/production/staging)
  - `APP_NAME` - Application name
  - `ACTIVE_SPACE` - Path to space directory (e.g., `spaces/kinetic`)
  - `PUBLIC_LOCATION`, `PAGES_LOCATION` - Directory paths (default: `public`, `pages`)
  - `DATA_LOCATION`, `DATA_FILE` - Data cache paths (default: `data`, `DATA.json`)
  - `ENABLE_DATA_WATCH` - Enable hot-reload (default: `true`)
  - `MINIFY`, `DEBUG` - Feature flags
  - `PORT` - Server port override

**2. Config Files (`config/*.json`)** - App Constants
- **Use for:** Version numbers, default ports, rarely-changing technical settings
- **Restart required:** Yes (loaded at process start only)
- **Security:** Checked into git, no secrets
- **Files:**
  - `config/default.json` (required): `{"version": "1.0.0", "localPort": 3000}`
  - `config/development.json`, `production.json`, `staging.json` (optional overrides)

**3. DATA.json (`{activeSpace}/data/DATA.json`)** - Site Content & Config
- **Use for:** Site name, contact info, pricing, team members, environment-specific content
- **Restart required:** No (hot-reload with 1s debounce, atomic swap on errors)
- **Security:** ⚠️ Never put secrets (values exposed in templates/HTML)
- **Structure:**
  ```json
  {
    "default": {
      "siteName": "My Site",
      "contact": {"email": "info@example.com", "phone": "555-1234"}
    },
    "production": {
      "contact": {"email": "support@production.com"}
    }
  }
  ```
- **Behavior:**
  - Merges: `default` + `NODE_ENV` section
  - Flattens nested objects: `contact.email` → `@@VAR_contact_email` (lowercase)
  - Auto-reloads on file changes (1s debounce)
  - Atomic swap: Invalid JSON keeps existing cache (site stays functional)
  - Access in code: `this.getDataCache()` (original nested structure)

**Quick decision guide:**
- Secret/credential → `.env`
- App version/constant → `config/*.json`
- Site content/editable → `DATA.json`

## Extending the Framework

### Using DATA.json Variables
Access DATA.json in templates (auto-flattened):
```html
<h1>@@VAR_sitename</h1>
<p>Contact: @@VAR_contact_email</p>
```

Access programmatically (original nested structure):
```javascript
const data = this.getDataCache();
console.log(data.contact.email); // Nested access
```

### Adding Custom Routes
Override `additionalRoutes()` in `web-app/web-app.js`:
```javascript
additionalRoutes = () => {
  this.app.get('/api/data', (req, res) => {
    res.json({ data: 'value' });
  });
}
```

### Adding Custom Variables
Override `additionalVarDefinitions()` in `web-app/web-app.js`:
```javascript
additionalVarDefinitions = () => {
  return {
    version: this.settings.version,
    customvar: 'value'
  };
}
```

**Note:** DATA.json variables are merged after `additionalVarDefinitions()`, so DATA.json values take precedence.

### Creating Components
Components should be in `components/` subdirectory with:
- `_componentname.html` - Template with `@@PARAM_` tags
- `_componentname.css` - Styles (optional)
- `_componentname.js` - Logic (optional)

## Key Implementation Details

### Server Startup
1. Load DATA.json from `{activeSpace}/data/DATA.json`
2. Merge `default` + `NODE_ENV` sections → `this.dataCache`
3. Start file watcher (if `ENABLE_DATA_WATCH=true`)
4. Register SIGTERM/SIGINT handlers for graceful shutdown
5. Start Express server

### Render Pipeline
1. Request hits route (HTML/CSS/JS)
2. File loaded from space directory
3. `replaceElemTags()` - Recursively includes files via `@@ELEM_` tags
4. `replaceVarTags()` - Substitutes `@@VAR_` with values from:
   - Built-in vars (year, timestamp, currentpath)
   - `additionalVarDefinitions()`
   - Flattened DATA.json cache
5. `replaceParamTags()` - Substitutes `@@PARAM_` in components
6. Minification (if enabled)
7. Response sent with appropriate content-type

### DATA.json Hot-Reload
1. File watcher detects change (debounced 1s)
2. Attempt to load and parse JSON
3. If parse succeeds: atomic swap to new cache
4. If parse fails: retry once after 500ms, keep existing cache on final failure
5. Website stays functional throughout (atomic swap protection)

### Path Normalization
- `currentPath: 'home'` is normalized to `'/'` in `varDefinitions()`
- All path validation strips leading/trailing slashes via `trimSlashes()`

### Error Handling
- Missing files (ENOENT) → 301 redirect to `/`
- Minification errors → 500 with error message logged
- Undefined tags → Replaced with `'UNDEFINED'` string
- Invalid DATA.json → Keeps existing cache, logs error, retries once

## Important Notes for Claude Code

### When Modifying Configuration
- **ENV changes:** Require server restart (`Ctrl+C` then `npm start`)
- **config/*.json changes:** Require server restart
- **DATA.json changes:** Auto-reload (no restart needed, wait ~1s)

### When Adding Variables
- **For secrets:** Use `.env` (never DATA.json or config)
- **For site content:** Use DATA.json (editable, hot-reload)
- **For app constants:** Use config/*.json or `additionalVarDefinitions()`

### When Working with DATA.json
- Always use `{"default": {...}}` structure for environment merging
- Nested objects auto-flatten: use underscores in variable names
- Keys become lowercase: `"siteName"` → `@@VAR_sitename`
- Test invalid JSON behavior (should keep existing cache)
- Never put secrets (values visible in rendered HTML)

### When Debugging
- Check `DEBUG=true` in `.env` for console logs
- Use `this.readout(message, tag)` for custom logging
- DATA.json errors logged with `[Data-Error]` tag
- Hot-reload events logged with `[Data-Watch]` tag

### File Naming Conventions
- **Private files:** Start with `_` (blocked from HTTP)
- **Public files:** No `_` prefix (accessible via routes)
- **Components:** Always `_componentname.html` in `components/` directory
