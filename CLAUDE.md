# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Altair Light is a minimalist Node.js web server framework built on Express, designed specifically for AI-assisted development. It uses a component-based architecture with a custom templating system called Tarazed that enables composable HTML/CSS/JS through special tags.

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

**Environment Variables** (`.env`):
- `APP_NAME` - Application name
- `ACTIVE_SPACE` - Path to space directory (e.g., `spaces/kinetic`)
- `PUBLIC_LOCATION` - Public assets subdirectory (default: `public`)
- `PAGES_LOCATION` - HTML pages subdirectory (default: `pages`)
- `MINIFY` - Enable CSS/JS minification (true/false)
- `DEBUG` - Enable console logging (true/false)
- `NODE_ENV` - Environment (development/production/staging)

**Config File** (`config/default.json`):
```json
{
  "version": "1.0.0",
  "localPort": 3000
}
```

Environment-specific configs (`development.json`, `production.json`, `staging.json`) can override these.

## Extending the Framework

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

### Creating Components
Components should be in `components/` subdirectory with:
- `_componentname.html` - Template with `@@PARAM_` tags
- `_componentname.css` - Styles (optional)
- `_componentname.js` - Logic (optional)

## Key Implementation Details

### Render Pipeline
1. Request hits route (HTML/CSS/JS)
2. File loaded from space directory
3. `replaceElemTags()` - Recursively includes files via `@@ELEM_` tags
4. `replaceVarTags()` - Substitutes `@@VAR_` with dynamic values
5. `replaceParamTags()` - Substitutes `@@PARAM_` in components
6. Minification (if enabled)
7. Response sent with appropriate content-type

### Path Normalization
- `currentPath: 'home'` is normalized to `'/'` in `varDefinitions()`
- All path validation strips leading/trailing slashes via `trimSlashes()`

### Error Handling
- Missing files (ENOENT) → 301 redirect to `/`
- Minification errors → 500 with error message logged
- Undefined tags → Replaced with `'UNDEFINED'` string
