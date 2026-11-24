import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { appendEnv, formatJson, installExtension, registerChange } from './add.js';

const EXTENSIONS = fileURLToPath(new URL('.', import.meta.url));
const STARTER = path.join(EXTENSIONS, 'forms', 'starter');

const WEB_APP = `import WebServer from '../altair/altair.js';
import { tailwind } from '../extensions/tailwind/tailwind.js';

class WebApp extends WebServer{

  // (see extensions/README.md), e.g. static extensions = [tailwind, seo, sitemap, redirects, googleAnalytics];
  static extensions = [tailwind];

}

export default WebApp;
`;

// project : a throwaway project root with the files the installer reads
const project = async (files = {}) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'altair-add-'));
  const all = {
    'web-app/web-app.js': WEB_APP,
    'config/development.json': '{\n}',
    '.env.example': 'PORT=3000\n',
    'spaces/kinetic/pages/home.html': '<p>Home</p>',
    ...files
  };
  for (const [name, contents] of Object.entries(all)) {
    if (contents === null) continue;
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), contents);
  }
  const read = (name) => readFile(path.join(root, name), 'utf8').catch(() => null);
  const install = (options = {}) => installExtension({ name: 'forms', root, extensionsDir: EXTENSIONS, runScripts: false, space: 'spaces/kinetic', ...options });
  return { root, read, install, cleanup: () => rm(root, { recursive: true, force: true }) };
};

const SNAPSHOT_FILES = ['web-app/web-app.js', 'config/development.json', '.env.example', '.env', 'spaces/kinetic/pages/contact-us.html'];
const snapshot = async (read) => Object.fromEntries(await Promise.all(SNAPSHOT_FILES.map(async (name) => [name, await read(name)])));

test('a dry run reports every change and writes nothing', async () => {
  const { read, install, cleanup } = await project();
  try {
    const before = await snapshot(read);
    const result = await install({ dryRun: true });
    assert.equal(result.changed, false);
    assert.deepEqual(result.steps.map((step) => `${step.status} ${step.target}`), [
      'add spaces/kinetic/pages/contact-us.html',
      'add spaces/kinetic/_emails/contact-us.txt',
      'add spaces/kinetic/_emails/contact-us-confirmation.txt',
      'add config/development.json',
      'add .env.example',
      'add web-app/web-app.js'
    ]);
    assert.deepEqual(await snapshot(read), before);
  } finally {
    await cleanup();
  }
});

