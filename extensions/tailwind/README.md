# Tailwind CSS extension

Adds Tailwind CSS v4 to a site as one static stylesheet. Tailwind scans your
templates ahead of time and writes `public/build/tailwind.css`; Altair
serves that file and links it from every rendered page.

- On by default in Altair-Light, and off by deleting one config block.
- Tailwind runs only in development. Production just serves the generated file.
- The `<link>` is added automatically, so templates don't reference it.
- Specific pages can be excluded.
- Requires Altair 4.2.0 or later (extension API 1).

**Why it adds npm packages:** `tailwindcss` and `@tailwindcss/cli` do the
compiling. They are `devDependencies`, so a production install with
`pnpm install --prod` doesn't include them or their native binaries. Versions
are pinned exactly because the generated file depends on them.

## How it works

| Environment | What happens |
| --- | --- |
| `NODE_ENV=development` | The server starts `tailwindcss --watch`, which rewrites the stylesheet when a template changes. The file is sent with `Cache-Control: no-store`. |
| Anything else | Tailwind does not run. The generated file must exist or startup stops. |

The generated file is committed, so a deploy needs no build step and the CSS
travels with content-only updates. Altair's own CSS pipeline is not involved:
`css/styles.css` keeps working as before and overrides Tailwind, because
unlayered CSS wins over Tailwind's layers.

## Setup

Altair-Light ships with this done. For a project that removed it:

1. List the extension in `web-app/web-app.js`:

   ```js
   import { tailwind } from '../extensions/tailwind/tailwind.js';

   class WebApp extends WebServer {
     static extensions = [tailwind];
   }
   ```

2. Add the block to `config/default.json`:

   ```json
   { "extensions": { "tailwind": {} } }
   ```

3. Create `<ACTIVE_SPACE>/css/_tailwind.css` (see below), then run
   `pnpm css:build` and commit the result.

To verify, start the server with `DEBUG=true` and look for
`tailwind: active`. View a page's source for the `/build/tailwind.css` link.

## Turning it off

1. Delete the `tailwind` block from `config/default.json` and restart.
2. Delete `public/build/tailwind.css`, which nothing links any more.

The compiler no longer runs, no link is added and Tailwind's reset is gone.
Add your own CSS through `css/styles.css` as usual. Removing the packages with
`pnpm remove tailwindcss @tailwindcss/cli` is optional, since nothing loads them.

Disabling removes the framework, not your markup. Utility classes already in
templates do nothing once Tailwind is off and need replacing.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm css:build` | Builds the active space's stylesheet once |
| `pnpm css:check` | Fails if the generated file doesn't match its sources |

`pnpm test` runs the same check. **Run `pnpm css:build` before committing.**
Watch mode only adds classes, so one you removed stays in the file until the
next build or server restart, and templates edited while the server is off
aren't picked up at all. If two branches conflict on the generated file, re-run
the build rather than merging it by hand.

A project with its own build pipeline can add the file to `.gitignore` and run
`pnpm css:build` during deployment. The extension only needs the file to exist.

## Upgrading Tailwind

`tailwindcss` and `@tailwindcss/cli` are pinned to the same exact version in
`package.json`, so a new release is never picked up by accident. Upgrade them
together:

1. See what is available:

   ```bash
   pnpm outdated tailwindcss @tailwindcss/cli
   ```

2. Install the new version of both, keeping the exact pin:

   ```bash
   pnpm add -D -E tailwindcss@4.x.y @tailwindcss/cli@4.x.y
   ```

   `pnpm-workspace.yaml` sets `minimumReleaseAge: 1440`, so pnpm refuses a
   release less than 24 hours old. Wait rather than adding an exception. If the
   install stops with `ERR_PNPM_IGNORED_BUILDS` for a new package, check why
   it needs an install script before allowing it under `allowBuilds`.

3. Rebuild and check:

   ```bash
   pnpm css:build
   ```

   ```bash
   pnpm test
   ```

   Look over `git diff` of `public/build/tailwind.css` and view a few pages,
   since a new version can change the generated CSS. Restart a running
   development server so the watcher uses the new version.

4. Commit `package.json`, `pnpm-lock.yaml` and `public/build/tailwind.css`
   together, and deploy them together. If the CSS changed, its hash changes and
   browsers fetch the new file; if not, their cached copy stays valid.

To undo an upgrade, restore those three files from Git and run `pnpm install`.

**Major versions** (v4 to v5) can change the entry file's syntax and rename
utilities used in templates. Follow Tailwind's upgrade guide for that version,
update `css/_tailwind.css` and the templates, and treat it as a project change
rather than a dependency bump. Also check this extension still works with the
CLI's options (`--input`, `--output`, `--minify`, `--watch`) and its
`package.json` `bin` entry, which it uses to find the CLI.

## The entry file

`<ACTIVE_SPACE>/css/_tailwind.css` belongs to the site. Altair doesn't render
it, so template tags such as `@@ELEM_` don't work there.

```css
@import "tailwindcss" source(none);

