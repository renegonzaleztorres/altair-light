# Forms extension

Receives HTML form submissions, checks them against the fields you define in
config, and emails them: a notification to you and, optionally, a
confirmation to the person who wrote.

- Off until you list it in code **and** configure at least one form.
- **The site owns the markup.** The extension renders nothing. It gives each
  form an endpoint, validates what arrives, sends the mail, and answers with a
  redirect (plain HTML forms) or JSON (forms sent with `fetch`).
- Mail goes through the shared mailer (`extensions/_shared/mail`), so the same
  `MAIL_*` settings serve any other code that sends email. Amazon SES is the
  sending provider; `log` prints messages instead, for development.
- Optional Cloudflare Turnstile spam check, through the shared verifier
  (`extensions/_shared/turnstile.js`).
- Requires Altair 4.3.0 or later (extension API 1). No npm packages: SES is
  called with `fetch` and Signature Version 4 signing, not the AWS SDK.

## How a submission is handled

Each form `<name>` gets two routes, and the extension serves one script:

| Route | Purpose |
| --- | --- |
| `POST /forms/<name>` | The form's `action`. Handles the submission |
| `GET /forms/<name>` | JSON description of the form for page scripts: fields and rules, and the Turnstile site key. Never includes recipients or secrets |
| `GET /forms/client.js` | Optional browser script (`client.js`) that submits forms with `fetch`, shows errors next to fields and renders Turnstile. Revalidated on each load, so an update reaches visitors with the next deploy |

A `POST` goes through these steps; the first one that fails answers:

1. **Origin check** (Hono `csrf()`): the browser's `Sec-Fetch-Site` must be
   `same-origin`, or its `Origin` must be one of `origin` in config. → `403`
2. **Size limit** (`maxBodyBytes`). → `413`
3. **Form encodings only**: `application/x-www-form-urlencoded` or
   `multipart/form-data` (what `<form>` and `fetch` with `FormData` send).
   JSON is refused, so step 1 covers every request accepted. → `415`
4. **Honeypot**: if the hidden field is filled, the reply looks like success
   but nothing is sent.
5. **Field validation** against config. → `422` with one error per field
6. **Turnstile** (forms with `turnstile: true`): the token must be valid, for
   this form's action, solved on one of your origins. Checked after
   validation, so a typo does not use up the visitor's token. → `403`
7. **Notification email** to you. → `502` with a reference if it fails
8. **Confirmation email** to the visitor (optional). A failure here is
   logged but the visitor still sees success, because you got the message.
9. **Success**: `303` to `redirect.success`, or JSON `{ ok: true }`.

Every response has `Cache-Control: no-store`. The page that shows the form is
an ordinary cached page: no per-visitor token is needed, which is why CSRF
protection uses the origin check.

## Setup

### Quick start: the installer

```bash
pnpm extension:add forms
```

It sets up steps 1 to 5 below for development, with a working contact page:

| What | Where |
| --- | --- |
| Contact page | `spaces/<space>/pages/contact-us.html` |
| Email templates | `spaces/<space>/_emails/contact-us.txt`, `contact-us-confirmation.txt` |
| Form definition, with Turnstile test keys and `example.com` addresses | `extensions.forms` in `config/development.json` |
| `MAIL_*` (`MAIL_PROVIDER="log"`) and `TURNSTILE_SECRET_KEY` (a test secret) | appended to `.env.example`, and to `.env` if you have one |
| `import { forms }` and `forms` in `static extensions` | `web-app/web-app.js` |

It then runs `pnpm css:build` for the page's Tailwind classes and prints what
is left to do by hand.

- **Safe to run.** It never overwrites a file. If a file is already there
  with different content, it reports a conflict and changes nothing at all.
  Settings and variables you already have are kept, and running it twice
  changes nothing. `--dry-run` lists the changes without making them.
- **Your files afterwards.** The installed page, templates and config are the
  project's to edit; they come from `extensions/forms/starter/`, which is
  updated with Altair-Light and never read by the server.
- **What it leaves to you.** It edits only `config/development.json`. Add your
  production block (origin, addresses, real Turnstile site key) and mail
  settings yourself; see "Going live with SES". If `web-app.js` does not have
  the usual one-line `static extensions = […]`, it prints the two lines to
  add instead of changing the file.
- **Another space.** It installs into `ACTIVE_SPACE` (from the environment or
  `.env`), or `spaces/kinetic`; `--space spaces/<name>` chooses another.

The steps below explain each part, for setting it up by hand or adapting it.

### 1. List the extension (`web-app/web-app.js`)

```js
import WebServer from '../altair/altair.js';
import { forms } from '../extensions/forms/forms.js';

class WebApp extends WebServer {
  static extensions = [forms];
}
```

