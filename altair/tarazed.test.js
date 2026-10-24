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
