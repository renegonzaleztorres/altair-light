// @ts-check
/**
 * Extension installer: pnpm extension:add <name> [--dry-run] [--space <path>] [--no-build]
 *
 * Adds an extension to this project from the plan in extensions/<name>/install.js:
 * copies its starter files into the active space, adds its block to
 * config/<environment>.json, appends its environment variables to .env.example
 * (and to .env when it exists), lists it in web-app/web-app.js, then runs the
 * package scripts the plan names (such as css:build).
 *
 * It never overwrites. A file that differs from the starter is a conflict and
 * then nothing is changed at all; anything already in place is left as it is,
 * so running it twice changes nothing. What it cannot change safely it prints
 * for you to do by hand. A command-line tool only: the server never loads it.
 */

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import dotenv from 'dotenv';

/**
 * @typedef {object} InstallPlan
 * @property {string} export the extension's export name, as listed in `static extensions`
 * @property {string} module its module, relative to the project root
 * @property {{ from: string, to: string }[]} [files] starter files; `from` is relative to the extension, `to` to the active space
 * @property {{ key: string, from: string, environment?: string }} [config] JSON file holding the extensions.<key> block (default environment: development)
 * @property {{ from: string }} [env] environment block; paragraphs are separated by blank lines
 * @property {string[]} [scripts] package.json scripts to run after something was added
 * @property {string[]} [next] what is left to do by hand
 */

/**
 * @typedef {object} Step
 * @property {'add' | 'present' | 'conflict' | 'manual' | 'run'} status
 * @property {string} target a path relative to the project root, or a script name
 * @property {string} [detail]
 */

const DEFAULT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const JSON_WIDTH = 120;

/**
 * formatJson : JSON with two-space indentation, keeping short objects and arrays on one line
 * @param {unknown} value
 * @param {string} [indent]
 * @param {number} [used] characters already on the line before the value
 * @returns {string}
 */
export const formatJson = (value, indent = '', used = indent.length) => {

  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const isArray = Array.isArray(value);
  /** @type {[string | null, unknown][]} */
  const entries = isArray ? value.map((item) => [null, item]) : Object.entries(value);
  if (entries.length === 0) return isArray ? '[]' : '{}';
  const key = (/** @type {string | null} */ name) => (name === null ? '' : `${JSON.stringify(name)}: `);

  const parts = entries.map(([name, item]) => key(name) + formatJson(item, indent, 0));
  const inline = isArray ? `[${parts.join(', ')}]` : `{ ${parts.join(', ')} }`;
  if (indent !== '' && !inline.includes('\n') && used + inline.length + 1 <= JSON_WIDTH) return inline;

  const inner = `${indent}  `;
  const lines = entries.map(([name, item]) => inner + key(name) + formatJson(item, inner, inner.length + key(name).length));
  return isArray ? `[\n${lines.join(',\n')}\n${indent}]` : `{\n${lines.join(',\n')}\n${indent}}`;

} // formatJson

/**
 * readText : a file's text, or null when it does not exist
 * @param {string} file
 */
const readText = (file) => readFile(file, 'utf8').catch((error) => {
  if (error.code === 'ENOENT') return null;
  throw error;
});

