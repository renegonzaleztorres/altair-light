import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createSettings } from './settings.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(directory, 'test', 'fixtures', 'settings-fixture.js');
const frameworkEnvironmentNames = [
  'NODE_ENV', 'NODE_CONFIG_ENV', 'NODE_CONFIG', 'APP_NAME', 'HOST', 'PORT',
  'ACTIVE_SPACE', 'PUBLIC_LOCATION', 'PAGES_LOCATION', 'MEDIA_LOCATION',
  'MEDIA_CDN_FALLBACK', 'MEDIA_CDN_BASE_URL', 'DATA_LOCATION', 'DATA_FILE',
  'ENABLE_DATA_WATCH', 'ENABLE_ROUTE_CACHE', 'ROUTE_CACHE_MAX_ENTRIES',
  'ROUTE_CACHE_WATCH', 'ROUTE_CACHE_QUIET_MS', 'ROUTE_CACHE_MAX_BATCH_MS',
  'ROUTE_CACHE_RECONCILE', 'ROUTE_CACHE_RECONCILE_MS', 'ROUTE_CACHE_DEBUG',
  'MINIFY', 'DEBUG', 'ENABLE_WEBSOCKET', 'WEBSOCKET_PATH',
  'WEBSOCKET_HEARTBEAT_MS', 'WEBSOCKET_SESSION_TTL_SECS',
  'WEBSOCKET_ALLOWED_ORIGINS'
];

const runFixture = async ({ cwd, environment = {} }) => {
  const env = { ...process.env, ...environment };
  for (const name of frameworkEnvironmentNames) {
    if (!Object.prototype.hasOwnProperty.call(environment, name)) delete env[name];
  }
  env.NODE_CONFIG_DIR = path.join(cwd, 'config');
  env.SUPPRESS_NO_CONFIG_WARNING = 'true';

  const child = spawn(process.execPath, [fixturePath], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(child, 'exit');
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
};

const createConfigFixture = async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'altair-settings-'));
  await mkdir(path.join(cwd, 'config'));
  await writeFile(path.join(cwd, 'config', 'default.json'), JSON.stringify({
    version: 'fixture',
    enableRouteCache: true,
    feature: { source: 'default', retained: true }
  }));
  await writeFile(path.join(cwd, 'config', 'development.json'), JSON.stringify({
    feature: { source: 'development' }
  }));
  await writeFile(path.join(cwd, 'config', 'staging.json'), JSON.stringify({
    feature: { source: 'staging' }
  }));
  await writeFile(path.join(cwd, 'config', 'production.json'), JSON.stringify({
    feature: { source: 'production' }
  }));
  return cwd;
};

test('settings expose merged config and let .env select the node-config environment', async () => {
  const cwd = await createConfigFixture();
  try {
    await writeFile(path.join(cwd, '.env'), 'NODE_ENV=production\nPORT=4100\n');
    const result = await runFixture({ cwd });
    assert.equal(result.code, 0, result.stderr);
    const settings = JSON.parse(result.stdout.split('\n').at(-1));
    assert.equal(settings.nodeEnv, 'production');
    assert.equal(settings.port, 4100);
    assert.equal(settings.enableRouteCache, true);
    assert.deepEqual(settings.feature, { source: 'production', retained: true });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('exported environment variables override .env and config runtime values', async () => {
  const cwd = await createConfigFixture();
  try {
    await writeFile(path.join(cwd, '.env'), 'NODE_ENV=production\nPORT=4100\nHOST=127.0.0.1\n');
    const result = await runFixture({
      cwd,
      environment: {
        NODE_ENV: 'staging', PORT: '4200', HOST: '0.0.0.0', ENABLE_ROUTE_CACHE: 'false'
      }
    });
    assert.equal(result.code, 0, result.stderr);
    const settings = JSON.parse(result.stdout.split('\n').at(-1));
    assert.equal(settings.nodeEnv, 'staging');
    assert.equal(settings.port, 4200);
    assert.equal(settings.host, '0.0.0.0');
    assert.equal(settings.enableRouteCache, false);
    assert.deepEqual(settings.feature, { source: 'staging', retained: true });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('settings reject invalid ports and the removed config.localPort key', async () => {
  const cwd = await createConfigFixture();
  try {
    await writeFile(path.join(cwd, '.env'), 'NODE_ENV=development\nPORT=invalid\n');
    const result = await runFixture({ cwd });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /PORT must be an integer/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }

  assert.throws(
    () => createSettings({ applicationConfig: { localPort: 3000 }, env: {} }),
    /localPort is no longer supported/
  );
});

test('settings reject a node-config environment that disagrees with NODE_ENV', async () => {
  const cwd = await createConfigFixture();
  try {
    const result = await runFixture({
      cwd,
      environment: { NODE_ENV: 'production', NODE_CONFIG_ENV: 'staging' }
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /selected staging while NODE_ENV is production/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('the complete settings tree is immutable', () => {
  const settings = createSettings({
    applicationConfig: { version: 'test', custom: { enabled: true } },
    env: { NODE_ENV: 'development' }
  });
  assert.equal(Object.isFrozen(settings), true);
  assert.equal(Object.isFrozen(settings.custom), true);
  assert.throws(() => { settings.custom.enabled = false; }, TypeError);
});