test('install adds the starter files, config, variables and registration; a second run changes nothing', async () => {
  const { read, install, cleanup } = await project({ '.env': 'PORT=3000\nMAIL_PROVIDER="ses"\nMAIL_SES_REGION="eu-west-1"\nMAIL_SES_ACCESS_KEY_ID=""\nMAIL_SES_SECRET_ACCESS_KEY=""\n' });
  try {
    const result = await install();
    assert.equal(result.changed, true);
    assert.equal(await read('spaces/kinetic/pages/contact-us.html'), await readFile(path.join(STARTER, 'pages/contact-us.html'), 'utf8'));
    assert.equal(await read('spaces/kinetic/_emails/contact-us.txt'), await readFile(path.join(STARTER, '_emails/contact-us.txt'), 'utf8'));

    const config = JSON.parse(await read('config/development.json'));
    assert.deepEqual(config.extensions.forms, JSON.parse(await readFile(path.join(STARTER, 'config.json'), 'utf8')));

    const webApp = await read('web-app/web-app.js');
    assert.match(webApp, /import \{ tailwind \} from '\.\.\/extensions\/tailwind\/tailwind\.js';\nimport \{ forms \} from '\.\.\/extensions\/forms\/forms\.js';\n/);
    assert.match(webApp, /^ {2}static extensions = \[tailwind, forms\];$/m);
    assert.match(webApp, /e\.g\. static extensions = \[tailwind, seo, sitemap, redirects, googleAnalytics\];/, 'the comment is left alone');

    const example = await read('.env.example');
    assert.match(example, /^PORT=3000\n\n# Mail/);
    assert.match(example, /^MAIL_PROVIDER="log"$/m);
    assert.match(example, /^TURNSTILE_SECRET_KEY=/m);
    const env = await read('.env');
    assert.match(env, /MAIL_PROVIDER="ses"/, 'existing values are kept');
    assert.equal(env.match(/MAIL_PROVIDER=/g).length, 1);
    assert.match(env, /^TURNSTILE_SECRET_KEY=/m);

    const before = await snapshot(read);
    const again = await install();
    assert.equal(again.changed, false);
    assert.ok(again.steps.every((step) => step.status === 'present'), JSON.stringify(again.steps));
    assert.deepEqual(await snapshot(read), before);
  } finally {
    await cleanup();
  }
});

test('a file that differs from the starter is a conflict, and then nothing is written', async () => {
  const { read, install, cleanup } = await project({ 'spaces/kinetic/pages/contact-us.html': '<p>My own contact page</p>' });
  try {
    const before = await snapshot(read);
    const result = await install();
    assert.equal(result.conflicts, true);
    assert.equal(result.changed, false);
    assert.deepEqual(result.steps.find((step) => step.status === 'conflict'),
      { status: 'conflict', target: 'spaces/kinetic/pages/contact-us.html', detail: 'differs from the starter file; not overwritten' });
    assert.deepEqual(await snapshot(read), before);
    assert.equal(await read('spaces/kinetic/_emails/contact-us.txt'), null);
  } finally {
    await cleanup();
  }
});

test('a block already in default.json is left there; an unreadable config file is a conflict', async () => {
  const configured = await project({ 'config/default.json': '{ "extensions": { "forms": {} } }' });
  try {
    const result = await configured.install();
    assert.deepEqual(result.steps.find((step) => step.target.startsWith('config/')),
      { status: 'present', target: 'config/default.json', detail: 'extensions.forms is already set' });
    assert.equal(await configured.read('config/development.json'), '{\n}');
  } finally {
    await configured.cleanup();
  }

  const broken = await project({ 'config/development.json': '{ "extensions": ' });
  try {
    const result = await broken.install();
    assert.equal(result.conflicts, true);
    assert.match(result.steps.find((step) => step.status === 'conflict').detail, /cannot be read as JSON/);
  } finally {
    await broken.cleanup();
  }
});

test('the active space comes from --space, then ACTIVE_SPACE in .env', async () => {
  const { read, install, cleanup } = await project({ '.env': 'ACTIVE_SPACE="spaces/site"\n', 'spaces/site/pages/home.html': '<p>Home</p>' });
  try {
    const result = await install({ space: undefined });
    assert.equal(result.space, 'spaces/site');
    assert.notEqual(await read('spaces/site/pages/contact-us.html'), null);
    await assert.rejects(install({ space: 'spaces/missing' }), /spaces\/missing does not exist/);
    await assert.rejects(install({ space: '../elsewhere' }), /outside the project/);
  } finally {
    await cleanup();
  }
});

test('unknown extensions and extensions without an installer are refused', async () => {
  const { install, cleanup } = await project();
  try {
    await assert.rejects(install({ name: 'nope' }), /no extension named nope/);
    await assert.rejects(install({ name: 'seo' }), /has no installer; follow extensions\/seo\/README\.md/);
    await assert.rejects(install({ name: '../forms' }), /not an extension name/);
  } finally {
    await cleanup();
  }
});

test('registerChange patches the usual web-app.js and leaves anything unusual to you', () => {
  const specifier = '../extensions/forms/forms.js';
  assert.match(registerChange(WEB_APP.replace('[tailwind]', '[]'), 'forms', specifier).text, /static extensions = \[forms\];/);
  assert.match(registerChange(WEB_APP.replace('[tailwind]', '[tailwind, ]'), 'forms', specifier).text, /static extensions = \[tailwind, forms\];/);
  assert.deepEqual(registerChange(`${WEB_APP}\nimport { forms } from '${specifier}';`.replace('[tailwind]', '[tailwind, forms]'), 'forms', specifier), { status: 'present' });
  assert.equal(registerChange(WEB_APP.replace('[tailwind]', '[\n    tailwind\n  ]'), 'forms', specifier).status, 'manual');
  assert.equal(registerChange(WEB_APP.replace('  static extensions = [tailwind];\n', ''), 'forms', specifier).status, 'manual');
  assert.match(registerChange(WEB_APP.replace('[tailwind]', '[formsLegacy]'), 'forms', specifier).text, /\[formsLegacy, forms\]/);
});

test('appendEnv adds whole paragraphs and names the variables it could not add', () => {
  const block = '# Mail\nA="1"\nB=""\n\n# Other\nC="3"\n';
  assert.deepEqual(appendEnv('', block), { text: '# Mail\nA="1"\nB=""\n\n# Other\nC="3"\n', added: ['A', 'B', 'C'], missing: [] });
  assert.deepEqual(appendEnv('A=x\n', block), { text: 'A=x\n\n# Other\nC="3"\n', added: ['C'], missing: ['B'] });
  assert.deepEqual(appendEnv('export A=x\nB=y\nC=z', block), { text: 'export A=x\nB=y\nC=z', added: [], missing: [] });
});

test('formatJson keeps short values on one line and breaks long ones', () => {
  assert.equal(formatJson({}), '{}');
  assert.equal(formatJson({ a: [1, 2], b: { c: 'd' } }), '{\n  "a": [1, 2],\n  "b": { "c": "d" }\n}');
  const long = { list: Array.from({ length: 30 }, (_, index) => `item-${index}`) };
  assert.match(formatJson(long), /^\{\n {2}"list": \[\n {4}"item-0",\n/);
  assert.deepEqual(JSON.parse(formatJson(long)), long);
});
