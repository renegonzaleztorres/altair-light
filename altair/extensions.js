/**
 * Extensions
 *
 * Registers the extensions an application lists in `static extensions`,
 * activates those whose `settings.extensions.<configKey>` block is present,
 * and runs their hooks at fixed framework call sites. Extensions run in the
 * order they are listed; shutdown runs in reverse order. The contract is
 * documented in ARCHITECTURE.md under "Extension API".
 */

// Types: extension files that start with // @ts-check get editor completion
// and errors for definitions, the api object, hook names, inputs and returns.

/**
 * @typedef {object} ExtensionApi
 * @property {string} name This extension's name
 * @property {Readonly<Record<string, any>>} config This extension's block from settings.extensions
 * @property {Readonly<Record<string, any>>} settings All application settings (frozen)
 * @property {(message: string) => void} log Debug log line, printed only when DEBUG=true
 * @property {(message: string) => void} warn Warning, always printed
 * @property {(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, ...handlers: [...import('hono').MiddlewareHandler[], import('hono').Handler]) => void} addRoute
 *   Register a route, mounted before Altair's core routes; earlier handlers act as route middleware.
 *   The root route "/" and catch-all routes ("*", "/*") belong to Altair.
 * @property {ExtensionSite} site Read-only view of the active site's pages and DATA
 * @property {(name: string, options?: { required?: boolean }) => string | undefined} env
 *   Read one environment variable during setup (secrets stay out of settings); required by default
 * @property {(handler: import('hono').MiddlewareHandler) => void} addMiddleware
 *   Register middleware for every request, mounted after CORS and before static files
 * @property {(reason: string) => void} invalidateRouteCache Clear rendered pages from the route cache
 */

/**
 * @typedef {object} ExtensionSite
 * @property {() => Promise<string[]>} listPages Public page routes ("/", "/about"), using Altair's private-page rules
 * @property {() => Readonly<Record<string, any>>} data Current DATA.json contents, deep-frozen copy
 */

/** @typedef {{ content: string, path: string, routePath: string, kind: 'page' | 'error' }} HTMLTransformInput */
/** @typedef {{ content: string, path: string }} AssetTransformInput */
/** @typedef {{ currentPath: string }} VarsInput */
/** @typedef {{ reason: string }} ContentChangedInput */

/**
 * Hooks an extension may return from setup(). Results of transform and vars
 * hooks are route-cached: they may depend only on path, content, and config.
 * @typedef {object} ExtensionHooks
 * @property {(input: HTMLTransformInput) => string | Promise<string>} [transformHTML]
 * @property {(input: AssetTransformInput) => string | Promise<string>} [transformCSS]
 * @property {(input: AssetTransformInput) => string | Promise<string>} [transformJS]
 * @property {(input: VarsInput) => Record<string, string | number | boolean>} [vars]
 * @property {(input: ContentChangedInput) => void | Promise<void>} [contentChanged]
 * @property {() => void | Promise<void>} [shutdown]
 */

/**
 * @typedef {object} ExtensionDefinition
 * @property {string} name Lowercase kebab-case, unique
 * @property {1} apiVersion Extension API version this extension was written for
 * @property {string} configKey Key under settings.extensions; no config means inactive
 * @property {(api: ExtensionApi) => ExtensionHooks | void | Promise<ExtensionHooks | void>} setup
 *   Runs once at startup (awaited, in list order) when the config block is present
 */

export const EXTENSION_API_VERSION = 1;

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const HOOK_NAMES = new Set(['transformHTML', 'transformCSS', 'transformJS', 'vars', 'contentChanged', 'shutdown']);
const ROUTE_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const TRANSFORM_HOOKS = { html: 'transformHTML', css: 'transformCSS', js: 'transformJS' };
const RESERVED_ROUTES = new Set(['/', '*', '/*']);
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const definitions = new WeakSet();

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const deepFreeze = (value) => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

/**
 * Validate and freeze an extension definition.
 * @param {ExtensionDefinition} definition
 * @returns {Readonly<ExtensionDefinition>}
 */
