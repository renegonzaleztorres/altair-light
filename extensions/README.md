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
| [`forms`](forms/README.md) | `forms` | Validates form submissions against fields in config and emails them (Amazon SES), with optional Turnstile and a confirmation to the sender |
| [`tailwind`](tailwind/README.md) | `tailwind` | Links a generated Tailwind CSS stylesheet on rendered pages; on by default, delete its config block to turn it off |

A typical public site lists `[tailwind, seo, sitemap, redirects, googleAnalytics]`.

## Where extensions live

```text
extensions/               shared library, ships with Altair-Light
  add.js                  the installer behind pnpm extension:add <name>
  _template/              starting point for a new extension
  _shared/                libraries the extensions share, also usable from web-app/:
                          config helpers, the mailer (mail/) and Turnstile verification
  forms/                  install.js and starter/: what pnpm extension:add forms installs
  google-analytics/
  redirects/
  seo/
  sitemap/
  tailwind/
web-app/extensions/       extensions for this site only (a members area, …)
```

Projects pull updates from Altair-Light. Keep site-specific extensions under
`web-app/extensions/`, which the project owns, so those updates never collide
with them.

## Using an extension

Some extensions have an installer that does these steps for you and adds
working starter files, such as a contact page for `forms`:

```bash
pnpm extension:add forms             # or --dry-run to only list the changes
```

It copies the extension's `starter/` files into the active space, adds its
block to `config/development.json`, appends its variables to `.env.example`
(and `.env`), and lists it in `web-app/web-app.js`. It never overwrites a
file: a file that differs is reported as a conflict and nothing is changed.
The extension's README says what it installs. Extensions without an
installer (`google-analytics`, `seo`, `sitemap`, `redirects`, `tailwind`)
are set up by hand:

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
4. Optionally, add an installer: an `install.js` whose default export lists
   the starter files, config block, environment block and package scripts
   (the `InstallPlan` type in `add.js`; `forms/install.js` is an example),
   with the files under `starter/`. Test that the starter files work with the
   extension, as `forms/install.test.js` does.
5. Test with `createExtensionTestServer` from `altair/test/helpers.js`; see
   `_template/my-extension.test.js`.

## Tests

```bash
pnpm test:extensions
```

Runs every `*.test.js` under `extensions/` and `web-app/extensions/`.
`pnpm test` runs these after the framework tests.
