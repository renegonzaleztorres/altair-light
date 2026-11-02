/**
 * Reports which optional packages Altair imports for one configuration.
 *
 * Usage: node optional-dependencies-fixture.js <minify> <websocket> <port>
 * Starts a WebServer, requests a page, a stylesheet, and a script, shuts down,
 * and prints the imported optional package names as one JSON line.
 */

import { registerHooks } from 'node:module';

const OPTIONAL_PACKAGES = new Set(['terser', 'clean-css', 'ws']);
const imported = new Set();

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (OPTIONAL_PACKAGES.has(specifier)) imported.add(specifier);
    return nextResolve(specifier, context);
  }
});

// Dynamic imports so the hook is registered before Altair's module graph loads
const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises');
const { default: os } = await import('node:os');
const { default: path } = await import('node:path');
const { default: WebServer } = await import('../../altair.js');
const { createTestSettings } = await import('../helpers.js');

const [minify, websocket, port] = process.argv.slice(2);
const appRootPath = await mkdtemp(path.join(os.tmpdir(), 'altair-optional-deps-'));
const activePath = path.join(appRootPath, 'space');
for (const directory of ['pages', 'css', 'js', 'public']) {
  await mkdir(path.join(activePath, directory), { recursive: true });
}
await writeFile(path.join(activePath, 'pages', 'home.html'), '<h1>Home</h1>');
await writeFile(path.join(activePath, 'css', 'site.css'), 'body {\n  color: red;\n}\n');
await writeFile(path.join(activePath, 'js', 'site.js'), 'globalThis.site = true;\n');

const server = new WebServer({ settings: createTestSettings({
  appRootPath,
  activeSpace: 'space',
  pagesLocation: 'pages',
  publicLocation: 'public',
  enableDataWatch: false,
  minify: minify === 'true',
  enableWebSocket: websocket === 'true',
  webSocketAllowedOrigins: 'same-origin',
  debug: false,
  host: '127.0.0.1',
  port: Number(port)
}) });

try {
  await server.start();
  for (const pathname of ['/', '/css/site.css', '/js/site.js']) {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
    await response.text();
    if (response.status !== 200) throw new Error(`${pathname} returned ${response.status}`);
  }
} finally {
  await server.shutdown();
  await rm(appRootPath, { recursive: true, force: true });
}

console.log(JSON.stringify([...imported].sort()));
