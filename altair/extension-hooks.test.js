import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import WebServer from './altair.js';
import { createTestSettings } from './test/helpers.js';

// Applications may override hooks with method syntax or class-field syntax.
// Both must replace the framework default and both must be able to call super.

class MethodStyleApp extends WebServer {

  renderCalls = 0;

  additionalRoutes() {
    this.app.get('/api/ping', (context) => context.json({ style: 'method' }));
  }

  additionalVarDefinitions() {
    return { theme: 'method' };
  }

  async renderHTML(p, context, options) {
    this.renderCalls++;
    return super.renderHTML(p, context, options);
  }

  async applyGlobalReplacements(options) {
    const content = await super.applyGlobalReplacements(options);
    return options.type === 'html' ? `${content}<!--method-->` : content;
  }

} // MethodStyleApp

class FieldStyleApp extends WebServer {

  renderCalls = 0;

  additionalRoutes = () => {
    this.app.get('/api/ping', (context) => context.json({ style: 'field' }));
  };

  additionalVarDefinitions = () => {
    return { theme: 'field' };
  };

  renderHTML = async (p, context, options) => {
    this.renderCalls++;
    return super.renderHTML(p, context, options);
  };

  applyGlobalReplacements = async (options) => {
    const content = await super.applyGlobalReplacements(options);
    return options.type === 'html' ? `${content}<!--field-->` : content;
  };

} // FieldStyleApp

const createFixture = async (AppClass) => {
  const appRootPath = await mkdtemp(path.join(os.tmpdir(), 'altair-extension-hooks-'));
  const activeSpace = 'kinetic';
  const activePath = path.join(appRootPath, activeSpace);
  await mkdir(path.join(activePath, 'pages'), { recursive: true });
  await writeFile(path.join(activePath, 'pages', 'home.html'), '<p>@@VAR_theme</p>');

  const server = new AppClass({ settings: createTestSettings({
    appRootPath,
    activeSpace,
    pagesLocation: 'pages',
    publicLocation: 'public',
    enableRouteCache: false,
    debug: false,
    minify: false
  }) });
  server.dataFilePath = path.join(activePath, 'DATA.json');
  server.routes();
  return { server, appRootPath };
};

for (const [style, AppClass] of [['method', MethodStyleApp], ['field', FieldStyleApp]]) {
  test(`${style}-syntax overrides replace framework hooks and can call super`, async () => {
    const { server, appRootPath } = await createFixture(AppClass);
    try {
      const api = await server.app.request('http://altair.test/api/ping');
      assert.equal(api.status, 200);
      assert.deepEqual(await api.json(), { style });

      const page = await server.app.request('http://altair.test/');
      assert.equal(page.status, 200);
      assert.equal(await page.text(), `<p>${style}</p><!--${style}-->`);
      assert.equal(server.renderCalls, 1);
    } finally {
      await rm(appRootPath, { recursive: true, force: true });
    }
  });
}
