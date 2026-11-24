# Shared libraries

Plain modules used by the extensions in this library and available to your
own code under `web-app/` (custom routes, a sign-in flow, scheduled jobs).
They are not extensions: nothing here runs unless something imports it.

| Module | What it does | Environment |
| --- | --- | --- |
| `config.js` | Setting validators for extensions, and `envReader()` | none |
| `mail/mailer.js` | Sends email through `MAIL_PROVIDER` (`ses` or `log`); validates every address and subject | `MAIL_PROVIDER`, `MAIL_SES_REGION`, `MAIL_SES_ACCESS_KEY_ID`, `MAIL_SES_SECRET_ACCESS_KEY` |
| `mail/ses.js` | The SES transport: SES API v2 `SendEmail` over `fetch`, retried on throttling and server errors. Loaded by the mailer only when `MAIL_PROVIDER=ses` | none |
| `aws/sigv4.js` | AWS Signature Version 4 request signing, checked against AWS's test suite and the AWS SDK's signer | none |
| `aws/credentials.js` | Fixed keys, or the role the server runs under (ECS/Fargate, App Runner, EKS Pod Identity, EC2 IMDSv2), refreshed before expiry | `AWS_CONTAINER_*`, set by the platform |
| `turnstile.js` | Verifies Cloudflare Turnstile tokens | `TURNSTILE_SECRET_KEY` |

The environment variables are described in `extensions/forms/README.md` and
`.env.example`. They are named for the capability (mail, Turnstile), not for
one feature, so every part of the site that sends mail shares one transport.

## Using them in application code

Read the environment once at startup, as the extensions do, and keep the
resulting objects. `onSettingsReady()` is not awaited, so keep the mailer as a
promise; a missing or invalid variable still throws there and stops startup:

```js
// web-app/web-app.js
import { envReader } from '../extensions/_shared/config.js';
import { createMailer, resolveMailerOptions } from '../extensions/_shared/mail/mailer.js';
import { createTurnstileVerifier, TURNSTILE_RESPONSE_FIELD } from '../extensions/_shared/turnstile.js';

class WebApp extends WebServer {

  onSettingsReady() {
    const env = envReader();
    this.mailer = createMailer(resolveMailerOptions(env));
    this.turnstile = createTurnstileVerifier({ secret: env('TURNSTILE_SECRET_KEY') });
  }

  additionalRoutes() {
    this.app.post('/account/sign-up', async (context) => {
      const body = await context.req.parseBody();
      const check = await this.turnstile.verify({
        token: body[TURNSTILE_RESPONSE_FIELD],
        action: 'sign-up',
        hostnames: ['example.com']
      });
      if (!check.success) return context.text('Verification failed', 403);

      const confirmationToken = await createConfirmationToken(body.email); // your own code
      const mailer = await this.mailer;
      await mailer.send({
        from: 'Example <no-reply@example.com>',
        to: String(body.email),
        subject: 'Confirm your email address',
        text: `Open this link to confirm: https://example.com/account/confirm?token=${confirmationToken}`
      });
      return context.redirect('/account/check-your-email', 303);
    });
  }
}
```

- `mailer.send()` throws if an address is invalid or a subject contains a line
  break, before anything is sent. Catch it and answer with your own error.
- `mailer.close()` ends the transport; call it from your shutdown code
  (`(await this.mailer).close()`). Neither provider holds a connection
  today, so it is there for transports that will.
- `verify()` never throws. `success` is false when the token is missing,
  refused, solved for another `action` or hostname, or Cloudflare cannot be
  reached (`errorCodes` includes `request-failed`).
- Protect your own POST routes from cross-site posts too, for example with
  Hono's `csrf()`, and add `bodyLimit()`.
