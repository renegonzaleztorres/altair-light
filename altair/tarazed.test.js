import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Tarazed from './tarazed.js';

test('replaceParamTags keeps prefix-related parameter names distinct', () => {
  const tarazed = new Tarazed({ appPath: process.cwd() });
  const template = '@@PARAM_date|@@PARAM_dateDisplay|@@PARAM_date';

  const rendered = tarazed.replaceParamTags(template, {
    date: '2026-04-19',
    dateDisplay: 'April 19, 2026'
  });

  assert.equal(rendered, '2026-04-19|April 19, 2026|2026-04-19');
});

test('replaceParamTags keeps prefix-related names distinct when formatting for JavaScript', () => {
  const tarazed = new Tarazed({ appPath: process.cwd() });
  const template = '@@PARAM_date|@@PARAM_dateDisplay';

  const rendered = tarazed.replaceParamTags(template, {
    date: 'ignored',
    dateDisplay: 'ignored',
    FORMAT_PARAMS_FOR_JS: true
  });

  assert.equal(rendered, '{date}|{dateDisplay}');
});

test('replaceDataTags keeps prefix-related selectors distinct', async () => {
  const appPath = await mkdtemp(path.join(os.tmpdir(), 'altair-tarazed-'));

  try {
    await writeFile(path.join(appPath, 'content.json'), JSON.stringify({
      date: '2026-04-19',
      dateDisplay: 'April 19, 2026'
    }));

    const tarazed = new Tarazed({ appPath });
    const template = '@@DATA_content.json#date @@DATA_content.json#dateDisplay @@DATA_content.json#date';
    const rendered = await tarazed.replaceDataTags(template);

    assert.equal(rendered, '2026-04-19 April 19, 2026 2026-04-19');
  } finally {
    await rm(appPath, { recursive: true, force: true });
  }
});

test('replaceVarTags keeps prefix-related variables distinct in either order', () => {
  const tarazed = new Tarazed({ appPath: process.cwd() });
  const rendered = tarazed.replaceVarTags(
    '@@VAR_date|@@VAR_dateDisplay|@@VAR_dateDisplay|@@VAR_date',
    { date: 'short', datedisplay: 'long' }
  );

  assert.equal(rendered, 'short|long|long|short');
});

test('replaceElemTags replaces complete path and parameter tokens without prefix collisions', async () => {
  const appPath = await mkdtemp(path.join(os.tmpdir(), 'altair-elem-prefix-'));
  try {
    await writeFile(path.join(appPath, 'piece'), 'short');
    await writeFile(path.join(appPath, 'pieceLong'), 'long');
    await writeFile(path.join(appPath, 'card.html'), '[@@PARAM_label]');
    const tarazed = new Tarazed({ appPath });
    const rendered = await tarazed.replaceElemTags(
      '@@ELEM_piece|@@ELEM_pieceLong|@@ELEM_pieceLong|@@ELEM_piece\n' +
      '@@ELEM_card.html|@@ELEM_card.html;{"label":"mapped"}\n' +
      '@@ELEM_missing|@@ELEM_missingLong'
    );

    assert.equal(rendered, 'short|long|long|short\n[]|[mapped]\nUNDEFINED|UNDEFINED');
  } finally {
    await rm(appPath, { recursive: true, force: true });
  }
});

test('replaceElemTags terminates direct and indirect include cycles safely', async () => {
  const appPath = await mkdtemp(path.join(os.tmpdir(), 'altair-elem-cycle-'));
  try {
    await writeFile(path.join(appPath, 'self.html'), '@@ELEM_self.html');
    await writeFile(path.join(appPath, 'a.html'), '@@ELEM_b.html');
    await writeFile(path.join(appPath, 'b.html'), '@@ELEM_a.html');
    await writeFile(path.join(appPath, 'outer.html'), '@@ELEM_inner.html');
    await writeFile(path.join(appPath, 'inner.html'), 'nested');
    const tarazed = new Tarazed({ appPath });

    assert.equal(await tarazed.replaceElemTags('@@ELEM_outer.html'), 'nested');
    assert.equal(await tarazed.replaceElemTags('@@ELEM_self.html'), 'UNDEFINED');
    assert.equal(await tarazed.replaceElemTags('@@ELEM_a.html'), 'UNDEFINED');
  } finally {
    await rm(appPath, { recursive: true, force: true });
  }
});

test('replaceRepeatTags keeps prefix-related selectors distinct and treats pipe as a boundary', async () => {
  const appPath = await mkdtemp(path.join(os.tmpdir(), 'altair-repeat-prefix-'));
  try {
    await writeFile(path.join(appPath, 'card.html'), '[@@PARAM_value]');
    await writeFile(path.join(appPath, 'content.json'), JSON.stringify({
      date: ['short'],
      dateDisplay: ['long']
    }));
    const tarazed = new Tarazed({ appPath });
    const rendered = await tarazed.replaceRepeatTags(
      '@@REPEAT_card.html;content.json#date|@@REPEAT_card.html;content.json#dateDisplay|' +
      '@@REPEAT_card.html;content.json#dateDisplay|@@REPEAT_card.html;content.json#date'
    );

    assert.equal(rendered, '[short]|[long]|[long]|[short]');
  } finally {
    await rm(appPath, { recursive: true, force: true });
  }
});

test('replaceDataTags treats pipe as a complete-token boundary', async () => {
  const appPath = await mkdtemp(path.join(os.tmpdir(), 'altair-data-boundary-'));
  try {
    await writeFile(path.join(appPath, 'content.json'), JSON.stringify({
      date: 'short',
      dateDisplay: 'long'
    }));
    const tarazed = new Tarazed({ appPath });
    const rendered = await tarazed.replaceDataTags(
      '@@DATA_content.json#date|@@DATA_content.json#dateDisplay'
    );

    assert.equal(rendered, 'short|long');
  } finally {
    await rm(appPath, { recursive: true, force: true });
  }
});
