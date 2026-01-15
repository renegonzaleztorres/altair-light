# Altair-Light Architecture (v1.4)

**Purpose:** LLM agent reference for Altair-Light web framework

---

## Executive Summary

Minimalist Node.js web server framework for AI-assisted development:
- **File-based routing** - HTML files in `pages/` map to routes
- **Component system** - Reusable HTML/CSS/JS via template tags
- **Template engine (Tarazed)** - Three tag types: `@@ELEM_`, `@@VAR_`, `@@PARAM_`
- **Data cache (DATA.json)** - Environment-based config with hot-reload, variables auto-injected
- **On-demand processing** - No build step; templates processed per request
- **Space-based** - Multiple projects in isolated `spaces/` directories
- **~500 lines** of core framework code

**Philosophy:** Fork, configure, prompt AI to generate, build using conventions.

---

## Getting Started

### Prerequisites
- Node.js >= 24 < 25
- `npm install`

### Setup Steps

**1. Create `.env`** (project root):
```dotenv
NODE_ENV="development"
APP_NAME="MyApp"
ACTIVE_SPACE="spaces/kinetic"
PUBLIC_LOCATION="public"
PAGES_LOCATION="pages"
DATA_LOCATION="data"
DATA_FILE="DATA.json"
ENABLE_DATA_WATCH=true
MINIFY=false
DEBUG=true
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

**4. Start:** `npm start` → `http://localhost:3000`

---

## Class Hierarchy

```
Lib → ExpressServer → WebServer → WebApp
```

### Key Classes

**Lib** (`altair/lib.js`): Base utilities
- `this.settings` - Config object (appName, activeSpace, debug, minify, etc.)
- `trimSlashes(s)`, `readout(msg, tag)`, `nowToJSONDateUTC()`

**ExpressServer** (`altair/express-server.js`): Express setup
- `this.app` - Express instance
- `this.dataCache` - In-memory cache from DATA.json (access via `getDataCache()`)
- `start()` - Loads DATA.json, setup CORS, static files, JSON parser, routes, listen
- `loadDataFile()` - Loads and merges DATA.json (environment-based)
- `getDataCache()` - Returns dataCache object
- `redirects()`, `serverError()`

**WebServer** (`altair/altair.js`): Routing & rendering
- `this.tarazed` - Template engine instance
- `routes()` - `GET /` → home, `GET *.css` → CSS, `GET *.js` → JS, `GET *` → HTML
- `renderHTML(p, res)` - Read page, process `@@ELEM_` (recursive), `@@VAR_`, minify comments
- `renderCSS(p, res)` - Read CSS, process tags, minify with CleanCSS
- `renderJS(p, res)` - Read JS, process tags, minify with Terser
- `pageNameValidation(p)` - Blocks files starting with `_`
- `varDefinitions()` - Returns {year, timestamp, ts, currentpath} + additionalVarDefinitions() + flattened DATA.json vars
- `additionalVarDefinitions()` - Override for custom variables
- `additionalRoutes()` - Override for custom routes

**WebApp** (`web-app/web-app.js`): Application customization
- Extends WebServer
- `additionalVarDefinitions()` - Adds version, ver, appname

**Tarazed** (`altair/tarazed.js`): Template engine
- `replaceElemTags(s)` - Process `@@ELEM_path;{"param":"value"}` (async, recursive)
- `replaceVarTags(s, vD)` - Process `@@VAR_name` (case-insensitive)
- `replaceParamTags(s, params)` - Process `@@PARAM_Name` (case-sensitive)
- **Processing order:** 1) Elements (recursive), 2) Parameters, 3) Variables

---

## Request Flow

**Startup:** `index.js` → `main.js::main()` → `new WebApp()` → `wa.start()`

**HTML Request:** Route → `renderHTML()` → Validate → Read file → `replaceElemTags()` (recursive) → `replaceVarTags()` → Minify comments → Send

**CSS Request:** Route → `renderCSS()` → Validate → Read → Process tags → Minify (CleanCSS) → Send

**JS Request:** Route → `renderJS()` → Validate → Read → Process tags → Minify (Terser) → Send

**Error Handling:** ENOENT → 301 redirect to `/` | Invalid name → 301 redirect | Other → 500 | Template error → `'UNDEFINED'`

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

### Processing Order
1. `@@ELEM_` tags (recursive, depth-first)
2. `@@PARAM_` tags (within included elements)
3. `@@VAR_` tags (last step)

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
- Files starting with `_` → 301 redirect (blocked)

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
- Deployment-specific: `NODE_ENV`, `PORT`, `ACTIVE_SPACE`
- Infrastructure paths: `PUBLIC_LOCATION`, `DATA_LOCATION`
- Feature flags: `MINIFY`, `DEBUG`, `ENABLE_DATA_WATCH`
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
MINIFY=true
DEBUG=true
PORT=3000
```

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
- Hot-reload: file changes auto-reload (debounced 1s, retry once on errors)
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
  this.app.get('/api/data', (req, res) => res.json({ data: 'value' }));
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
renderHTML = async (p, res) => {
  // Custom preprocessing
  await super.renderHTML(p, res);
}
```

**Custom Middleware:**
```javascript
start() {
  this.app.use((req, res, next) => { /* custom */ next(); });
  super.start();
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

---

## Common Patterns

**Multi-Language:** Use different spaces (`spaces/en/`, `spaces/es/`), switch via `ACTIVE_SPACE` in `.env`

**Multi-Tenant:** Custom routing to select space dynamically:
```javascript
additionalRoutes() {
  this.app.use((req, res, next) => {
    const subdomain = req.hostname.split('.')[0];
    this.currentSpace = `spaces/${subdomain}`;
    next();
  });
}
```

**API + Frontend:**
```javascript
additionalRoutes() {
  this.app.get('/api/users', (req, res) => res.json({ users: [] }));
}
```

**Dynamic Data:**
```javascript
renderHTML = async (p, res) => {
  this.customData = await this.fetchData(p);
  await super.renderHTML(p, res);
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
Override `additionalRoutes()` in `web-app/web-app.js`, use `this.app.get()`, `this.app.post()`, etc.

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

---

## Troubleshooting

**"UNDEFINED" in page:** Check tag spelling, verify file exists, ensure variable defined, set `DEBUG=true`

**Component not rendering:** Verify path relative to `activeSpace`, check `@@PARAM_` names match (case-sensitive), ensure valid JSON in `@@ELEM_`

**301 redirect loop:** Ensure page doesn't start with `_`, check file in `{activeSpace}/pages/`, verify `PAGES_LOCATION` in `.env`

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
- Variables via `@@VAR_` tags (includes DATA.json auto-injection)
- Parameters via `@@PARAM_` tags
- DATA.json: environment-based config with hot-reload, nested objects flattened
- Processing order: Elements → Parameters → Variables
- Private files use `_` prefix (blocked from HTTP)
- Override methods in `WebApp` for customization
- Templates processed on each request

**For LLM Agents:**
- Understand hierarchy: Lib → ExpressServer → WebServer → WebApp
- Know three tag types and processing order
- Use DATA.json for site-wide config/content (auto-injected as variables)
- Nested DATA.json objects flatten: `contact.email` → `@@VAR_contact_email`
- Follow naming conventions (`_` prefix for private)
- Use extension points for customization