### 2. Set the environment (`.env`)

```bash
# "log" while developing; "ses" to send
MAIL_PROVIDER="log"
MAIL_SES_REGION="us-east-1"
MAIL_SES_ACCESS_KEY_ID=""
MAIL_SES_SECRET_ACCESS_KEY=""

# Only when a form uses Turnstile
TURNSTILE_SECRET_KEY=""
```

| Variable | Required | Meaning |
| --- | --- | --- |
| `MAIL_PROVIDER` | Yes | `ses` sends through Amazon SES. `log` prints each message to the console and sends nothing |
| `MAIL_SES_REGION` | With `ses` | AWS region where your sending identity is verified, such as `us-east-1` |
| `MAIL_SES_ACCESS_KEY_ID`, `MAIL_SES_SECRET_ACCESS_KEY` | No | Access keys of an IAM user that may only send email (see "Going live with SES"). Set both, or leave both empty to use the role the server runs under: an ECS or Fargate task role, App Runner, EKS Pod Identity, or an EC2 instance role. Credentials from `~/.aws` profiles, SSO and EKS IRSA are not read; use keys there |
| `TURNSTILE_SECRET_KEY` | With Turnstile | The widget's secret key from the Cloudflare dashboard |

The names are not specific to forms: any code in the site that sends mail or
checks Turnstile reads the same variables (see `extensions/_shared/README.md`).

### 3. Define the form (`config/<environment>.json`)

```json
{
  "extensions": {
    "forms": {
      "origin": "https://example.com",
      "timeZone": "America/New_York",
      "turnstile": { "siteKey": "0x4AAAAAAA…" },
      "forms": {
        "contact-us": {
          "fields": {
            "name":    { "type": "text", "label": "Name", "required": true, "maxLength": 100 },
            "email":   { "type": "email", "label": "Email", "required": true },
            "topic":   { "type": "select", "label": "Topic", "options": ["general", "support"] },
            "message": { "type": "textarea", "label": "Message", "required": true, "minLength": 10 },
            "copy":    { "type": "checkbox", "label": "Copy requested" }
          },
          "honeypot": "website",
          "turnstile": true,
          "notification": {
            "from": "Example <no-reply@example.com>",
            "to": ["hello@example.com"],
            "replyToField": "email",
            "subject": "[Contact · {{topic}}] {{name}}",
            "template": "_emails/contact-us.txt"
          },
          "confirmation": {
            "toField": "email",
            "ifChecked": "copy",
            "replyTo": "hello@example.com",
            "subject": "We received your message",
            "template": "_emails/contact-us-confirmation.txt"
          },
          "redirect": { "success": "/contact-us?status=sent", "error": "/contact-us" }
        }
      }
    }
  }
}
```

Every setting is checked at startup; a mistake stops the server with a
message naming the setting.

#### Top level

| Setting | Required | Meaning |
| --- | --- | --- |
| `origin` | Yes | The site's origin, or a list of them (`["http://127.0.0.1:3000", "http://localhost:3000"]`). Used by the origin check and to check where Turnstile was solved. Set it explicitly because behind a TLS proxy the server cannot tell its public origin from the request |
| `forms` | Yes | One entry per form. The name (lowercase letters, digits, `-`) becomes `/forms/<name>` |
| `turnstile.siteKey` | With Turnstile | The widget's public site key |
| `timeZone` | No | IANA time zone for `{{_submittedAtLocal}}` |
| `maxBodyBytes` | No | Largest accepted body, 1024 to 1048576. Default 65536 |

#### A form

| Setting | Required | Meaning |
| --- | --- | --- |
| `fields` | Yes | The fields to accept, by `name` attribute. Anything else posted is ignored |
| `notification` | Yes | The email you receive |
| `confirmation` | No | An email to the visitor. Needs `turnstile: true` (see "Security") |
| `honeypot` | No | Name of a hidden field that people leave empty |
| `turnstile` | No | `true` to require the Turnstile check |
| `redirect` | No | `success` and `error` pages for forms posted without JavaScript. Without it, those requests get a short text reply |

#### Fields

| Setting | Applies to | Meaning |
| --- | --- | --- |
| `type` | all | `text`, `email`, `textarea`, `tel`, `url`, `select` or `checkbox` |
| `label` | all | Name used in emails. Default: the field name |
| `required` | all | Must be filled; for a checkbox, must be ticked |
| `minLength`, `maxLength` | not checkbox | In characters. Default `maxLength`: text and select 200, email 254, textarea 5000, tel 40, url 2000 |
| `pattern` | not checkbox | Regular expression the whole value must match |
| `options` | select | The allowed values |

