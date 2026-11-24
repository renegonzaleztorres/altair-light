// @ts-check
/**
 * Forms extension
 *
 * Receives HTML form submissions, validates them against fields defined in
 * settings.extensions.forms, and emails them. The site owns the markup: this
 * extension only registers, for each configured form,
 *
 *   POST /forms/<name>   the submission endpoint (the form's action)
 *   GET  /forms/<name>   a JSON description (fields, rules, Turnstile site key)
 *                        that page scripts may use; it never contains secrets
 *
 * and, once, GET /forms/client.js: the optional browser script (client.js)
 * that submits forms with fetch, shows field errors and renders Turnstile.
 *
 * A submission goes through: CSRF origin check → body size limit → form
 * encodings only → honeypot → field validation → Turnstile (when enabled) →
 * notification email → optional confirmation email to the sender → a 303
 * redirect (plain HTML forms) or JSON (fetch with Accept: application/json).
 *
 * Transport and secrets come from the environment, through the shared
 * libraries in extensions/_shared: MAIL_* for the mailer (mail/mailer.js) and
 * TURNSTILE_SECRET_KEY for Turnstile (turnstile.js).
 */

import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { bodyLimit } from 'hono/body-limit';
import { csrf } from 'hono/csrf';

import { defineExtension } from '../../altair/extensions.js';
import { resolveBaseUrl } from '../_shared/config.js';
import { createMailer, isEmailAddress, parseMailbox, parseMailboxes, resolveMailerOptions } from '../_shared/mail/mailer.js';
import { createTurnstileVerifier, TURNSTILE_RESPONSE_FIELD, TURNSTILE_SCRIPT_URL } from '../_shared/turnstile.js';

export const ROUTE_PREFIX = '/forms';
export const CLIENT_SCRIPT_PATH = `${ROUTE_PREFIX}/client.js`;

