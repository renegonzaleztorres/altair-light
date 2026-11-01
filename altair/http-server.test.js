import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import HTTPServer from './http-server.js';
import { createTestSettings } from './test/helpers.js';

const altairDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(altairDirectory);
const fixturePath = path.join(altairDirectory, 'test', 'fixtures', 'http-server-fixture.js');

const getAvailablePort = async () => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
};

const startServer = async ({ hostname, port }) => {
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    APP_NAME: 'altair-light-test',
    ACTIVE_SPACE: 'spaces/kinetic',
    PUBLIC_LOCATION: 'public',
    PAGES_LOCATION: 'pages',
    DATA_LOCATION: 'data',
    DATA_FILE: 'DATA.json',
    ENABLE_DATA_WATCH: 'false',
    ENABLE_WEBSOCKET: 'false',
    DEBUG: 'true',
    PORT: String(port)
  };

  if (hostname === undefined) {
    delete env.HOST;
  } else {
    env.HOST = hostname;
  }

  const child = spawn(process.execPath, [fixturePath], {
    cwd: projectRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  const listening = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Server did not start in time. Output:\n${output}`));
    }, 5000);

    const capture = (chunk) => {
      output += chunk.toString();
      const match = output.match(/server listening on ([^\s]+):(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve({ hostname: match[1], port: Number(match[2]) });
      }
    };

    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited before listening (code ${code}). Output:\n${output}`));
    });
  });

  try {
    const address = await listening;
    return { child, address };
  } catch (error) {
    child.kill('SIGTERM');
    throw error;
  }
};

const stopServer = async (child) => {
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
};

for (const scenario of [
  { name: 'defaults HOST to loopback', hostname: undefined, expected: '127.0.0.1' },
  { name: 'binds to an explicit loopback HOST', hostname: '127.0.0.1', expected: '127.0.0.1' },
  { name: 'binds to all IPv4 interfaces when requested', hostname: '0.0.0.0', expected: '0.0.0.0' }
]) {
  test(scenario.name, { timeout: 10000 }, async () => {
    const port = await getAvailablePort();
    const { child, address } = await startServer({ hostname: scenario.hostname, port });

    try {
      assert.equal(address.hostname, scenario.expected);
      assert.equal(address.port, port);

      const response = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(response.status, 200);

      const staticResponse = await fetch(`http://127.0.0.1:${port}/images/summer-triangle.png`);
      assert.equal(staticResponse.status, 200);

      const missingStaticResponse = await fetch(`http://127.0.0.1:${port}/images/not-present.png`);
      assert.equal(missingStaticResponse.status, 404);
      assert.equal(missingStaticResponse.headers.get('location'), null);
      assert.equal(missingStaticResponse.headers.get('cache-control'), 'no-store');
    } finally {
      await stopServer(child);
    }
  });
}

test('startup rejects and cleans up when the HTTP listener cannot bind', async () => {
  const blocker = createServer();
  blocker.listen(0, '127.0.0.1');
  await once(blocker, 'listening');
  const { port } = blocker.address();
  const appRootPath = await mkdtemp(path.join(os.tmpdir(), 'altair-startup-rollback-'));
  await mkdir(path.join(appRootPath, 'space', 'public'), { recursive: true });
  const server = new HTTPServer({ settings: createTestSettings({
    appRootPath,
    activeSpace: 'space',
    publicLocation: 'public',
    dataLocation: 'data',
    dataFile: 'DATA.json',
    enableDataWatch: false,
    host: '127.0.0.1',
    port
  }) });

  try {
    await assert.rejects(server.start(), (error) => error.code === 'EADDRINUSE');
    assert.equal(server.shuttingDown, true);
    assert.equal(server.signalHandlers, null);
    assert.equal(server.spaceWatcher, null);
  } finally {
    blocker.close();
    await once(blocker, 'close');
    await rm(appRootPath, { recursive: true, force: true });
  }
});

test('settings-ready initialization runs once and its failures reject startup', async () => {
  class ReadyServer extends HTTPServer {
    notifications = 0;
    onSettingsReady() {
      this.notifications += 1;
    }
  }
  const ready = new ReadyServer({ settings: createTestSettings() });
  ready.initialize();
  ready.initialize();
  assert.equal(ready.notifications, 1);

  class FailingServer extends HTTPServer {
    onSettingsReady() {
      throw new Error('application initialization failed');
    }
  }
  const failing = new FailingServer({ settings: createTestSettings() });
  await assert.rejects(failing.start(), /application initialization failed/);
  assert.equal(failing.shuttingDown, true);
});
