# Altair-Light extensions

Reusable features that a site turns on without changing Altair or subclassing
`WebServer`. Each extension is off until the application lists it **and** its
config block exists. The full contract (hooks, the `api` object, errors and
the cache rule) is "Extension API" in
[`altair/ARCHITECTURE.md`](../altair/ARCHITECTURE.md).

## Available extensions

| Extension | Config key | What it does |
| --- | --- | --- |
| [`google-analytics`](google-analytics/README.md) | `googleAnalytics` | Adds the Google tag (gtag.js) to rendered pages |
| [`sitemap`](sitemap/README.md) | `sitemap` | Serves `/sitemap.xml` of the public pages, and optionally `/robots.txt` |
| [`seo`](seo/README.md) | `seo` | Sets the canonical link, description and Open Graph tags on rendered pages |
| [`redirects`](redirects/README.md) | `redirects` | Redirects old URLs and moved sections to their new location |
| [`tailwind`](tailwind/README.md) | `tailwind` | Links a generated Tailwind CSS stylesheet on rendered pages; on by default, delete its config block to turn it off |

A typical public site lists `[tailwind, seo, sitemap, redirects, googleAnalytics]`.

## Where extensions live

```text
extensions/               shared library, ships with Altair-Light
  _template/              starting point for a new extension
  _shared/                config helpers the library's extensions share
  google-analytics/
  redirects/
  seo/
  sitemap/
  tailwind/
web-app/extensions/       extensions for this site only (a contact form, …)
```

Projects pull updates from Altair-Light. Keep site-specific extensions under
`web-app/extensions/`, which the project owns, so those updates never collide
with them.

## Using an extension

1. List it in `web-app/web-app.js`. Order matters: setup and hooks run in list
   order, shutdown in reverse.

   ```js
   import WebServer from '../altair/altair.js';
   import { googleAnalytics } from '../extensions/google-analytics/google-analytics.js';

   class WebApp extends WebServer {
     static extensions = [googleAnalytics];
   }
   ```

2. Add its block under `extensions` in the config file of each environment
   that should run it, for example `config/production.json`. An extension
   with no settings is turned on with `{}`.
3. Set any environment variables its README names in `.env`.
4. Restart. With `DEBUG=true`, startup logs one line per listed extension:
   `active` or `inactive (no extensions.<key> config)`.

## Writing an extension

1. Copy `_template/` to `extensions/<name>/` or `web-app/extensions/<name>/`
   and rename the files to `<name>.js`, `<name>.test.js` and keep `README.md`.
2. Keep `// @ts-check` at the top of the extension file: the editor then
   checks the definition, the `api` object and each hook against Altair's
   types.
3. Follow the library conventions:
   - **No defaults that do something.** A missing setting means "do nothing";
     invalid settings throw in `setup` so startup stops with a clear message.
   - **Secrets come from `api.env('NAME')`**, never from config files.
   - **Transforms and `vars` depend only on path, content and config.** Pages
     are cached and served to every visitor; per-request behavior belongs in
     `addMiddleware`.
   - **No new npm dependencies** unless the README says why.
   - **The README explains every setup step**: code, config, `.env`, how to
     verify, and how to turn it off.
4. Test with `createExtensionTestServer` from `altair/test/helpers.js`; see
   `_template/my-extension.test.js`.

## Tests

```bash
pnpm test:extensions
```

Runs every `*.test.js` under `extensions/` and `web-app/extensions/`.
`pnpm test` runs these after the framework tests.
