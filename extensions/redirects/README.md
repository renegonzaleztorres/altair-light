# Redirects extension

Sends visitors and search engines from old URLs to new ones, for example after
renaming a page or moving a section.

- Off until you list it in code **and** add a `rules` map.
- Exact rules (`/old` → `/new`) and section rules (`/old-blog/*` →
  `/blog/*`).
- Redirects are permanent (`301`) unless you choose another status.
- Requires Altair 4.2.0 or later (extension API 1). No extra npm packages.

## Setup

Turning the extension on takes two steps: code and config. There is nothing to
put in `.env`.

### 1. List the extension (`web-app/web-app.js`)

```js
import WebServer from '../altair/altair.js';
import { redirects } from '../extensions/redirects/redirects.js';

class WebApp extends WebServer {
  static extensions = [redirects];
  // ...existing overrides...
}
```

Listing it alone changes nothing: without step 2 the extension stays inactive.

### 2. Add the rules (`config/default.json`)

```json
{
  "extensions": {
    "redirects": {
      "rules": {
        "/about-us": "/about",
        "/old-blog/*": "/blog/*",
        "/shop": "https://shop.example.com/"
      }
    }
  }
}
```

Redirects usually apply to every environment, so `config/default.json` is the
right place. Restart the app after changing config.

## Verify

1. With `DEBUG=true`, the log shows `[Extension] redirects: active (3 rules, status 301)`.
2. Request an old URL without following redirects:

   ```bash
   curl -I http://localhost:3000/about-us
   ```

   The response is `301` with `Location: /about`.

## Rules

Each key is an old path; each value is where it now lives.

| Rule | Request | Redirects to |
| --- | --- | --- |
| `"/about-us": "/about"` | `/about-us?ref=mail` | `/about?ref=mail` |
| `"/old-blog/*": "/blog/*"` | `/old-blog/2024/post` | `/blog/2024/post` |
| `"/old-blog/*": "/blog/*"` | `/old-blog` | `/blog` |
| `"/legacy/*": "/"` | `/legacy/anything` | `/` |
| `"/shop": "https://shop.example.com/"` | `/shop` | `https://shop.example.com/` |

- **Old path (key):** starts with `/`, with no query string. End it with `/*`
  to cover a whole section, including the section's own path. `/` and `/*`
  can't be redirected.
- **New location (value):** a path on this site or a full `http(s)` URL. A
  `/*` value keeps the rest of the old path; it needs a `/*` key.
- **Query strings** are passed on, unless the new location has its own.
- **Matching** is exact and case-sensitive. Altair first removes trailing
  slashes, so `/about-us/` also ends at `/about`.
- **No chains.** A rule whose new location is itself redirected by another
  rule stops startup, naming both, so visitors never go through two
  redirects. Point the first rule straight at the final URL.
- **The most specific rule wins**, whatever the order in config: an exact
  rule before a section rule, and a longer section before a shorter one. So
  `"/old-blog/special": "/promo"` can sit next to `"/old-blog/*": "/blog/*"`
  as an exception.
- A rule wins over a page with the same path; startup warns when that happens.

## Settings

All settings go in `extensions.redirects`. Leave out any you don't need; a
missing setting means "do nothing".

| Setting | Type | If absent | Purpose |
| --- | --- | --- | --- |
| `rules` | object | Extension inactive | Old path → new location, as above. An invalid rule stops startup. |
| `status` | number | `301` | `301` or `308` for permanent moves, `302` or `307` for temporary ones. `308` and `307` keep the request method. |

Use a permanent status only for moves you won't undo: browsers remember
permanent redirects.

## What it doesn't do

- **Only `GET` and `HEAD`.** A form posting to an old URL gets `404`; update
  the form instead.
- **No patterns beyond `/*`.** No regular expressions or placeholders.
- **No redirects in content.** Rules live in config, so changing them needs a
  restart.

## Turning it off

- **Temporarily:** remove the `redirects` block (or its `rules`) from the
  config file and restart.
- **Permanently:** also remove `redirects` from `static extensions` in
  `web-app.js`.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Log says `inactive (no extensions.redirects config)` | `NODE_ENV` isn't an environment whose config holds the block. |
| Log says `inactive (no rules configured)` | The block exists but has no `rules`. |
| Startup error `invalid source` | A key doesn't start with `/`, contains a query string or `*` in the middle, or is `/` or `/*`. |
| Startup error `target must be a path` | A value isn't a site path or a full `http(s)` URL. `//host` isn't allowed. |
| Startup error `redirected again` | Two rules form a chain or loop. |
| Startup error about a duplicate route | A rule uses the same path as a route from another extension (for example `/sitemap.xml`). |
| Warning `is also a page` | A rule hides a page that still exists. Delete the page or the rule. |

## Tests

```bash
pnpm test:extensions
```