const FORM_NAME = /^[a-z][a-z0-9-]*$/;
const FIELD_NAME = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const TOKEN = /\{\{\s*([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}/g;
const FIELD_TYPES = /** @type {const} */ ({ text: 200, email: 254, textarea: 5000, tel: 40, url: 2000, select: 200, checkbox: 0 });
const META_TOKENS = ['_form', '_reference', '_submittedAt', '_submittedAtUtc', '_submittedAtLocal', '_page', '_fields', '_site'];
const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const TEL = /^\+?[0-9()\-.\s]+$/;
const CONTROL_SINGLE_LINE = /[\u0000-\u001f\u007f]/;
const CONTROL_MULTI_LINE = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const DEFAULT_NOTIFICATION = [
  'New "{{_form}}" submission',
  '',
  '{{_fields}}',
  '',
  'Submitted: {{_submittedAtUtc}}',
  'Page: {{_page}}',
  'Reference: {{_reference}}',
  ''
].join('\n');

/**
 * @typedef {{ name: string, type: keyof typeof FIELD_TYPES, label: string, required: boolean,
 *   minLength?: number, maxLength?: number, pattern?: RegExp, patternSource?: string, options?: string[] }} Field
 * @typedef {{ setting: string, file?: string, text?: string }} BodySource
 * @typedef {object} Form
 * @property {string} name
 * @property {Field[]} fields
 * @property {string} [honeypot]
 * @property {boolean} turnstile
 * @property {{ from: string, to: string[], cc: string[], bcc: string[],
 *   replyToField?: string, subject: string, body: BodySource }} notification
 * @property {{ from: string, toField: string, ifChecked?: string, replyTo: string[], subject: string, body: BodySource }} [confirmation]
 * @property {{ success: string, error: string }} [redirect]
 */

/**
 * plainObject : throw unless value is a plain object
 * @param {unknown} value
 * @param {string} setting
 * @returns {Record<string, any>}
 */
const plainObject = (value, setting) => {

  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${setting} must be an object`);
  return /** @type {Record<string, any>} */ (value);

} // plainObject

/**
 * nonEmptyString : a required one-line string setting
 * @param {unknown} value
 * @param {string} setting
 */
const nonEmptyString = (value, setting) => {

  if (typeof value !== 'string' || value.trim() === '' || /[\r\n]/.test(value)) throw new Error(`${setting} must be a non-empty line of text`);
  return value;

} // nonEmptyString

/**
 * addressList : one address or a list, validated, as strings; required lists need at least one
 * @param {unknown} value
 * @param {string} setting
 * @param {boolean} [required]
 * @returns {string[]}
 */
const addressList = (value, setting, required = false) => {

  parseMailboxes(value, setting, { required });
  return value === undefined ? [] : /** @type {string[]} */ ([value].flat());

} // addressList

/**
 * singleAddress : one validated address ("Name <address>" or "address"), kept as written
 * @param {unknown} value
 * @param {string} setting
 */
const singleAddress = (value, setting) => {

  parseMailbox(value, setting);
  return /** @type {string} */ (value);

} // singleAddress

/**
 * lengthSetting : optional positive integer
 * @param {unknown} value
 * @param {string} setting
 */
const lengthSetting = (value, setting) => {

  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || /** @type {number} */ (value) < 1) throw new Error(`${setting} must be a positive integer`);
  return /** @type {number} */ (value);

} // lengthSetting

/**
 * sitePath : a redirect target on this site, "/path" with an optional query
 * @param {unknown} value
 * @param {string} setting
 */
const sitePath = (value, setting) => {

  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /\s/.test(value)) {
    throw new Error(`${setting} must be a path on this site, such as /contact?status=sent`);
  }
  return value;

} // sitePath

/**
 * resolveField : validate one field definition
 * @param {string} formName
 * @param {string} name
 * @param {unknown} definition
 * @returns {Field}
 */
const resolveField = (formName, name, definition) => {

  const setting = `extensions.forms.forms.${formName}.fields.${name}`;
  if (!FIELD_NAME.test(name) || name === TURNSTILE_RESPONSE_FIELD) {
    throw new Error(`${setting}: field names start with a letter and use letters, digits, - or _`);
  }
  const field = plainObject(definition, setting);
  const type = field.type;
  if (!Object.hasOwn(FIELD_TYPES, type)) throw new Error(`${setting}.type must be one of ${Object.keys(FIELD_TYPES).join(', ')}`);
  if (field.required !== undefined && typeof field.required !== 'boolean') throw new Error(`${setting}.required must be true or false`);
  const label = field.label === undefined ? name : nonEmptyString(field.label, `${setting}.label`);
  /** @type {Field} */
  const resolved = { name, type, label, required: field.required === true };
  if (type === 'checkbox') {
    for (const key of ['minLength', 'maxLength', 'pattern', 'options']) {
      if (field[key] !== undefined) throw new Error(`${setting}.${key} does not apply to a checkbox`);
    }
    return resolved;
  }

  const minLength = lengthSetting(field.minLength, `${setting}.minLength`);
  const maxLength = lengthSetting(field.maxLength, `${setting}.maxLength`) ?? FIELD_TYPES[type];
  if (minLength !== undefined && minLength > maxLength) throw new Error(`${setting}.minLength is greater than maxLength (${maxLength})`);
  if (minLength !== undefined) resolved.minLength = minLength;
  resolved.maxLength = maxLength;

  if (field.pattern !== undefined) {
    if (typeof field.pattern !== 'string' || field.pattern === '') throw new Error(`${setting}.pattern must be a regular expression string`);
    try {
      resolved.pattern = new RegExp(`^(?:${field.pattern})$`, 'u');
    } catch (error) {
      throw new Error(`${setting}.pattern is not a valid regular expression: ${error.message}`);
    }
    resolved.patternSource = field.pattern;
  }

  if (type === 'select') {
    if (!Array.isArray(field.options) || field.options.length === 0 || field.options.some((option) => typeof option !== 'string' || option === '')) {
      throw new Error(`${setting}.options must be a non-empty array of strings`);
    }
    resolved.options = [...field.options];
  } else if (field.options !== undefined) {
    throw new Error(`${setting}.options applies only to a select field`);
  }
  return resolved;

} // resolveField

/**
 * resolveBody : a message body from a template file in the active space, inline text, or the default.
 * Template files must be private: in a folder or file whose name starts with "_" (Altair never
 * serves those paths) and not under the public folder (served as is, underscore or not).
 * @param {Record<string, any>} block
 * @param {string} setting
 * @param {{ spacePath: string, publicPath: string }} paths
 * @param {string | undefined} fallback Default text, or undefined when a body is required
 * @returns {BodySource}
 */
const resolveBody = (block, setting, { spacePath, publicPath }, fallback) => {

  if (block.template !== undefined && block.text !== undefined) throw new Error(`${setting}: set template or text, not both`);
  if (block.template !== undefined) {
    if (typeof block.template !== 'string' || block.template === '' || path.isAbsolute(block.template)) {
      throw new Error(`${setting}.template must be a file path relative to the active space, such as _emails/contact.txt`);
    }
    const file = path.resolve(spacePath, block.template);
    if (!file.startsWith(`${spacePath}${path.sep}`)) throw new Error(`${setting}.template must stay inside the active space`);
    if (file.startsWith(`${publicPath}${path.sep}`)) {
      throw new Error(`${setting}.template must not be in the public folder, whose files are served as they are`);
    }
    if (!path.relative(spacePath, file).split(path.sep).some((segment) => segment.startsWith('_'))) {
      throw new Error(`${setting}.template must be in a folder or file whose name starts with "_", such as _emails/contact.txt, so it is never served`);
    }
    return { setting: `${setting}.template (${block.template})`, file };
  }
  if (block.text !== undefined) {
    if (typeof block.text !== 'string' || block.text.trim() === '') throw new Error(`${setting}.text must be a non-empty string`);
    return { setting: `${setting}.text`, text: block.text };
  }
  if (fallback === undefined) throw new Error(`${setting} needs a template file or text`);
  return { setting: `${setting} (default body)`, text: fallback };

} // resolveBody

/**
 * checkTokens : every {{placeholder}} must name a field or a meta value
 * @param {string} text
 * @param {Set<string>} allowed
 * @param {string} setting
 */
const checkTokens = (text, allowed, setting) => {

  for (const [, token] of text.matchAll(TOKEN)) {
    if (!allowed.has(token)) {
      const hint = token === '_submittedAtLocal' ? '; set extensions.forms.timeZone to use it' : `; use a field name or one of ${META_TOKENS.join(', ')}`;
      throw new Error(`${setting}: unknown placeholder {{${token}}}${hint}`);
    }
  }
  return text;

} // checkTokens

/**
 * resolveForm : validate one form definition
 * @param {string} name
 * @param {unknown} definition
 * @param {{ paths: { spacePath: string, publicPath: string }, turnstileConfigured: boolean, tokens: (fields: Field[]) => Set<string> }} context
 * @returns {Form}
 */
const resolveForm = (name, definition, { paths, turnstileConfigured, tokens }) => {

  const setting = `extensions.forms.forms.${name}`;
  if (!FORM_NAME.test(name)) throw new Error(`extensions.forms.forms: invalid form name ${JSON.stringify(name)}; use lowercase letters, digits and -`);
  const form = plainObject(definition, setting);

  const fieldBlock = plainObject(form.fields, `${setting}.fields`);
  const fields = Object.entries(fieldBlock).map(([fieldName, field]) => resolveField(name, fieldName, field));
  if (fields.length === 0) throw new Error(`${setting}.fields needs at least one field`);
  const byName = new Map(fields.map((field) => [field.name, field]));
  const emailField = (/** @type {unknown} */ value, /** @type {string} */ key) => {
    if (typeof value !== 'string' || byName.get(value)?.type !== 'email') throw new Error(`${key} must name an email field of this form`);
    return value;
  };
  const checkboxField = (/** @type {unknown} */ value, /** @type {string} */ key) => {
    if (typeof value !== 'string' || byName.get(value)?.type !== 'checkbox') throw new Error(`${key} must name a checkbox field of this form`);
    return value;
  };

  let honeypot;
  if (form.honeypot !== undefined) {
    if (typeof form.honeypot !== 'string' || !FIELD_NAME.test(form.honeypot) || byName.has(form.honeypot)) {
      throw new Error(`${setting}.honeypot must be a field name that is not one of the form's fields`);
    }
    honeypot = form.honeypot;
  }

  if (form.turnstile !== undefined && typeof form.turnstile !== 'boolean') throw new Error(`${setting}.turnstile must be true or false`);
  const turnstile = form.turnstile === true;
  if (turnstile && !turnstileConfigured) throw new Error(`${setting}.turnstile needs extensions.forms.turnstile.siteKey`);

  const allowed = tokens(fields);
  const notificationBlock = plainObject(form.notification, `${setting}.notification`);
  const notificationSetting = `${setting}.notification`;
  const notification = {
    from: singleAddress(notificationBlock.from, `${notificationSetting}.from`),
    to: addressList(notificationBlock.to, `${notificationSetting}.to`, true),
    cc: addressList(notificationBlock.cc, `${notificationSetting}.cc`),
    bcc: addressList(notificationBlock.bcc, `${notificationSetting}.bcc`),
    subject: checkTokens(nonEmptyString(notificationBlock.subject, `${notificationSetting}.subject`), allowed, `${notificationSetting}.subject`),
    body: resolveBody(notificationBlock, notificationSetting, paths, DEFAULT_NOTIFICATION),
    ...(notificationBlock.replyToField === undefined ? {} : { replyToField: emailField(notificationBlock.replyToField, `${notificationSetting}.replyToField`) })
  };
  if (notification.body.text) checkTokens(notification.body.text, allowed, notification.body.setting);

  let confirmation;
  if (form.confirmation !== undefined) {
    const block = plainObject(form.confirmation, `${setting}.confirmation`);
    const confirmationSetting = `${setting}.confirmation`;
    if (!turnstile) {
      throw new Error(`${confirmationSetting} needs turnstile: true on this form, so the form cannot be used to send mail to any address`);
    }
    confirmation = {
      from: block.from === undefined ? notification.from : singleAddress(block.from, `${confirmationSetting}.from`),
      toField: emailField(block.toField, `${confirmationSetting}.toField`),
      ...(block.ifChecked === undefined ? {} : { ifChecked: checkboxField(block.ifChecked, `${confirmationSetting}.ifChecked`) }),
      replyTo: addressList(block.replyTo, `${confirmationSetting}.replyTo`),
      subject: checkTokens(nonEmptyString(block.subject, `${confirmationSetting}.subject`), allowed, `${confirmationSetting}.subject`),
      body: resolveBody(block, confirmationSetting, paths, undefined)
    };
    if (confirmation.body.text) checkTokens(confirmation.body.text, allowed, confirmation.body.setting);
  }

  let redirect;
  if (form.redirect !== undefined) {
    const block = plainObject(form.redirect, `${setting}.redirect`);
    redirect = { success: sitePath(block.success, `${setting}.redirect.success`), error: sitePath(block.error, `${setting}.redirect.error`) };
  }

  return {
    name, fields, turnstile, notification,
    ...(honeypot === undefined ? {} : { honeypot }),
    ...(confirmation === undefined ? {} : { confirmation }),
    ...(redirect === undefined ? {} : { redirect })
  };

} // resolveForm

/**
 * resolveFormsConfig : validate the whole extensions.forms block; { inactive } when no forms are configured
 * @param {Readonly<Record<string, any>>} config
 * @param {{ spacePath: string, publicPath?: string }} context publicPath defaults to <spacePath>/public
 */
export const resolveFormsConfig = (config, { spacePath, publicPath = path.join(spacePath, 'public') }) => {

  if (config.forms === undefined) return { inactive: 'no forms configured' };
  const formsBlock = plainObject(config.forms, 'extensions.forms.forms');

  if (config.origin === undefined) throw new Error('extensions.forms.origin is required: the site origin(s) forms are posted from, such as https://example.com');
  const origins = [config.origin].flat().map((origin) => resolveBaseUrl(origin, 'extensions.forms.origin'));
  if (origins.length === 0) throw new Error('extensions.forms.origin needs at least one origin');

  let timeZone;
  if (config.timeZone !== undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: config.timeZone });
      if (typeof config.timeZone !== 'string') throw new Error();
    } catch {
      throw new Error(`extensions.forms.timeZone must be an IANA time zone such as America/New_York; got ${JSON.stringify(config.timeZone)}`);
    }
    timeZone = config.timeZone;
  }

  const maxBodyBytes = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1024 || maxBodyBytes > 1024 * 1024) {
    throw new Error('extensions.forms.maxBodyBytes must be an integer from 1024 to 1048576');
  }

  let turnstile;
  if (config.turnstile !== undefined) {
    const block = plainObject(config.turnstile, 'extensions.forms.turnstile');
    turnstile = { siteKey: nonEmptyString(block.siteKey, 'extensions.forms.turnstile.siteKey') };
  }

  const meta = META_TOKENS.filter((token) => token !== '_submittedAtLocal' || timeZone !== undefined);
  const tokens = (/** @type {Field[]} */ fields) => new Set([...meta, ...fields.map((field) => field.name)]);
  const forms = Object.entries(formsBlock).map(([name, form]) => resolveForm(name, form, { paths: { spacePath, publicPath: path.resolve(publicPath) }, turnstileConfigured: Boolean(turnstile), tokens }));
  if (forms.length === 0) throw new Error('extensions.forms.forms needs at least one form');
  if (turnstile && !forms.some((form) => form.turnstile)) {
    throw new Error('extensions.forms.turnstile is set but no form has turnstile: true');
  }

  return { origins, timeZone, maxBodyBytes, turnstile, forms, tokens };

} // resolveFormsConfig