@source "../pages";
@source "../globals";
@source "../components";
@source "../templates";
@source "../js";

@theme {
  --color-brand: #24613b;
}
```

`source(none)` means only the listed folders are scanned. If templates live
somewhere else, add an `@source` line for that folder.

Design tokens go in `@theme`, and each one becomes utilities such as `bg-brand`.
Tailwind only outputs the CSS variable for a token that a utility uses; write
`@theme static` to always output them, for example to use them in `styles.css`.
`@apply` and other Tailwind syntax only work in this entry file, so CSS that
needs them belongs here. Nested rules also belong here: `styles.css` goes through CleanCSS when
`MINIFY=true`, which drops them.

## Writing class names

Tailwind reads templates as plain text, so every class must appear complete:

```html
<!-- Works: the whole class is in the template -->
<h1 class="text-4xl font-bold">@@VAR_heading</h1>

<!-- Doesn't work: Tailwind never sees the finished class -->
<div class="bg-@@VAR_color-600"></div>
```

For classes chosen by data, use one of these:

1. Keep every possible class written out in the template.
2. Map data values such as `urgent` to a fixed set of template variants.
3. Use a named class defined in `styles.css`.
4. Safelist a small known set in the entry file:
   `@source inline("bg-red-100 text-red-950");`

Don't store Tailwind classes in `DATA.json`. Content can change in production
without a build, and a class that wasn't in the last build has no style.

## Options

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `excludePaths` | string[] | Nothing excluded | Routes that never get the stylesheet. |
| `excludeErrorPages` | boolean | Error pages included | `true` keeps it off your custom 404 and 500 pages. |

## Excluding pages

Use either or both. A page is skipped if any of them excludes it.

**By path, in config.** Takes effect after a restart.

```json
"excludePaths": ["/admin/*", "/print-invoice"]
```

- `/print-invoice` excludes exactly that page.
- `/admin/*` excludes `/admin` and everything under it.

**In the page itself.** Add this to the template's `<head>`:

```html
<meta name="altair-tailwind" content="off">
```

An excluded page also loses Tailwind's reset, and shared templates such as
`_nav.html` lose their styling there if they use utilities. Exclusion only
removes the link. Classes from those templates stay in the stylesheet unless
you also add `@source not "../pages/legacy";` to the entry file.

Pages that skip Altair's renderer, such as HTML files in `public/` and HTML
returned from custom routes, never get the link and need it added by hand.

## Caching in production

The link includes a hash of the file's contents, and the response header
depends on it:

| Request | `Cache-Control` |
| --- | --- |
| `?v=` matches the current file | `public, max-age=31536000, immutable` |
| `?v=` is old or missing | `no-cache` |

Changed CSS gets a new URL, so nothing needs purging. Identical CSS keeps the
same URL, so visitors keep their cached copy across deploys. The hash follows
the file, so replacing it without a restart works too.

**If a CDN is in front of the site, its cache key must include the query
string.** Otherwise it can return old CSS for a new URL, and browsers will keep
that for a year. Replace the file by writing a temporary file and renaming it,
so a half-written file is never served.

With the route cache on, `ROUTE_CACHE_WATCH=true` clears cached pages when the
file changes, so they pick up the new hash. With it off, send `SIGHUP` or call
`reloadActiveSpace()` after a deploy, as for any non-DATA change.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| A class has no effect | It isn't written out in full in a scanned folder, or the stylesheet wasn't rebuilt. |
| Startup error: `is missing; run pnpm css:build` | The generated file isn't in this deployment. |
| Warning: `CLI is not installed` | Development mode on a production install, usually because `NODE_ENV` isn't set. It defaults to `development`. |
| Warning: `the CSS watcher stopped` | The watcher crashed; the lines before it show why. Restart the server. |
| `pnpm test` fails on the generated stylesheet | Run `pnpm css:build` and commit the file. |
| Stylesheet missing on one page | The page is excluded, or its HTML has no `</head>`. |