Values are trimmed. Line breaks are allowed only in `textarea`; control
characters are refused everywhere. `email` must be one address, `url` an http
or https URL. A checkbox is reported as `Yes` or `No`.

#### `notification` and `confirmation`

| Setting | In | Meaning |
| --- | --- | --- |
| `from` | both | Sender, `"Name <address>"` or `"address"`. Must be verified in SES. The confirmation defaults to the notification's |
| `to`, `cc`, `bcc` | notification | Your recipients, one address or a list |
| `replyToField` | notification | An `email` field: replying to the notification answers the visitor |
| `toField` | confirmation | The `email` field to send the confirmation to |
| `ifChecked` | confirmation | A `checkbox` field: send the confirmation only when it is ticked |
| `replyTo` | confirmation | Where replies to the confirmation go, usually your own address |
| `subject` | both | One line, with placeholders |
| `template` | both | Body from a text file, path relative to the active space (`_emails/contact-us.txt`). Must be in a folder or file whose name starts with `_` (see step 4) |
| `text` | both | Body written inline. Use `template` or `text`; the notification has a default body, the confirmation needs one |

### 4. Write the email templates (`spaces/<space>/_emails/`)

Plain text with `{{placeholders}}`. Edits are picked up when the space
watcher reports a content change, or on restart.

**Templates must be in a private path**: a folder or file whose name starts
with `_`, such as `_emails/contact.txt`, and not under `public/`. Altair never
serves a path with a `_` segment (the same rule keeps `pages/_404.html` and
`js/_scripts/` partials private), whatever file types it serves now or
later. `public/` is the exception: its files are served as they are, so it is
refused too. A template anywhere else stops startup with a message naming the
setting.

| Placeholder | Value |
| --- | --- |
| `{{fieldName}}` | The submitted value of that field |
| `{{_fields}}` | Every field as `Label: value` lines, in config order |
| `{{_form}}` | The form name |
| `{{_reference}}` | A unique ID for this submission, also returned to the visitor and logged |
| `{{_submittedAt}}` | Time received, ISO 8601 UTC (`2026-11-17T15:04:05.000Z`) |
| `{{_submittedAtUtc}}` | Same, readable (`Tue, 17 Nov 2026 15:04:05 GMT`) |
| `{{_submittedAtLocal}}` | Same, in `timeZone` (`Tuesday, November 17, 2026 at 10:04:05 AM EST`); needs `timeZone` |
| `{{_page}}` | The path of the page the form was sent from, when the browser says so |
| `{{_site}}` | The first `origin` |

An unknown placeholder stops startup. In subjects, line breaks in values
become spaces.

The default notification body is:

```text
New "{{_form}}" submission

{{_fields}}

Submitted: {{_submittedAtUtc}}
Page: {{_page}}
Reference: {{_reference}}
```

### 5. Write the form (your page)

Point the form at its endpoint and use the configured field names:

```html
<form action="/forms/contact-us" method="post">
  <input name="name" required maxlength="100">
  <input name="email" type="email" required>
  <textarea name="message" required></textarea>
  <!-- honeypot: off screen, never display:none -->
  <div style="position:absolute;left:-9999px" aria-hidden="true">
    <input name="website" tabindex="-1" autocomplete="off">
  </div>
  <div data-turnstile></div>
  <button>Send</button>
</form>
```

That works without JavaScript. To submit with `fetch` instead, send
`new FormData(form)` with `Accept: application/json` (a JSON body is refused).

Or load the extension's script, which does that for every
`<form data-altair-form>`:

```html
<script src="/forms/client.js" defer></script>
```

It submits with `fetch`, shows errors in `[data-error-for="<field>"]`
elements, puts the result in a `[data-form-status]` element, reads the
`?status=` of a plain redirect, and renders Turnstile in `[data-turnstile]`
from the `GET` description. The installed `contact-us.html`
(`starter/pages/contact-us.html`) is a full example.

## Responses

With `Accept: application/json`:

| Status | Body |
| --- | --- |
| `200` | `{ "ok": true, "reference": "…" }` |
| `422` | `{ "ok": false, "error": "invalid", "fields": { "email": "invalid", "message": "required" } }` |
| `403` | `{ "ok": false, "error": "challenge" }` (Turnstile) |
| `502` | `{ "ok": false, "error": "delivery", "reference": "…" }` |
| `415` | `{ "ok": false, "error": "unsupported" }` |
| `400` | `{ "ok": false, "error": "bad_request" }` |

Field error codes are `required`, `too_short`, `too_long` and `invalid`.
`403` from the origin check and `413` from the size limit come from Altair as
plain text.

