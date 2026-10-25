import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const directory = path.dirname(fileURLToPath(import.meta.url));

test('HTTP runtime import graph excludes publisher and provider packages', async () => {
  const runtimeFiles = [
    'altair.js',
    'http-server.js',
    'lib.js',
    'constants.js',
    'media-config.js'
  ];
  const content = (await Promise.all(
    runtimeFiles.map((file) => readFile(path.join(directory, file), 'utf8'))
  )).join('\n');
  assert.doesNotMatch(content, /media-publisher|media-provider-s3|@aws-sdk|file-type/);
});
