# My extension (template)

One or two sentences: what the extension does for a site.

- Off until it is listed in `web-app/web-app.js` **and** its config block exists.
- Requires Altair 4.2.0 or later (extension API 1). No extra npm packages.

## Setup

### 1. List the extension (`web-app/web-app.js`)

```js
import { myExtension } from '../extensions/my-extension/my-extension.js';

class WebApp extends WebServer {
  static extensions = [myExtension];
}
```

### 2. Configure it (`config/<environment>.json`)

```json
{
  "extensions": {
    "myExtension": {
      "greeting": "Hello"
    }
  }
}
```

Put the block only in the config file of each environment that should run it.
`config/default.json` applies to every environment.

### 3. Secrets (`.env`), if any

Name each environment variable the extension reads with `api.env()`. Never put
secrets in config files.

## Settings

| Setting | Type | If absent | Purpose |
| --- | --- | --- | --- |
| `greeting` | string | No variable added | Value of `@@VAR_greeting` |

## Verify

With `DEBUG=true`, startup logs `[Extension] my-extension active`.

## Turning it off

Remove its config block and restart. To uninstall, also remove it from
`static extensions`.