/**
 * validateSubmission : check posted values against a form's fields
 * @param {Form} form
 * @param {Record<string, unknown>} body Parsed body (parseBody({ all: true }))
 * @returns {{ values: Record<string, string>, errors: Record<string, string> }}
 *   errors map field name → "required" | "too_short" | "too_long" | "invalid"
 */
export const validateSubmission = (form, body) => {

  /** @type {Record<string, string>} */
  const values = {};
  /** @type {Record<string, string>} */
  const errors = {};
  for (const field of form.fields) {
    const raw = body[field.name];
    if (raw !== undefined && typeof raw !== 'string') {
      errors[field.name] = 'invalid'; // repeated field or a file
      continue;
    }
    const value = (raw ?? '').replace(/\r\n?/g, '\n').trim();

    if (field.type === 'checkbox') {
      if (field.required && value === '') errors[field.name] = 'required';
      values[field.name] = value === '' ? 'No' : 'Yes';
      continue;
    }
    if (value === '') {
      if (field.required) errors[field.name] = 'required';
      values[field.name] = '';
      continue;
    }

    const length = [...value].length;
    const control = field.type === 'textarea' ? CONTROL_MULTI_LINE : CONTROL_SINGLE_LINE;
    let error;
    if (control.test(value)) error = 'invalid';
    else if (field.minLength !== undefined && length < field.minLength) error = 'too_short';
    else if (field.maxLength !== undefined && length > field.maxLength) error = 'too_long';
    else if (field.type === 'email' && !isEmailAddress(value)) error = 'invalid';
    else if (field.type === 'tel' && !TEL.test(value)) error = 'invalid';
    else if (field.type === 'select' && !field.options?.includes(value)) error = 'invalid';
    else if (field.type === 'url') {
      try {
        if (!['http:', 'https:'].includes(new URL(value).protocol)) error = 'invalid';
      } catch {
        error = 'invalid';
      }
    }
    if (!error && field.pattern && !field.pattern.test(value)) error = 'invalid';
    if (error) errors[field.name] = error;
    else values[field.name] = value;
  }
  return { values, errors };

} // validateSubmission