Without it, with `redirect` set, the reply is a `303`: to `redirect.success`,
or to `redirect.error` with `?status=invalid&fields=email,message`,
`?status=challenge` or `?status=delivery&reference=…` added. Pages are
cached, so show these with a script reading the query string.

## Security

- **Mail headers cannot be injected.** Values that reach a header (the
  subject, the reply-to address) are single-line and validated, and the
  mailer refuses any address or subject containing a line break.
- **Confirmations need Turnstile.** A confirmation sends mail to an address
  the visitor typed. Without a challenge, a script could use the form to send
  your mail to anyone, so `confirmation` without `turnstile: true` stops
  startup.
- **No per-IP rate limiting yet.** It needs trusted client-IP handling behind
  proxies (Altair roadmap). Turnstile and the honeypot are the spam defence
  meanwhile; a CDN or proxy rate limit on `POST /forms/*` adds to them.
- **Content Security Policy.** If the site sets a CSP, allow
  `https://challenges.cloudflare.com` in `script-src` and `frame-src` for
  Turnstile.
- **Templates are never served.** They must sit in a `_` path outside
  `public/` (see step 4), so a visitor cannot read them even if Altair later
  serves more file types.
- Logs contain the form name, reference and errors, never field values.

## Testing locally

- `MAIL_PROVIDER=log` prints each email to the console.
- Cloudflare publishes Turnstile test keys that work on any hostname:

  | Site key | Behaviour |
  | --- | --- |
  | `1x00000000000000000000AA` | Always passes (visible) |
  | `2x00000000000000000000AB` | Always fails (visible) |
  | `3x00000000000000000000FF` | Forces an interactive challenge |

  | Secret key | Behaviour |
  | --- | --- |
  | `1x0000000000000000000000000000000AA` | Always passes |
  | `2x0000000000000000000000000000000AA` | Always fails |
  | `3x0000000000000000000000000000000AA` | Fails as "token already spent" |

  With a test secret the action and hostname checks are skipped (Cloudflare
  answers with placeholders), and startup prints a warning.

With `DEBUG=true`, startup logs `forms: active (/forms/contact-us; mail via
log, Turnstile on)`.

## Going live with SES

1. In the SES console for your region, verify the sending domain (preferred)
   or the `from` address. Set up DKIM for the domain.
2. New SES accounts are in the **sandbox**: they can send only to verified
   addresses. Verify your recipients to test, then request production access.
3. Create credentials. On AWS, give the instance or task role the policy
   below and leave the keys empty. Elsewhere, create an IAM user with only
   this policy and put its access keys in `MAIL_SES_ACCESS_KEY_ID` and
   `MAIL_SES_SECRET_ACCESS_KEY`:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": "ses:SendEmail",
       "Resource": "arn:aws:ses:us-east-1:123456789012:identity/*",
       "Condition": { "StringEquals": { "ses:FromAddress": "no-reply@example.com" } }
     }]
   }
   ```

   A leaked key can then only send as that address.
4. Set `MAIL_PROVIDER=ses` and `MAIL_SES_REGION`, restart, and send a test
   message. A rejected message is logged as
   `forms: notification not sent (reference …): SES SendEmail failed (MessageRejected): …`.

## Footprint

Measured as in the extension API design (separate processes, three runs each,
route cache on, 300 page requests, garbage collected), against Altair alone at
10.7–10.9 MB of heap:

| Setup | Heap | Startup |
| --- | --- | --- |
| Listed, not configured | +0.2 MB | no change |
| Active, `MAIL_PROVIDER=log` | +0.3 MB; +0.5 to +0.7 MB after handling submissions | +2 ms |
| Active, `MAIL_PROVIDER=ses` | about the same as `log` | about the same as `log` |

The SES transport is about 190 lines of code without comments: the `fetch`
call (`mail/ses.js`), request signing (`aws/sigv4.js`) and role credentials
(`aws/credentials.js`) in `extensions/_shared/`. With `@aws-sdk/client-sesv2` instead, SES cost
about +3.4 MB of heap and +25–40 ms of startup.

## Turning it off

Delete the `extensions.forms` block (or its `forms` entry) from config, or
remove `forms` from `static extensions`. The `MAIL_*` and `TURNSTILE_*`
variables are then unused.

To remove what the installer added, delete `pages/contact-us.html` and the
`_emails/contact-us*.txt` templates from the space, the `extensions.forms`
block from `config/development.json`, the import and list entry from
`web-app/web-app.js`, and the `MAIL_*` and `TURNSTILE_SECRET_KEY` lines from
`.env.example` and `.env` (unless other code sends mail). Then run
`pnpm css:build`.