export const defineExtension = (definition) => {

  const { name, apiVersion, configKey, setup } = definition ?? {};
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new Error(`Extension name must be lowercase kebab-case: ${JSON.stringify(name)}`);
  }
  if (apiVersion !== EXTENSION_API_VERSION) {
    throw new Error(`Extension ${name} targets extension API ${apiVersion}; this Altair provides ${EXTENSION_API_VERSION}`);
  }
  if (typeof configKey !== 'string' || configKey === '') throw new Error(`Extension ${name} must declare a configKey`);
  if (typeof setup !== 'function') throw new Error(`Extension ${name} must declare setup(api)`);
  const frozen = Object.freeze({ ...definition });
  definitions.add(frozen);
  return frozen;

} // defineExtension

export class ExtensionRunner {

  #active = [];
  #status = [];
  #warnedVars = new Set();
  #setupPromise = null;
  #dataSource = null;
  #dataView = null;

  constructor({ extensions = [], settings, readout, invalidateRouteCache, listPages, getData, env = process.env }) {

    this.extensions = extensions;
    this.settings = settings;
    this.readout = readout;
    this.invalidateRouteCache = invalidateRouteCache;
    this.listPages = listPages;
    this.getData = getData;
    this.env = env;
    this.site = Object.freeze({
      listPages: () => this.listPages(),
      data: () => this.#readOnlyData()
    });

  } // constructor

  // #readOnlyData : one deep-frozen copy per loaded DATA object, so extensions cannot alter what pages render
  #readOnlyData() {

