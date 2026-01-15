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

- **Node.js**: >= 24 (see `package.json` for exact version)
- **npm**: Comes with Node.js

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
   node -v
   npm install
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
npm start
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
MINIFY=true
DEBUG=true
```

**Variable Descriptions:**
- `APP_NAME` — Your project's application name
- `ACTIVE_SPACE` — Path to the working "space" or directory where app files are sourced from
- `PUBLIC_LOCATION` — Directory under ACTIVE_SPACE that acts as the public root for static assets
- `PAGES_LOCATION` — Subdirectory under ACTIVE_SPACE containing HTML pages that map to routes
- `DATA_LOCATION` — Subdirectory under ACTIVE_SPACE containing DATA files
- `DATA_FILE` — JSON file containing data
- `ENABLE_DATA_WATCH` — If `true`, watch for changes and reload DATA_FILE
- `MINIFY` — If `true`, CSS and JS assets will be minified during build or serve
- `DEBUG` — If `true`, debug output will be printed to the console

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

## Documentation

- **[altair/README.md](./altair/README.md)** — Altair module documentation

## License

[MIT](./LICENSE)

## Astronomy

**Altair in the night sky**, designated as Alpha Aquilae, is a prominent star located in the constellation Aquila, known as the Eagle. It is the brightest star in this constellation and ranks as the twelfth brightest star in the night sky, with an apparent magnitude of 0.76. Altair is approximately 16.7 light-years from Earth.