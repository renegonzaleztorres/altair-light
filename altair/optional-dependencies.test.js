import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import WebServer from './altair.js';
import { createTestSettings } from './test/helpers.js';

const altairDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(altairDirectory, 'test', 'fixtures', 'optional-dependencies-fixture.js');

const getAvailablePort = async () => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
};

const importedOptionalPackages = async ({ minify, websocket }) => {
  const port = await getAvailablePort();
  const child = spawn(process.execPath, [fixturePath, String(minify), String(websocket), String(port)], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, `fixture failed:\n${stderr}`);
  return JSON.parse(stdout.trim().split('\n').at(-1));
};

const createFixture = async ({ minify = false, enableWebSocket = false, port } = {}) => {
  const appRootPath = await mkdtemp(path.join(os.tmpdir(), 'altair-optional-'));
  const activePath = path.join(appRootPath, 'space');
  for (const directory of ['pages', 'css', 'js', 'public']) {
    await mkdir(path.join(activePath, directory), { recursive: true });
  }
  await writeFile(path.join(activePath, 'pages', 'home.html'), '<h1>Home</h1>');
  await writeFile(path.join(activePath, 'css', 'site.css'), 'body {\n  color: red;\n}\n');
  await writeFile(path.join(activePath, 'js', 'site.js'), 'function add(first, second) {\n  return first + second;\n}\nglobalThis.add = add;\n');
  const server = new WebServer({ settings: createTestSettings({
    appRootPath,
    activeSpace: 'space',
    pagesLocation: 'pages',
    publicLocation: 'public',
    enableDataWatch: false,
    minify,
    enableWebSocket,
    webSocketAllowedOrigins: 'same-origin',
    debug: false,
    host: '127.0.0.1',
    port
  }) });
  return { server, appRootPath };
};

for (const [minify, websocket, expected] of [
  [false, false, []],
  [true, false, ['clean-css', 'terser']],
  [false, true, ['ws']]
]) {
  test(`MINIFY=${minify} ENABLE_WEBSOCKET=${websocket} imports only ${JSON.stringify(expected)}`, { timeout: 15000 }, async () => {
    assert.deepEqual(await importedOptionalPackages({ minify, websocket }), expected);
  });
}

test('on-demand minifiers still minify CSS and JS', async () => {
  const { server, appRootPath } = await createFixture({ minify: true });
  try {
    server.dataFilePath = path.join(appRootPath, 'space', 'DATA.json');
    server.routes();
    const css = await server.app.request('http://altair.test/css/site.css');
    assert.equal(css.status, 200);
    assert.equal(await css.text(), 'body{color:red}');

    const js = await server.app.request('http://altair.test/js/site.js');
    assert.equal(js.status, 200);
    const script = await js.text();
    assert.ok(!script.includes('\n'), script);
    assert.ok(script.includes('globalThis.add=add'), script);
  } finally {
    await rm(appRootPath, { recursive: true, force: true });
  }
});

test('on-demand WebSocket server accepts a session when enabled', { timeout: 15000 }, async () => {
  const port = await getAvailablePort();
  const { server, appRootPath } = await createFixture({ enableWebSocket: true, port });
  try {
    await server.start();
    assert.ok(server.wsServer);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: `http://127.0.0.1:${port}` } });
    await once(socket, 'open');
    const reply = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'init' }));
    const [message] = await reply;
    const connected = JSON.parse(message.data);
    assert.equal(connected.type, 'connected');
    assert.ok(server.wsServer.getSession(connected.session_id));
    socket.close();
  } finally {
    await server.shutdown();
    await rm(appRootPath, { recursive: true, force: true });
  }
});
