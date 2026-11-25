// @ts-check
/**
 * Tailwind CSS extension
 *
 * Links one Tailwind stylesheet, generated ahead of time into the active
 * space's public folder, on rendered HTML pages. In development it also runs
 * the Tailwind CLI in watch mode and links the file as it is; in every other
 * environment Tailwind does not run, and the file is linked and served under
 * a name carrying a hash of its contents (/build/tailwind.<hash>.css). Active only when the
 * application lists it and settings.extensions.tailwind exists; delete that
 * block to turn Tailwind off. Pages are excluded by config (excludePaths,
 * excludeErrorPages) or by a page's <meta name="altair-tailwind" content="off">.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { defineExtension } from '../../altair/extensions.js';
import { compileRoutePatterns } from '../_shared/config.js';

export const CSS_ROUTE = '/build/tailwind.css';
export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const HASH_LENGTH = 12;

/**
 * hashedRoute : the production URL of the stylesheet whose contents hash to hash
 * @param {string} hash
 */
export const hashedRoute = (hash) => CSS_ROUTE.replace(/\.css$/, `.${hash}.css`);

// The hashed URL as a Hono route; the file name is one path segment
const HASHED_ROUTE_PATTERN = `/build/:file{tailwind\\.[0-9a-f]{${HASH_LENGTH}}\\.css}`;
const LINKED = /\/build\/tailwind(?:\.[0-9a-f]+)?\.css/;

