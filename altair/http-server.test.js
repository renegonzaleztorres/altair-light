import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

  const child = spawn(process.execPath, ['index.js'], {
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
    } finally {
      await stopServer(child);
    }
  });
}