    const source = this.getData();
    if (source !== this.#dataSource) {
      this.#dataSource = source;
      this.#dataView = deepFreeze(structuredClone(source ?? {}));
    }
    return this.#dataView;

  } // #readOnlyData

  // setup : activate configured extensions once, awaiting each in list order; any error aborts startup
  setup() {

    this.#setupPromise ??= this.#setupAll();
    return this.#setupPromise;

  } // setup

  async #setupAll() {

    if (!Array.isArray(this.extensions)) throw new Error('static extensions must be an array');
    const configured = this.settings.extensions;
    if (configured !== undefined && !isPlainObject(configured)) {
      throw new Error('extensions configuration must be an object keyed by each extension\'s configKey');
    }

    const names = new Set();
    for (const extension of this.extensions) {
      if (!definitions.has(extension)) throw new Error('Extensions must be created with defineExtension()');
      const { name, configKey } = extension;
      if (names.has(name)) throw new Error(`Extension ${name} is listed twice`);
      names.add(name);

      const config = configured?.[configKey];
      if (config === undefined) {
        this.#status.push({ name, active: false, reason: `no extensions.${configKey} config` });
        continue;
      }
      if (!isPlainObject(config)) {
        throw new Error(`extensions.${configKey} must be an object; use {} for an extension with no settings`);
      }

      const registration = { name, routes: [], middleware: [], envNames: [] };
      let settingUp = true;
      const duringSetup = (member) => {
        if (!settingUp) throw new Error(`Extension ${name}: ${member} is only available during setup`);
      };
      const api = Object.freeze({
        name,
        config,
        settings: this.settings,
        log: (message) => this.readout(`${name}: ${message}`, 'Extension'),
        warn: (message) => console.warn(`[Extension] ${name}: ${message}`),
        addRoute: (method, routePath, ...handlers) => {
          duringSetup('addRoute');
          const upper = String(method).toUpperCase();
          if (RESERVED_ROUTES.has(routePath)) {
            throw new Error(`Extension ${name}: the ${routePath} route belongs to Altair`);
          }
          if (!ROUTE_METHODS.has(upper) || typeof routePath !== 'string' || !routePath.startsWith('/') ||
              handlers.length === 0 || handlers.some((handler) => typeof handler !== 'function')) {
            throw new Error(`Extension ${name}: addRoute(method, path, ...handlers) received invalid arguments`);
          }
          registration.routes.push({ method: upper, routePath, handlers });
        },
        site: this.site,
        env: (variable, { required = true } = {}) => {
          duringSetup('env');
          if (!ENV_NAME_PATTERN.test(variable)) throw new Error(`Extension ${name}: invalid environment variable name ${variable}`);
          const value = this.env[variable];
          if (value === undefined || value === '') {
            if (required) throw new Error(`Extension ${name}: environment variable ${variable} is required`);
            return undefined;
          }
          registration.envNames.push(variable);
          return value;
        },
        addMiddleware: (handler) => {
          duringSetup('addMiddleware');
          if (typeof handler !== 'function') throw new Error(`Extension ${name}: addMiddleware(handler) needs a function`);
          registration.middleware.push(handler);
        },
        invalidateRouteCache: (reason) => this.invalidateRouteCache(`extension-${name}-${reason}`)
      });

      let hooks;
      try {
        hooks = (await extension.setup(api)) ?? {};
      } catch (error) {
        throw new Error(`Extension ${name} failed to set up: ${error.message}`, { cause: error });
      } finally {
        settingUp = false;
      }
      for (const [hookName, hook] of Object.entries(hooks)) {
        if (!HOOK_NAMES.has(hookName) || typeof hook !== 'function') {
          throw new Error(`Extension ${name} returned unknown hook ${hookName}`);
        }
      }

      this.#active.push({ ...registration, hooks: Object.freeze({ ...hooks }) });
      this.#status.push({ name, active: true, env: [...registration.envNames] });
    }

    const owners = new Map();
    for (const { name, routes } of this.#active) {
      for (const { method, routePath } of routes) {
        const key = `${method} ${routePath}`;
        if (owners.has(key)) throw new Error(`Extensions ${owners.get(key)} and ${name} both register ${key}`);
        owners.set(key, name);
      }
    }

    for (const { name, active, reason } of this.#status) {
      this.readout(`${name} ${active ? 'active' : `inactive (${reason})`}`, 'Extension');
    }

  } // #setupAll

  get status() {

    return this.#status.map((entry) => ({ ...entry }));

  } // status

  mountMiddleware(app) {

    for (const { middleware } of this.#active) {
      for (const handler of middleware) app.use('*', handler);
    }

  } // mountMiddleware

  mountRoutes(app) {

    for (const { routes } of this.#active) {
      for (const { method, routePath, handlers } of routes) app.on(method, routePath, ...handlers);
    }

  } // mountRoutes

  // transform : waterfall over transformHTML|CSS|JS; output must stay a string
  async transform(type, content, details) {

    const hookName = TRANSFORM_HOOKS[type];
    let output = content;
    for (const { name, hooks } of this.#active) {
      if (!hooks[hookName]) continue;
      const next = await hooks[hookName]({ ...details, content: output });
      if (typeof next !== 'string') throw new Error(`Extension ${name} ${hookName} must return a string`);
      output = next;
    }
    return output;

  } // transform

  // vars : merge lowercase variables; a later extension may not silently replace an earlier one's key
  vars(details) {

    const merged = {};
    const owners = {};
    for (const { name, hooks } of this.#active) {
      if (!hooks.vars) continue;
      const values = hooks.vars(details);
      if (!values || typeof values !== 'object' || Array.isArray(values)) {
        throw new Error(`Extension ${name} vars must return an object`);
      }
      for (const [key, value] of Object.entries(values)) {
        const lower = key.toLowerCase();
        if (Object.hasOwn(merged, lower) && !this.#warnedVars.has(lower)) {
          this.#warnedVars.add(lower);
          console.warn(`[Extension] ${name} and ${owners[lower]} both define @@VAR_${lower}; ${name} wins`);
        }
        merged[lower] = value;
        owners[lower] = name;
      }
    }
    return merged;

  } // vars

  async contentChanged(details) {

    for (const { name, hooks } of this.#active) {
      if (!hooks.contentChanged) continue;
      try { await hooks.contentChanged(details); }
      catch (error) { console.error(`[Extension] ${name} contentChanged failed: ${error.message}`); }
    }

  } // contentChanged

  // shutdown : reverse order; failures are logged so every extension gets to clean up
  async shutdown() {

    for (const { name, hooks } of [...this.#active].reverse()) {
      if (!hooks.shutdown) continue;
      try { await hooks.shutdown(); }
      catch (error) { console.error(`[Extension] ${name} shutdown failed: ${error.message}`); }
    }

  } // shutdown

} // ExtensionRunner