/**
 * renderTemplate : replace {{placeholders}}; singleLine collapses whitespace in values (subjects)
 * @param {string} template
 * @param {Record<string, string>} values
 * @param {{ singleLine?: boolean }} [options]
 */
export const renderTemplate = (template, values, { singleLine = false } = {}) => {

  const output = template.replace(TOKEN, (_, token) => {
    const value = values[token] ?? '';
    return singleLine ? value.replace(/\s+/g, ' ') : value;
  });
  return singleLine ? output.replace(/\s+/g, ' ').trim().slice(0, 250) : output;

} // renderTemplate

/**
 * formatFields : "Label: value" lines; multi-line values start on their own line
 * @param {Form} form
 * @param {Record<string, string>} values
 */
const formatFields = (form, values) => form.fields.map(({ name, label }) => {

  const value = values[name] ?? '';
  return value.includes('\n') ? `${label}:\n${value}\n` : `${label}: ${value === '' ? '(not provided)' : value}`;

}).join('\n');

/**
 * publicDescription : what GET /forms/<name> returns; never secrets or recipients
 * @param {Form} form
 * @param {{ siteKey: string } | undefined} turnstile
 */
const publicDescription = (form, turnstile) => ({
  name: form.name,
  action: `${ROUTE_PREFIX}/${form.name}`,
  fields: Object.fromEntries(form.fields.map((field) => [field.name, {
    type: field.type,
    label: field.label,
    required: field.required,
    ...(field.minLength === undefined ? {} : { minLength: field.minLength }),
    ...(field.maxLength === undefined || field.type === 'checkbox' ? {} : { maxLength: field.maxLength }),
    ...(field.patternSource === undefined ? {} : { pattern: field.patternSource }),
    ...(field.options === undefined ? {} : { options: field.options })
  }])),
  ...(form.honeypot === undefined ? {} : { honeypot: form.honeypot }),
  turnstile: form.turnstile && turnstile ? { siteKey: turnstile.siteKey, action: form.name, script: TURNSTILE_SCRIPT_URL } : null
});

