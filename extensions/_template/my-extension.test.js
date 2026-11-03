import assert from 'node:assert/strict';
import test from 'node:test';

import { createExtensionTestServer } from '../../altair/test/helpers.js';
import { myExtension } from './my-extension.js';

const PAGE = '<!doctype html><html><head><title>Home</title></head><body>@@VAR_greeting</body></html>';

test('adds @@VAR_greeting when configured', async () => {
  const { request, cleanup } = await createExtensionTestServer({
    extensions: [myExtension],
    config: { myExtension: { greeting: 'Hello' } },
    pages: { 'home.html': PAGE }
  });
  try {
    assert.match(await (await request('/')).text(), /<body>Hello<\/body>/);
  } finally {
    await cleanup();
  }
});

test('does nothing without its config block', async () => {
  const { request, server, cleanup } = await createExtensionTestServer({
    extensions: [myExtension],
    pages: { 'home.html': PAGE }
  });
  try {
    assert.equal(server.extensionRunner.status[0].active, false);
    assert.doesNotMatch(await (await request('/')).text(), /Hello/);
  } finally {
    await cleanup();
  }
});

test('rejects an invalid setting at startup', async () => {
  await assert.rejects(
    createExtensionTestServer({ extensions: [myExtension], config: { myExtension: { greeting: 42 } } }),
    /greeting must be a string/
  );
});