const escapeRegExp = (/** @type {string} */ text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const variableNames = (/** @type {string} */ text) => [...text.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((match) => match[1]);

/**
 * resolveSpace : the active space, from --space, ACTIVE_SPACE or .env, relative to the root
 * @param {string} root
 * @param {string | undefined} space
 */
const resolveSpace = async (root, space) => {

  const fromFile = dotenv.parse((await readText(path.join(root, '.env'))) ?? '').ACTIVE_SPACE;
  const chosen = space || process.env.ACTIVE_SPACE || fromFile || 'spaces/kinetic';
  const absolute = path.resolve(root, chosen);
  if (!absolute.startsWith(`${root}${path.sep}`)) throw new Error(`the space ${chosen} is outside the project`);
  const found = await stat(absolute).catch(() => null);
  if (!found?.isDirectory()) throw new Error(`the space ${chosen} does not exist; pass --space <path>`);
  return path.relative(root, absolute);

} // resolveSpace

/**
 * loadPlan : extensions/<name>/install.js
 * @param {string} extensionsDir
 * @param {string} name
 * @returns {Promise<InstallPlan>}
 */
const loadPlan = async (extensionsDir, name) => {

  if (!NAME_PATTERN.test(name)) throw new Error(`"${name}" is not an extension name`);
  if (!(await stat(path.join(extensionsDir, name)).catch(() => null))?.isDirectory()) {
    throw new Error(`there is no extension named ${name} in extensions/`);
  }
  const file = path.join(extensionsDir, name, 'install.js');
  if ((await readText(file)) === null) {
    throw new Error(`the ${name} extension has no installer; follow extensions/${name}/README.md to set it up`);
  }
  const plan = (await import(pathToFileURL(file).href)).default;
  if (typeof plan?.export !== 'string' || typeof plan?.module !== 'string') {
    throw new Error(`extensions/${name}/install.js must export default { export, module, … }`);
  }
  return plan;

} // loadPlan

/**
 * registerChange : web-app.js with the extension imported and listed, or why it cannot be patched
 * @param {string} source
 * @param {string} name the export name
 * @param {string} specifier the import path, relative to web-app.js
 * @returns {{ status: 'present' } | { status: 'add', text: string } | { status: 'manual', detail: string }}
 */
export const registerChange = (source, name, specifier) => {

  const importLine = `import { ${name} } from '${specifier}';`;
  const manual = `add ${importLine} and list ${name} in static extensions = […]`;
  const imported = new RegExp(`^\\s*import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"]${escapeRegExp(specifier)}['"]`, 'm').test(source);
  const lists = [...source.matchAll(/^([ \t]*static\s+extensions\s*=\s*\[)([^\]]*)(\])/gm)];
  if (lists.length !== 1 || lists[0][2].includes('\n')) return { status: 'manual', detail: manual };
  const [list, opening, items, closing] = lists[0];
  const listed = new RegExp(`(^|[\\s,])${name}($|[\\s,])`).test(items);
  if (imported && listed) return { status: 'present' };

  let text = source;
  if (!listed) {
    const kept = items.replace(/[\s,]+$/, '');
    text = text.replace(list, `${opening}${kept ? `${kept}, ` : ''}${name}${closing}`);
  }
  if (!imported) {
    const imports = [...text.matchAll(/^import\s.*;[ \t]*$/gm)];
    if (imports.length === 0) return { status: 'manual', detail: manual };
    const last = imports[imports.length - 1];
    const at = /** @type {number} */ (last.index) + last[0].length;
    text = `${text.slice(0, at)}\n${importLine}${text.slice(at)}`;
  }
  return { status: 'add', text };

} // registerChange

/**
 * appendEnv : the paragraphs of an environment block that a file does not define yet
 * @param {string} existing
 * @param {string} block
 */
export const appendEnv = (existing, block) => {

  const defined = new Set(variableNames(existing));
  /** @type {string[]} */
  const added = [];
  /** @type {string[]} */
  const missing = [];
  for (const paragraph of block.trim().split(/\n[ \t]*\n/)) {
    const names = variableNames(paragraph);
    const absent = names.filter((name) => !defined.has(name));
    if (absent.length === 0) continue;
    if (absent.length === names.length) added.push(paragraph.trim());
    else missing.push(...absent);
  }
  const text = added.length === 0 ? existing
    : `${existing.trim() === '' ? '' : `${existing.replace(/\s*$/, '')}\n\n`}${added.join('\n\n')}\n`;
  return { text, added: added.flatMap(variableNames), missing };

} // appendEnv

/**
 * installExtension : work out every change, then make them unless there is a conflict or it is a dry run
 * @param {{ name: string, root?: string, extensionsDir?: string, space?: string, dryRun?: boolean, runScripts?: boolean }} options
 * @returns {Promise<{ plan: InstallPlan, space: string, steps: Step[], changed: boolean, conflicts: boolean }>}
 */
export const installExtension = async ({ name, root = DEFAULT_ROOT, extensionsDir, space, dryRun = false, runScripts = true }) => {

  root = path.resolve(root);
  const extensionDir = path.join(extensionsDir ?? path.join(root, 'extensions'), name);
  const plan = await loadPlan(path.dirname(extensionDir), name);
  const spacePath = await resolveSpace(root, space);
  const relative = (/** @type {string} */ file) => path.relative(root, file).split(path.sep).join('/');
  /** @type {Step[]} */
  const steps = [];
  /** @type {{ file: string, text: string }[]} */
  const writes = [];

  // Starter files: copied only where nothing is in the way
  for (const { from, to } of plan.files ?? []) {
    const source = await readFile(path.join(extensionDir, from), 'utf8');
    const target = path.join(root, spacePath, to);
    if (!target.startsWith(path.join(root, spacePath) + path.sep)) throw new Error(`install.js: ${to} is outside the space`);
    const current = await readText(target);
    if (current === null) {
      writes.push({ file: target, text: source });
      steps.push({ status: 'add', target: relative(target) });
    } else if (current === source) {
      steps.push({ status: 'present', target: relative(target) });
    } else {
      steps.push({ status: 'conflict', target: relative(target), detail: 'differs from the starter file; not overwritten' });
    }
  }

  // Config block: added unless default.json or the environment's file already has it
  if (plan.config) {
    const { key, from, environment = 'development' } = plan.config;
    const block = JSON.parse(await readFile(path.join(extensionDir, from), 'utf8'));
    const target = path.join(root, 'config', `${environment}.json`);
    /** @type {Record<string, any> | null} */
    let current = null;
    let inDefault = false;
    try {
      const text = await readText(target);
      current = text === null || text.trim() === '' ? {} : JSON.parse(text);
      const defaults = await readText(path.join(root, 'config', 'default.json'));
      inDefault = defaults !== null && JSON.parse(defaults)?.extensions?.[key] !== undefined;
    } catch (error) {
      steps.push({ status: 'conflict', target: relative(target), detail: `cannot be read as JSON (${error.message})` });
    }
    if (current && current.extensions?.[key] !== undefined) {
      steps.push({ status: 'present', target: relative(target), detail: `extensions.${key} is already set` });
    } else if (current && inDefault) {
      steps.push({ status: 'present', target: 'config/default.json', detail: `extensions.${key} is already set` });
    } else if (current) {
      const extensions = current.extensions;
      if (extensions !== undefined && (typeof extensions !== 'object' || extensions === null || Array.isArray(extensions))) {
        steps.push({ status: 'conflict', target: relative(target), detail: '"extensions" is not an object' });
      } else {
        writes.push({ file: target, text: `${formatJson({ ...current, extensions: { ...extensions, [key]: block } })}\n` });
        steps.push({ status: 'add', target: relative(target), detail: `extensions.${key}` });
      }
    }
  }

  // Environment variables: .env.example always, .env when the project has one
  if (plan.env) {
    const block = await readFile(path.join(extensionDir, plan.env.from), 'utf8');
    for (const file of ['.env.example', '.env']) {
      const target = path.join(root, file);
      const existing = await readText(target);
      if (existing === null && file === '.env') continue;
      const { text, added, missing } = appendEnv(existing ?? '', block);
      if (added.length) {
        writes.push({ file: target, text });
        steps.push({ status: 'add', target: file, detail: added.join(', ') });
      }
      if (missing.length) steps.push({ status: 'manual', target: file, detail: `also set ${missing.join(', ')}` });
      if (!added.length && !missing.length) steps.push({ status: 'present', target: file, detail: 'variables already set' });
    }
  }

  // web-app.js: import and list the extension
  const webApp = path.join(root, 'web-app', 'web-app.js');
  const specifier = path.relative(path.dirname(webApp), path.join(root, plan.module)).split(path.sep).join('/');
  const source = await readText(webApp);
  const change = source === null
    ? /** @type {const} */ ({ status: 'manual', detail: `list ${plan.export} from ${plan.module} in your WebApp's static extensions` })
    : registerChange(source, plan.export, specifier.startsWith('.') ? specifier : `./${specifier}`);
  if (change.status === 'add') writes.push({ file: webApp, text: change.text });
  steps.push({ status: change.status, target: 'web-app/web-app.js', ...(change.status === 'manual' ? { detail: change.detail } : {}) });

  const conflicts = steps.some((step) => step.status === 'conflict');
  if (conflicts || dryRun || writes.length === 0) return { plan, space: spacePath, steps, changed: false, conflicts };

  for (const { file, text } of writes) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }

  // Package scripts, such as css:build for pages that use Tailwind classes
  if (runScripts && plan.scripts?.length) {
    const scripts = JSON.parse((await readText(path.join(root, 'package.json'))) ?? '{}').scripts ?? {};
    for (const script of plan.scripts) {
      if (typeof scripts[script] !== 'string') continue;
      const { status } = spawnSync(scripts[script], { cwd: root, shell: true, stdio: 'inherit' });
      steps.push(status === 0 ? { status: 'run', target: script } : { status: 'manual', target: script, detail: `failed; run pnpm ${script}` });
    }
  }
  return { plan, space: spacePath, steps, changed: true, conflicts };

} // installExtension

