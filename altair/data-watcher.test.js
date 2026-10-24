import assert from 'node:assert/strict';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import HTTPServer from './http-server.js';

const waitFor = async (predicate, timeoutMs = 2000) => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Condition was not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const replaceAtomically = async (targetPath, value, sequence) => {
  const temporaryPath = `${targetPath}.tmp-${sequence}`;
  await writeFile(temporaryPath, JSON.stringify({ value }));
  await rename(temporaryPath, targetPath);
};

test('data watcher survives repeated atomic rename replacements', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'altair-data-watch-'));
  const dataFilePath = path.join(dataDirectory, 'DATA.json');
  const server = new HTTPServer();

  server.settings.nodeEnv = 'development';
  server.settings.debug = false;
  server.dataFilePath = dataFilePath;
  server.dataFileWatchInterval = 20;
  server.dataReloadDebounce = 25;
  server.dataReloadRetryDelay = 20;

  try {
    await writeFile(dataFilePath, JSON.stringify({ value: 'initial' }));
    assert.equal(await server.loadDataFile(), true);
    await server.watchDataFile();

    await replaceAtomically(dataFilePath, 'first replacement', 1);
    await waitFor(() => server.getDataCache().value === 'first replacement');

    await replaceAtomically(dataFilePath, 'second replacement', 2);
    await waitFor(() => server.getDataCache().value === 'second replacement');

    assert.deepEqual(server.getDataCache(), { value: 'second replacement' });
  } finally {
    server.stopWatchingDataFile();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
