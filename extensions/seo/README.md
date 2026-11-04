# SEO extension

Sets the search and social-sharing tags in the `<head>` of every rendered
page: the canonical link, the description and Open Graph tags (the preview
shown when a page is shared).

- Off until you list it in code **and** configure the site's `baseUrl`.
- Site-wide values come from config; per-page values from DATA.json.
- Existing tags in your templates are **replaced**, never duplicated. A tag
  with no value is left as the template wrote it.
- Requires Altair 4.2.0 or later (extension API 1). No extra npm packages.

## Setup

Turning the extension on takes two steps, plus optional per-page values.
There is nothing to put in `.env`.

### 1. List the extension (`web-app/web-app.js`)

```js
import WebServer from '../altair/altair.js';
import { seo } from '../extensions/seo/seo.js';

class WebApp extends WebServer {
  static extensions = [seo];
  // ...existing overrides...
}
```

Listing it alone changes nothing: without step 2 the extension stays inactive.

### 2. Add site-wide values (`config/default.json` or one environment's file)

```json
{
  "extensions": {
    "seo": {
      "baseUrl": "https://example.com",
      "siteName": "Example",
      "description": "What the site is about, in one or two sentences.",
      "image": "/media/share.jpg",
      "type": "website",
      "twitterCard": "summary_large_image"
    }
  }
}
```

Only `baseUrl` is needed to turn it on. Every page then gets a canonical link
such as `<link rel="canonical" href="https://example.com/about">`. Use the
public address of the production site in every environment, so a copy on
staging still points search engines at the real pages.

### 3. Optional: per-page values (`data/DATA.json`)

Add a `seo` object keyed by page path. Each page can set any of `title`,
`description`, `image`, `type` and `canonical`:

```json
{
  "seo": {
    "/": { "description": "Welcome to Example." },
    "/about": {
      "title": "About Example",
      "description": "Who we are and how we work.",
      "image": "/media/team.jpg"
    }
  }
}
```

- Keys are page paths as visitors see them: `/` for the home page,
  `/blog/post` for `pages/blog/post.html`, no trailing slash.
- Content authors can edit these without a code change. Once Altair picks
  up the DATA.json change (DATA watching, a reload or a restart), the new
  values appear on the next render, also with the route cache on.

Restart the app after changing config.

## Verify

1. With `DEBUG=true`, the log shows `[Extension] seo: active (https://example.com)`.
2. View the source of any page. Its `<head>` has exactly one
   `<link rel="canonical">` with the page's full URL, plus the description
   and `og:` tags that have values.
3. Paste a page URL into a social network's link preview or debugging tool
   (for example the Facebook Sharing Debugger or LinkedIn Post Inspector) to
   see the preview.

## Tags it sets

| Tag | Value, in order of preference |
| --- | --- |
| `<link rel="canonical">` | Page `canonical`, else `baseUrl` + the page path |
| `<meta name="description">` | Page `description`, else config `description` |
| `og:title` | Page `title`, else the page's own `<title>` |
| `og:description` | Same as the description |
| `og:url` | Same as the canonical link |
| `og:image` | Page `image`, else config `image` |
| `og:type` | Page `type`, else config `type` |
| `og:site_name` | Config `siteName` |
| `twitter:card` | Config `twitterCard` |

- A tag with no value is not added, and an existing one is left unchanged.
  For example, without any description the template's own
  `<meta name="description">` stays as it is.
- Relative `image` and `canonical` values are made absolute with `baseUrl`;
  a full URL is used as given.
- Values are HTML-escaped. Non-string values in DATA.json are ignored.
- Existing tags are found in any attribute order or quoting, and extra copies
  are removed. New tags are added just before `</head>`. Pages without
  `</head>` are left unchanged.
- Error pages (404 and 500) are left unchanged.
- The page's `<title>` element itself is not changed; set it in your template.

## Settings

All settings go in `extensions.seo`. Leave out any you don't need; a missing
setting means "do nothing".

| Setting | Type | If absent | Purpose |
| --- | --- | --- | --- |
| `baseUrl` | string | Extension inactive | The site's public origin, such as `https://example.com`. A path, query or malformed URL stops startup. |
| `siteName` | string | No `og:site_name` | The site's name in share previews. |
| `description` | string | Template's description kept | Fallback description for pages without their own. |
| `image` | string | No `og:image` | Fallback share image, a path on the site or a full URL. 1200×630 pixels suits most networks. |
| `type` | string | No `og:type` | Fallback Open Graph type, usually `website`. |
| `twitterCard` | string | No `twitter:card` | `summary` or `summary_large_image`. X also reads the `og:` tags. |

## Redirects and canonical URLs

Altair already redirects `/about/` to `/about` and `/home` to `/`, so each
page has one URL. To redirect old or moved URLs, use the
[`redirects`](../redirects/README.md) extension. For the list of pages search
engines should crawl, use [`sitemap`](../sitemap/README.md).

## Turning it off

- **Temporarily:** remove the `seo` block (or its `baseUrl`) from the config
  file and restart. The `seo` object in DATA.json can stay; it is ignored.
- **Permanently:** also remove `seo` from `static extensions` in `web-app.js`.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Log says `inactive (no extensions.seo config)` | `NODE_ENV` isn't an environment whose config holds the block. |
| Log says `inactive (no baseUrl configured)` | The block exists but has no `baseUrl`. |
| Startup error naming a setting | The value has the wrong type, or `twitterCard` isn't one of the two values. |
| A per-page value isn't used | The DATA.json key doesn't match the path exactly (`/about`, not `about` or `/about/`), or the value isn't a string. |
| Old description still shows after editing DATA.json | DATA.json changes are picked up when DATA watching is on (`ENABLE_DATA_WATCH=true`) or after a reload or restart. |
| Tags missing, no log line | `seo` isn't in `static extensions`. |

## Tests

```bash
pnpm test:extensions
```
