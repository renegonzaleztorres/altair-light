import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Tarazed from './tarazed.js';
import { createExtensionTestServer } from './test/helpers.js';

// createSpace : a project folder holding a secret file and an active space
const createSpace = async (files = {}) => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'altair-template-safety-'));
  const appPath = path.join(rootPath, 'spaces', 'site');
  const write = async (relativePath, contents) => {
    const target = path.join(rootPath, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  };
  await write('.env', 'SECRET=outside');
  await write('secret.json', JSON.stringify({ value: 'outside', items: [{ value: 'outside' }] }));
  for (const [name, contents] of Object.entries(files)) await write(path.join('spaces', 'site', name), contents);
  const readouts = [];
  const tarazed = new Tarazed({ appPath, readoutCallback: (message, label) => readouts.push(`${label}: ${message}`) });
  return { rootPath, appPath, tarazed, readouts, cleanup: () => rm(rootPath, { recursive: true, force: true }) };
};

test('@@ELEM_ cannot read files outside the space or hidden files', async () => {
  const { tarazed, readouts, cleanup } = await createSpace({ '.env': 'SECRET=space', 'globals/_ok.html': 'ok' });
  try {
    assert.equal(await tarazed.replaceElemTags('@@ELEM_globals/_ok.html'), 'ok');
    assert.equal(await tarazed.replaceElemTags('@@ELEM_./globals/_ok.html'), 'ok');
    assert.equal(await tarazed.replaceElemTags('@@ELEM_../../.env'), 'UNDEFINED');
    assert.equal(await tarazed.replaceElemTags('@@ELEM_globals/../../../secret.json'), 'UNDEFINED');
    assert.equal(await tarazed.replaceElemTags('@@ELEM_.env'), 'UNDEFINED');
    assert.ok(readouts.some((line) => line.includes('outside the active space')));
  } finally {
    await cleanup();
  }
});

test('@@ELEM_, @@DATA_ and @@REPEAT_ refuse symlinks that point outside the space', async () => {
  const { rootPath, appPath, tarazed, cleanup } = await createSpace({ 'globals/_card.html': '[@@PARAM_value]' });
  try {
    await mkdir(path.join(appPath, 'data'), { recursive: true });
    await symlink(path.join(rootPath, 'secret.json'), path.join(appPath, 'data', 'linked.json'));
    await symlink(path.join(rootPath, '.env'), path.join(appPath, 'globals', '_linked.html'));

    assert.equal(await tarazed.replaceElemTags('@@ELEM_globals/_linked.html'), 'UNDEFINED');
    assert.equal(await tarazed.replaceDataTags('@@DATA_data/linked.json#value'), 'UNDEFINED');
    assert.equal(await tarazed.replaceRepeatTags('@@REPEAT_globals/_card.html;data/linked.json#items'), 'UNDEFINED');
    assert.equal(await tarazed.replaceDataTags('@@DATA_../../secret.json#value'), 'UNDEFINED');
  } finally {
    await cleanup();
  }
});

test('symlinks that stay inside the space still work', async () => {
  const { appPath, tarazed, cleanup } = await createSpace({ 'data/real.json': JSON.stringify({ value: 'inside' }) });
  try {
    await symlink(path.join(appPath, 'data', 'real.json'), path.join(appPath, 'data', 'alias.json'));
    assert.equal(await tarazed.replaceDataTags('@@DATA_data/alias.json#value'), 'inside');
  } finally {
    await cleanup();
  }
});

test('@@ELEM_ parameters may nest, contain braces and span lines', async () => {
  const { tarazed, cleanup } = await createSpace({ '_t.html': '<b>@@PARAM_Title</b>' });
  try {
    assert.equal(await tarazed.replaceElemTags('@@ELEM__t.html;{"Title":"ok","Meta":{"x":1}}!'), '<b>ok</b>!');
    assert.equal(await tarazed.replaceElemTags('@@ELEM__t.html;{"Title":"a}b \\"q\\""}'), '<b>a}b "q"</b>');
    assert.equal(await tarazed.replaceElemTags('@@ELEM__t.html;{\n  "Title": "multi"\n}'), '<b>multi</b>');
  } finally {
    await cleanup();
  }
});

test('bad parameter JSON is reported instead of silently ignored', async () => {
  const { tarazed, readouts, cleanup } = await createSpace({ '_t.html': '<b>@@PARAM_Title</b>' });
  try {
    await tarazed.replaceElemTags('@@ELEM__t.html;{"Title":}');
    assert.ok(readouts.some((line) => line.includes('Invalid parameter JSON in @@ELEM__t.html')), readouts.join('\n'));
    await tarazed.replaceElemTags('@@ELEM__t.html;{"Title":"never closed"');
    assert.ok(readouts.some((line) => line.includes('Unterminated parameter JSON after @@ELEM__t.html')), readouts.join('\n'));
  } finally {
    await cleanup();
  }
});

test('@@REPEAT_ mappings may nest and contain braces', async () => {
  const { tarazed, cleanup } = await createSpace({
    '_card.html': '<i>@@PARAM_Name|@@PARAM_Fixed</i>',
    'data/list.json': JSON.stringify({ items: [{ name: 'a' }, { name: 'b' }] })
  });
  try {
    const rendered = await tarazed.replaceRepeatTags('@@REPEAT__card.html;data/list.json#items;{"Name":"name","Fixed":{"x":"}"}}.');
    assert.equal(rendered, '<i>a|{"x":"}"}</i><i>b|{"x":"}"}</i>.');
  } finally {
    await cleanup();
  }
});

test('@@VAR_ resolves only own variables, never prototype members', () => {
  const tarazed = new Tarazed({ appPath: process.cwd() });
  const rendered = tarazed.replaceVarTags('@@VAR_constructor|@@VAR_toString|@@VAR_valueOf|@@VAR_name', { name: 'Altair' });
  assert.equal(rendered, 'UNDEFINED|UNDEFINED|UNDEFINED|Altair');
});

test('DATA.json keys named hasOwnProperty or __proto__ do not break pages', async () => {
  const { request, cleanup } = await createExtensionTestServer({
    pages: { 'home.html': '<p>@@VAR_hasownproperty|@@VAR_site_name|@@VAR_polluted</p>' },
    data: JSON.parse('{"hasOwnProperty":"own","site":{"name":"Altair"},"__proto__":{"polluted":"yes"}}')
  });
  try {
    const response = await request('/');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '<p>own|Altair|UNDEFINED</p>');
    assert.equal({}.polluted, undefined);
  } finally {
    await cleanup();
  }
});
