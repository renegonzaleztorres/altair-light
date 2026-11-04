# Sitemap extension

Serves `/sitemap.xml`, listing every public page of the site so search engines
can find them, and optionally `/robots.txt` pointing to it.

- Off until you list it in code **and** configure the site's `baseUrl`.
- Built from the `pages/` folder on each request: a page added while the
  server runs appears on the next request, with no restart and no file
  watching. Nothing is kept in memory between requests.
- Both responses send `Cache-Control: public, max-age=3600`, so browsers and
  CDNs reuse them for an hour.
- Requires Altair 4.2.0 or later (extension API 1). No extra npm packages.

## Setup

Turning the extension on takes two steps: code and config. There is nothing to
put in `.env`.

### 1. List the extension (`web-app/web-app.js`)

```js
import WebServer from '../altair/altair.js';
import { sitemap } from '../extensions/sitemap/sitemap.js';

class WebApp extends WebServer {
  static extensions = [sitemap];
  // ...existing overrides...
}
```

Listing it alone changes nothing: without step 2 the extension stays inactive.

### 2. Add the site's address (`config/production.json`)

```json
{
  "extensions": {
    "sitemap": {
      "baseUrl": "https://example.com",
      "exclude": ["/thank-you"],
      "robots": {}
    }
  }
}
```

- `baseUrl` is the public origin the URLs in the sitemap start with: scheme
  and host only, no path. Use the address visitors use, not the server's
  internal one.
- `"robots": {}` also serves `/robots.txt` allowing everything; leave it out
  if you don't want Altair to serve `robots.txt`.
- Put the block in the config file of each environment that should serve a
  sitemap. node-config loads `config/default.json` plus the file named after
  `NODE_ENV`.

**Keep staging out of search results.** Give staging its own block with its
own address and `disallowAll`, in `config/staging.json`:

```json
{
  "extensions": {
    "sitemap": {
      "baseUrl": "https://staging.example.com",
      "robots": { "disallowAll": true }
    }
  }
}
```

Restart the app after changing config.

## Verify

1. With `DEBUG=true`, the log shows
   `[Extension] sitemap: active (https://example.com; 12 pages; robots.txt on)`.
2. Open `/sitemap.xml`. Each public page appears once as a full URL.
3. If enabled, open `/robots.txt`. Its last line is
   `Sitemap: https://example.com/sitemap.xml`.
4. Submit the sitemap URL in Google Search Console or Bing Webmaster Tools.

## Settings

All settings go in `extensions.sitemap`. Leave out any you don't need; a
missing setting means "do nothing".

| Setting | Type | If absent | Purpose |
| --- | --- | --- | --- |
| `baseUrl` | string | Extension inactive | The site's public origin, such as `https://example.com`. A path, query or malformed URL stops startup. |
| `exclude` | string[] | Nothing excluded | Pages left out of the sitemap: `/exact` or `/prefix/*`, as below. |
| `robots` | object | No `/robots.txt` | Serve `/robots.txt`. `{}` allows everything. |
| `robots.disallow` | string[] | Nothing disallowed | Paths crawlers should skip, each starting with `/`, such as `"/admin/"`. Written as `Disallow:` lines. |
| `robots.disallowAll` | boolean | Crawling allowed | `true` asks every crawler to skip the whole site. Use it for staging. |

## Which pages are listed

Every `.html` file under `pages/` that Altair serves publicly:

- `pages/home.html` is `/`; `pages/blog/post.html` is `/blog/post`.
- Files and folders starting with `_` (drafts, `_404.html`, `_500.html`) are
  private and never listed.
- Pages matching `exclude` are left out. `/thank-you` excludes exactly that
  page; `/admin/*` excludes `/admin` and everything under it. Case and
  trailing slashes are ignored.
- Routes that aren't page files (from `additionalRoutes()` or other
  extensions) aren't listed.

Leave out pages that shouldn't appear in search results, such as form
confirmation pages, and pages that redirect elsewhere.

## What it doesn't do

- **No `<lastmod>`, `<changefreq>` or `<priority>`.** Search engines mostly
  ignore them unless they are accurate.
- **No sitemap index.** One sitemap holds up to 50,000 URLs, more than an
  Altair-Light site normally has.
- **Doesn't change pages.** For canonical links and Open Graph tags, see the
  [`seo`](../seo/README.md) extension.

## Turning it off

- **Temporarily:** remove the `sitemap` block (or its `baseUrl`) from the
  config file and restart.
- **Permanently:** also remove `sitemap` from `static extensions` in
  `web-app.js`.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Log says `inactive (no extensions.sitemap config)` | `NODE_ENV` isn't the environment whose config file holds the block. |
| Log says `inactive (no baseUrl configured)` | The block exists but has no `baseUrl`. |
| Startup error about `baseUrl` | It isn't an origin such as `https://example.com` (no path, no trailing text). |
| Startup error about `exclude` | A pattern isn't `/exact` or `/prefix/*`. |
| Warning: `public/robots.txt exists` | A static file of the same name is served first. Delete it to use the generated one, or remove `robots` from config. |
| `/sitemap.xml` returns 404, no log line | `sitemap` isn't in `static extensions`. |
| A page is missing | Its file or a folder above it starts with `_`, or it matches `exclude`. |

## Tests

```bash
pnpm test:extensions
```
