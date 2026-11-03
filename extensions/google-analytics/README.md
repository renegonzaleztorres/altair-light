# Google Analytics extension

Adds the Google tag (gtag.js) to the `<head>` of every rendered HTML page, so
page views are reported to a Google Analytics 4 property.

- Off until you list it in code **and** configure a Measurement ID.
- Runs only in environments whose config file contains the Measurement ID.
- Specific routes can be excluded.
- Requires Altair 4.2.0 or later (extension API 1). No extra npm packages.

## Setup

Turning the extension on takes three steps: code, config and `.env`.

### 1. List the extension (`web-app/web-app.js`)

```js
import WebServer from '../altair/altair.js';
import { googleAnalytics } from '../extensions/google-analytics/google-analytics.js';

class WebApp extends WebServer {
  static extensions = [googleAnalytics];
  // ...existing overrides...
}
```

Listing it alone changes nothing: without step 2 the extension stays inactive.

### 2. Add your Measurement ID (`config/production.json`)

```json
{
  "extensions": {
    "googleAnalytics": {
      "measurementId": "G-XXXXXXXXXX"
    }
  }
}
```

- Use **your own** property's ID. Find it in GA under *Admin → Data streams →
  your web stream*.
- Put it only in the config file for the environment that should be tracked.
  node-config loads `config/default.json` plus the file named after
  `NODE_ENV`, so an ID in `production.json` is active only when
  `NODE_ENV=production`.
- **Don't put it in `config/default.json`.** That file applies to every
  environment, including development.
- To track staging separately, put a *different* property's ID in
  `config/staging.json`.
- A Measurement ID is public (it appears in page source), so it is fine to
  commit it.

### 3. Keep the route cache working (production `.env`)

Only needed when `ENABLE_ROUTE_CACHE=true`:

```dotenv
ROUTE_CACHE_IGNORED_COOKIES="_ga,_ga_*,_gid"
```

GA stores cookies in the visitor's browser, and Altair skips its page cache for
any request carrying a cookie it doesn't recognize. Without this line, every
returning visitor gets an uncached page. If caching is on and the line doesn't
cover GA's cookies, startup prints:
`[Extension] google-analytics: set ROUTE_CACHE_IGNORED_COOKIES=…`.

Restart the app after changing config or `.env`.

## Verify

1. Start with `NODE_ENV=production`. With `DEBUG=true`, the log shows:
   `[Extension] google-analytics: active (G-XXXXXXXXXX; 0 excluded path patterns)`
   and `[Extension] google-analytics active`.
2. Open any page and view its source. The Google tag appears just before
   `</head>`.
3. In Google Analytics, open *Reports → Realtime* and load a page. Your visit
   appears within a minute or so.

## Settings

All settings go in `extensions.googleAnalytics`. Leave out any you don't need;
a missing setting means "do nothing".

| Setting | Type | If absent | Purpose |
| --- | --- | --- | --- |
| `measurementId` | string | Extension inactive | GA4 ID, `G-` followed by 4–20 uppercase letters or digits. A malformed value stops startup. |
| `excludePaths` | string[] | Nothing excluded | Routes that never get the tag (see below). |
| `excludeErrorPages` | boolean | Error pages included | `true` keeps the tag off your custom 404 and 500 pages. |

## Excluding routes

Use either or both. A page is skipped if any of them excludes it.

**By path, in config.** Developers, per environment; takes effect after a
restart.

```json
"excludePaths": ["/admin/*", "/preview/*", "/thank-you"]
```

- `/thank-you` excludes exactly that page.
- `/admin/*` excludes `/admin` and everything under it, but not
  `/administrator`.
- Case and trailing slashes are ignored. `/` is the home page.
- An invalid pattern (`admin`, `/admin*`) stops startup with an error, so a
  typo can't silently leave a page tracked.

**By page, in content.** Content authors; takes effect as soon as the page
changes. Add this anywhere in the page, its template or an included partial,
exactly as written (`name` before `content`):

```html
<meta name="altair-analytics" content="off">
```

It is a `<meta>` tag rather than an HTML comment because `MINIFY=true` strips
comments before extensions run. It stays in the delivered HTML, where it is
harmless.

Rules can depend only on the page's path or content, never on the visitor:
Altair caches each page once and serves it to everyone.

## What it doesn't do

- **No consent handling.** In regions covered by GDPR or ePrivacy rules you may
  need visitor consent before analytics loads. That needs a consent solution
  that is not part of this extension.
- **No custom events.** Add `gtag('event', ...)` calls in your own page scripts.
- **Some responses are never tagged:** routes that return their own HTML or
  JSON (from `additionalRoutes()` or other extensions), CSS, JS and static
  files.

## Turning it off

- **Temporarily:** remove the `googleAnalytics` block (or its `measurementId`)
  from the config file and restart.
- **Permanently:** also remove `googleAnalytics` from `static extensions` in
  `web-app.js`.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Log says `inactive (no extensions.googleAnalytics config)` | `NODE_ENV` isn't the environment whose config file holds the block. |
| Log says `inactive (no measurementId configured)` | The block exists but has no `measurementId`. |
| Startup error about `measurementId` | The ID isn't in GA4 form (`G-…`). Universal Analytics IDs (`UA-…`) aren't supported. |
| Startup error about `excludePaths` | A pattern isn't `/exact` or `/prefix/*`. |
| Warning about `ROUTE_CACHE_IGNORED_COOKIES` | Add the `.env` line from setup step 3. |
| Tag missing on one page | The page is excluded by path or by the `<meta>` tag, or its HTML has no `</head>`. |
| Tag missing everywhere, no log line | `googleAnalytics` isn't in `static extensions`. |

## Tests

```bash
pnpm test:extensions
```