const PAGE_OPT_OUT = /<meta\s+name=["']altair-tailwind["']\s+content=["']off["']\s*\/?>/i;
const ROUTINE_CLI_OUTPUT = /^(?:≈ tailwindcss|Done in )/;
const CLI_DECORATION = /^[\s┌│└]+/; // the box the CLI draws around error messages

/**
 * resolveTailwind : validate the config block
 * @param {Readonly<Record<string, any>>} config
 */
export const resolveTailwind = (config) => {

  const { excludePaths, excludeErrorPages } = config;
  if (excludeErrorPages !== undefined && typeof excludeErrorPages !== 'boolean') {
    throw new Error('extensions.tailwind.excludeErrorPages must be true or false');
  }

  return {
    excludePaths: compileRoutePatterns(excludePaths, 'extensions.tailwind.excludePaths'),
    excludeErrorPages: excludeErrorPages === true
  };

} // resolveTailwind

/**
 * tailwindPaths : the entry file Tailwind reads and the stylesheet it writes, for the active space
 * @param {Readonly<Record<string, any>>} settings
 */
export const tailwindPaths = (settings) => {

  const activeSpacePath = path.join(settings.appRootPath, settings.activeSpace);
  return {
    entry: path.join(activeSpacePath, 'css', '_tailwind.css'),
    output: path.join(activeSpacePath, settings.publicLocation, ...CSS_ROUTE.split('/'))
  };

} // tailwindPaths

/**
 * findCli : path of the installed Tailwind CLI, or null when it is not installed (a production install)
 * @param {string} appRootPath
 */
export const findCli = async (appRootPath) => {

  const packagePath = path.join(appRootPath, 'node_modules', '@tailwindcss', 'cli');
  try {
    const manifest = JSON.parse(await readFile(path.join(packagePath, 'package.json'), 'utf8'));
    return path.join(packagePath, manifest.bin.tailwindcss);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
    throw error;
  }

} // findCli

/**
 * cliArguments : Tailwind CLI arguments; always minified, so the generated file is the same in every workflow
 * @param {{ entry: string, output: string, watch?: boolean }} options
 */
export const cliArguments = ({ entry, output, watch = false }) =>
  ['--input', entry, '--output', output, '--minify', ...(watch ? ['--watch'] : [])];

/**
 * cliEnvironment : the process environment without DEBUG, which makes Tailwind print timing lines on every build
 */
export const cliEnvironment = () => {

  const { DEBUG, ...environment } = process.env;
  return environment;

} // cliEnvironment

/**
 * createStylesheetReader : a function returning the file's contents and their short hash,
 * re-read only when the file's size or modification time changes
 * @param {string} file
 */
export const createStylesheetReader = (file) => {

  /** @type {{ mtimeMs: number, size: number, hash: string, body: Buffer } | undefined} */
  let seen;

  return async () => {
    let stats;
    try {
      stats = await stat(file);
    } catch (error) {
      if (seen) return seen; // removed after startup: keep linking and serving the last known version
      throw error;
    }
    if (!seen || seen.mtimeMs !== stats.mtimeMs || seen.size !== stats.size) {
      const body = await readFile(file);
      const hash = createHash('sha256').update(body).digest('hex').slice(0, HASH_LENGTH);
      seen = { mtimeMs: stats.mtimeMs, size: stats.size, hash, body };
    }
    return seen;
  };

} // createStylesheetReader

/**
 * injectStylesheet : add the link before the page's first stylesheet in <head>, or before </head>, once;
 * commented-out markup is ignored and pages without </head> are unchanged
 * @param {string} html
 * @param {string} href
 */
export const injectStylesheet = (html, href) => {

  if (LINKED.test(html)) return html;
  const markup = html.replace(/<!--[\s\S]*?-->/g, (comment) => ' '.repeat(comment.length));
  const headEnd = markup.search(/<\/head\s*>/i);
  if (headEnd === -1) return html;
  const firstStylesheet = markup.search(/<link\b[^>]*\brel=["']?stylesheet\b/i);
  const index = firstStylesheet !== -1 && firstStylesheet < headEnd ? firstStylesheet : headEnd;
  return `${html.slice(0, index)}<link rel="stylesheet" href="${href}">\n${html.slice(index)}`;

} // injectStylesheet

/**
 * startWatcher : run the Tailwind CLI in watch mode. Its stdin stays open as a pipe because the CLI
 * exits when stdin closes, so the watcher can never outlive this process, even after a crash.
 * @param {{ spawnProcess: typeof spawn, cli: string, cwd: string, entry: string, output: string,
 *   log: (message: string) => void, warn: (message: string) => void }} options
 */
const startWatcher = ({ spawnProcess, cli, cwd, entry, output, log, warn }) => {

  const child = spawnProcess(process.execPath, [cli, ...cliArguments({ entry, output, watch: true })], {
    cwd,
    env: cliEnvironment(),
    stdio: ['pipe', 'ignore', 'pipe']
  });
  let running = true;
  let stopping = false;

  child.stdin?.on('error', () => {}); // the pipe breaks if the CLI exits first; 'exit' below reports that
  child.stderr?.on('data', (chunk) => {
    for (const rawLine of String(chunk).split('\n')) {
      const line = stripVTControlCharacters(rawLine).replace(CLI_DECORATION, '').trimEnd();
      if (!line) continue;
      if (ROUTINE_CLI_OUTPUT.test(line)) log(line);
      else warn(line);
    }
  });
  child.on('error', (error) => {
    running = false;
    warn(`the CSS watcher could not start: ${error.message}`);
  });
  child.on('exit', (code, signal) => {
    running = false;
    if (!stopping) warn(`the CSS watcher stopped (${signal ?? `exit code ${code}`}); CSS will not rebuild until a restart`);
  });

  return {
    stop: () => new Promise((resolve) => {
      stopping = true;
      if (!running) return resolve(undefined);
      child.once('exit', () => resolve(undefined));
      child.kill();
    })
  };

} // startWatcher

/**
 * assertFileExists : stop startup with a message saying how to create the file
 * @param {() => Promise<unknown>} check
 * @param {string} message
 */
const assertFileExists = async (check, message) => {

  try {
    await check();
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') throw new Error(message);
    throw error;
  }

} // assertFileExists

/**
 * createTailwind : the extension, with process access injectable for tests
 * @param {{ spawnProcess?: typeof spawn, findCli?: typeof findCli }} [dependencies]
 */
export const createTailwind = ({ spawnProcess = spawn, findCli: locateCli = findCli } = {}) => defineExtension({
  name: 'tailwind',
  apiVersion: 1,
  configKey: 'tailwind',
  async setup({ config, settings, log, warn, addMiddleware, addRoute }) {

    const { excludePaths, excludeErrorPages } = resolveTailwind(config);
    const { entry, output } = tailwindPaths(settings);
    const development = settings.nodeEnv === 'development';
    const readStylesheet = createStylesheetReader(output);
    const cli = development ? await locateCli(settings.appRootPath) : null;

    let watcher = null;
    if (cli) {
      await assertFileExists(() => stat(entry), `Tailwind entry file ${entry} is missing`);
      watcher = startWatcher({ spawnProcess, cli, cwd: settings.appRootPath, entry, output, log, warn });
    } else {
      await assertFileExists(readStylesheet, `Tailwind stylesheet ${output} is missing; run pnpm css:build`);
      if (development) warn('the Tailwind CLI is not installed, so CSS will not rebuild; serving the existing stylesheet');
    }
    log(`active (${watcher ? 'watching' : 'serving the generated stylesheet'}; ${excludePaths.length} excluded path patterns)`);

    // The file under its own name: linked in development, and never pinned in a cache in production,
    // where pages link the hashed name instead. Runs after the static file is served, so it only
    // adds a header to that one response.
    addMiddleware(async (context, next) => {
      await next();
      if (context.req.path !== CSS_ROUTE || context.res.status !== 200) return;
      context.header('Cache-Control', development ? 'no-store' : 'no-cache');
    });

    // The hashed name, which only exists as this route. The current hash is cached for a year; any
    // other (a page rendered before a deploy, or another server mid-deploy) gets the current file,
    // which must not be pinned under that name.
    if (!development) {
      addRoute('GET', HASHED_ROUTE_PATTERN, async (context) => {
        const { hash, body } = await readStylesheet();
        const requested = context.req.param('file').slice('tailwind.'.length, -'.css'.length);
        return context.body(new Uint8Array(body), 200, {
          'Content-Type': 'text/css; charset=utf-8',
          'Cache-Control': requested === hash ? IMMUTABLE : 'no-cache'
        });
      });
    }

    return {
      // Route-cached: the decision and the version depend only on path, kind, content and config.
      // The output is inside the active space, so the route cache watcher clears pages when it changes.
      transformHTML: async ({ content, path: route, kind }) => {
        if (kind === 'error' && excludeErrorPages) return content;
        const normalizedRoute = route.toLowerCase();
        if (excludePaths.some((matches) => matches(normalizedRoute))) return content;
        if (PAGE_OPT_OUT.test(content)) return content;
        return injectStylesheet(content, development ? CSS_ROUTE : hashedRoute((await readStylesheet()).hash));
      },
      ...(watcher ? { shutdown: () => watcher.stop() } : {})
    };

  } // setup
});

export const tailwind = createTailwind();
