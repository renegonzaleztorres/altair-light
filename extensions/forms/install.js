// @ts-check
/**
 * Install plan for the forms extension, run by `pnpm extension:add forms`
 * (extensions/add.js). It adds a working contact form for development: the
 * page and email templates from starter/ into the active space, the
 * extensions.forms block (starter/config.json) to config/development.json,
 * the MAIL_* and TURNSTILE_SECRET_KEY variables (starter/env.txt), and
 * `forms` in web-app/web-app.js. Once installed, those files are the
 * project's to change.
 */

/** @type {import('../add.js').InstallPlan} */
export default {
  export: 'forms',
  module: 'extensions/forms/forms.js',
  files: [
    { from: 'starter/pages/contact-us.html', to: 'pages/contact-us.html' },
    { from: 'starter/_emails/contact-us.txt', to: '_emails/contact-us.txt' },
    { from: 'starter/_emails/contact-us-confirmation.txt', to: '_emails/contact-us-confirmation.txt' }
  ],
  config: { key: 'forms', from: 'starter/config.json', environment: 'development' },
  env: { from: 'starter/env.txt' },
  scripts: ['css:build'],
  next: [
    'Restart the server and open /contact-us. MAIL_PROVIDER=log prints each email in the server log.',
    'The development origins are http://127.0.0.1:3000 and http://localhost:3000; change extensions.forms.origin in config/development.json if your server uses another port.',
    'Replace the example.com addresses in config/development.json, and link /contact-us from your navigation.',
    'Before going live: add an extensions.forms block with your origin, addresses and real Turnstile site key to config/production.json, and set MAIL_PROVIDER=ses and MAIL_SES_REGION. See extensions/forms/README.md, "Going live with SES".'
  ]
};