/**
 * withQuery : add query parameters to a site path that may already have some
 * @param {string} target
 * @param {Record<string, string>} params
 */
const withQuery = (target, params) => {

  const url = new URL(target, 'http://site.invalid');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;

} // withQuery

const PLAIN_MESSAGES = {
  sent: 'Thank you. Your message was sent.',
  invalid: 'Some fields are missing or invalid.',
  challenge: 'The verification challenge failed. Please try again.',
  delivery: 'Your message could not be sent. Please try again later.',
  unsupported: 'Submit this form as application/x-www-form-urlencoded or multipart/form-data.',
  bad_request: 'The submission could not be read.'
};

/**
 * createFormsExtension : the extension, with optional stand-ins for the mail transport and fetch (tests)
 * @param {{ mailer?: Parameters<typeof createMailer>[1], fetch?: typeof globalThis.fetch }} [overrides]
 */
export const createFormsExtension = ({ mailer: mailerOverrides, fetch } = {}) => defineExtension({
  name: 'forms',
  apiVersion: 1,
  configKey: 'forms',
  async setup({ config, settings, site, addRoute, env, log, warn }) {

    const spacePath = path.resolve(settings.appRootPath, settings.activeSpace);
    const resolved = resolveFormsConfig(config, { spacePath, publicPath: path.join(spacePath, settings.publicLocation) });
    if ('inactive' in resolved) {
      log(`inactive (${resolved.inactive})`);
      return {};
    }
    const { origins, timeZone, maxBodyBytes, turnstile, forms, tokens } = resolved;

    // Template files: read now, so a missing file or unknown placeholder stops startup
    /** @type {Map<BodySource, string>} */
    const bodies = new Map();
    const loadBodies = async () => {
      const loaded = new Map();
      for (const form of forms) {
        for (const source of [form.notification.body, form.confirmation?.body]) {
          if (!source) continue;
          let text = source.text;
          if (source.file) {
            try {
              text = await readFile(source.file, 'utf8');
            } catch (error) {
              throw new Error(`${source.setting}: cannot read the template (${error.code ?? error.message})`);
            }
          }
          loaded.set(source, checkTokens(/** @type {string} */ (text), tokens(form.fields), source.setting));
        }
      }
      return loaded;
    };
    for (const [source, text] of await loadBodies()) bodies.set(source, text);

    const mailer = await createMailer(resolveMailerOptions(env), mailerOverrides);
    const verifier = turnstile ? createTurnstileVerifier({ secret: /** @type {string} */ (env('TURNSTILE_SECRET_KEY')), fetch }) : undefined;
    const hostnames = origins.map((origin) => new URL(origin).hostname);
    if (verifier?.testing) warn('TURNSTILE_SECRET_KEY is a Cloudflare test secret; challenges are not really checked');
    if (mailer.provider === 'log') warn('MAIL_PROVIDER=log; submissions are printed, not emailed');

    const pages = new Set(await site.listPages());
    for (const form of forms) {
      for (const target of form.redirect ? [form.redirect.success, form.redirect.error] : []) {
        const page = target.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
        if (!pages.has(page)) warn(`${form.name}: redirect target ${page} is not a page on this site`);
      }
    }

    // The browser script: revalidated on every load (ETag), so a deploy reaches visitors at once
    const clientScript = await readFile(new URL('./client.js', import.meta.url), 'utf8');
    const clientTag = `"${createHash('sha256').update(clientScript).digest('base64url').slice(0, 22)}"`;
    addRoute('GET', CLIENT_SCRIPT_PATH, (context) => {
      const headers = { 'Cache-Control': 'no-cache', ETag: clientTag };
      if (context.req.header('if-none-match') === clientTag) return context.body(null, 304, headers);
      return context.body(clientScript, 200, { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' });
    });

    const guards = [csrf({ origin: origins }), bodyLimit({ maxSize: maxBodyBytes })];
    for (const form of forms) {
      const action = `${ROUTE_PREFIX}/${form.name}`;
      const description = publicDescription(form, turnstile);
      addRoute('GET', action, (context) => context.json(description, 200, { 'Cache-Control': 'no-cache' }));
      addRoute('POST', action, ...guards, (context) => handleSubmission(context, form));
    }

    /**
     * handleSubmission : one POST, answered with JSON or a 303 redirect
     * @param {import('hono').Context} context
     * @param {Form} form
     */
    const handleSubmission = async (context, form) => {

      context.header('Cache-Control', 'no-store');
      const wantsJson = (context.req.header('accept') ?? '').toLowerCase().includes('application/json');
      const reference = randomUUID();
      const succeed = () => {
        if (wantsJson) return context.json({ ok: true, reference }, 200);
        if (form.redirect) return context.redirect(form.redirect.success, 303);
        return context.text(PLAIN_MESSAGES.sent, 200);
      };
      const fail = (/** @type {number} */ status, /** @type {keyof typeof PLAIN_MESSAGES} */ error, /** @type {Record<string, any>} */ extra = {}) => {
        const code = /** @type {import('hono/utils/http-status').ContentfulStatusCode} */ (status);
        if (wantsJson) return context.json({ ok: false, error, ...extra }, code);
        if (form.redirect && status !== 415) {
          const params = { status: error, ...(extra.fields ? { fields: Object.keys(extra.fields).join(',') } : {}),
            ...(extra.reference ? { reference: extra.reference } : {}) };
          return context.redirect(withQuery(form.redirect.error, params), 303);
        }
        return context.text(PLAIN_MESSAGES[error], code);
      };

      const type = (context.req.header('content-type') ?? '').toLowerCase();
      if (!type.startsWith('application/x-www-form-urlencoded') && !type.startsWith('multipart/form-data')) return fail(415, 'unsupported');

      let body;
      try {
        body = await context.req.parseBody({ all: true });
      } catch {
        return fail(400, 'bad_request');
      }

      if (form.honeypot && typeof body[form.honeypot] === 'string' && body[form.honeypot] !== '') {
        log(`${form.name}: honeypot filled, submission dropped (reference ${reference})`);
        return succeed();
      }

      const { values, errors } = validateSubmission(form, body);
      if (Object.keys(errors).length > 0) return fail(422, 'invalid', { fields: errors });

      if (form.turnstile && verifier) {
        const result = await verifier.verify({ token: body[TURNSTILE_RESPONSE_FIELD], action: form.name, hostnames, idempotencyKey: reference });
        if (!result.success) {
          if (result.errorCodes.includes('request-failed')) warn(`${form.name}: Turnstile could not be reached (reference ${reference})`);
          else log(`${form.name}: Turnstile refused the token (${result.errorCodes.join(', ') || 'no reason given'})`);
          return fail(403, 'challenge');
        }
      }

      const now = new Date();
      const referer = context.req.header('referer');
      let page = '';
      try {
        const url = referer ? new URL(referer) : undefined;
        if (url && (origins.includes(url.origin) || url.origin === new URL(context.req.url).origin)) page = url.pathname;
      } catch {}
      const placeholders = {
        ...values,
        _form: form.name,
        _reference: reference,
        _submittedAt: now.toISOString(),
        _submittedAtUtc: now.toUTCString(),
        ...(timeZone ? { _submittedAtLocal: new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'long', timeZone }).format(now) } : {}),
        _page: page,
        _fields: formatFields(form, values),
        _site: origins[0]
      };

      const { notification, confirmation } = form;
      const replyTo = notification.replyToField ? values[notification.replyToField] : '';
      try {
        await mailer.send({
          from: notification.from,
          to: notification.to,
          cc: notification.cc,
          bcc: notification.bcc,
          ...(replyTo ? { replyTo } : {}),
          subject: renderTemplate(notification.subject, placeholders, { singleLine: true }),
          text: renderTemplate(/** @type {string} */ (bodies.get(notification.body)), placeholders)
        });
      } catch (error) {
        warn(`${form.name}: notification not sent (reference ${reference}): ${error.message}`);
        return fail(502, 'delivery', { reference });
      }

      const recipient = confirmation ? values[confirmation.toField] : '';
      const wanted = !confirmation?.ifChecked || values[confirmation.ifChecked] === 'Yes';
      if (confirmation && recipient && wanted) {
        try {
          await mailer.send({
            from: confirmation.from,
            to: recipient,
            replyTo: confirmation.replyTo,
            subject: renderTemplate(confirmation.subject, placeholders, { singleLine: true }),
            text: renderTemplate(/** @type {string} */ (bodies.get(confirmation.body)), placeholders)
          });
        } catch (error) {
          warn(`${form.name}: confirmation not sent (reference ${reference}): ${error.message}`);
        }
      }

      log(`${form.name}: submission delivered (reference ${reference})`);
      return succeed();

    }; // handleSubmission

    log(`active (${forms.map((form) => `${ROUTE_PREFIX}/${form.name}`).join(', ')}; mail via ${mailer.provider}${verifier ? ', Turnstile on' : ''})`);
    return {
      // Template files are kinetic content: pick up edits; a broken edit keeps the previous text
      contentChanged: async () => {
        try {
          for (const [source, text] of await loadBodies()) bodies.set(source, text);
        } catch (error) {
          warn(`email templates not reloaded: ${error.message}`);
        }
      },
      shutdown: () => mailer.close()
    };

  } // setup
});

export const forms = createFormsExtension();