const main = async () => {

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { 'dry-run': { type: 'boolean' }, 'no-build': { type: 'boolean' }, space: { type: 'string' } }
  });
  if (positionals.length !== 1) {
    console.log('Usage: pnpm extension:add <name> [--dry-run] [--space <path>] [--no-build]');
    process.exitCode = 1;
    return;
  }
  const [name] = positionals;
  const dryRun = Boolean(values['dry-run']);
  const result = await installExtension({ name, space: values.space, dryRun, runScripts: !values['no-build'] });

  console.log(`${dryRun ? 'Dry run: ' : ''}adding the ${name} extension (space: ${result.space})`);
  const verbs = { add: dryRun ? 'would add' : 'added', present: 'present', conflict: 'CONFLICT', manual: 'by hand', run: 'ran' };
  for (const step of result.steps) {
    console.log(`  ${verbs[step.status].padEnd(10)} ${step.target}${step.detail ? `: ${step.detail}` : ''}`);
  }
  if (result.conflicts) {
    console.log('\nNothing was changed. Move or remove the files marked CONFLICT (or fix the config file), then run it again.');
    process.exitCode = 1;
    return;
  }
  if (dryRun) {
    console.log('\nNothing was written.');
    return;
  }
  if (!result.changed && !result.steps.some((step) => step.status === 'manual')) {
    console.log(`\nThe ${name} extension is already installed.`);
    return;
  }
  if (result.plan.next?.length) console.log(`\nNext:\n${result.plan.next.map((line) => `  - ${line}`).join('\n')}`);

}; // main

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`extension:add: ${error.message}`);
    process.exitCode = 1;
  });
}
