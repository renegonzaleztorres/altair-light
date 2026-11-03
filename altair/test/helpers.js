import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import WebServer from '../altair.js';
import { createSettings } from '../settings.js';

const projectRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

const createTestSettings = (overrides = {}) => {
  const {
    appRootPath = projectRoot,
    nodeEnv = 'development',
    host,
    port,
    ...applicationConfig
  } = overrides;
  const env = { NODE_ENV: nodeEnv };
  if (host !== undefined) env.HOST = String(host);
  if (port !== undefined) env.PORT = String(port);
  return createSettings({
    applicationConfig: { version: 'test', ...applicationConfig },
    env,
    appRootPath
  });
};

// createExtensionTestServer : a temporary active space and a server prepared exactly as start()
// prepares it (extension setup, DATA, middleware, routes), served in-process without a port
const createExtensionTestServer = async ({
  extensions = [],
  config,
  pages = { 'home.html': '<!doctype html><html><head><title>Home</title></head><body></body></html>' },
  files = {},
  data = {},
  env = {},
  settings = {},
  App = WebServer
} = {}) => {
  const appRootPath = await mkdtemp(path.join(os.tmpdir(), 'altair-extension-'));
  const activeSpace = 'space';
  const activePath = path.join(appRootPath, activeSpace);
  const write = async (relativePath, contents) => {
    const target = path.join(activePath, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  };
  for (const directory of ['pages', 'css', 'js', 'public', 'data']) {
    await mkdir(path.join(activePath, directory), { recursive: true });
  }
  for (const [name, contents] of Object.entries(pages)) await write(path.join('pages', name), contents);
  for (const [name, contents] of Object.entries(files)) await write(name, contents);
  await write(path.join('data', 'DATA.json'), JSON.stringify(data));

  class TestApp extends App {
    static extensions = extensions;
  }
  const server = new TestApp({ settings: createTestSettings({
    appRootPath,
    activeSpace,
    enableDataWatch: false,
    debug: false,
    minify: false,
    ...settings,
    ...(config === undefined ? {} : { extensions: config })
  }) });

  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    await server.shutdown();
    await rm(appRootPath, { recursive: true, force: true });
  };
  try {
    await server.setupExtensions({ env });
    await server.prepare();
  } catch (error) {
    await cleanup();
    throw error;
  }

  const request = (pathname, options) => server.app.request(`http://altair.test${pathname}`, options);
  return { server, request, cleanup, appRootPath, activePath };
};

export { createExtensionTestServer, createTestSettings };
