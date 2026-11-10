// @ts-check
/**
 * Builds the active space's Tailwind stylesheet once (pnpm css:build), or
 * confirms that the generated file matches its sources (pnpm css:check).
 * Does nothing when the Tailwind extension is not configured.
 */

import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadSettings } from '../../altair/settings.js';
import { cliArguments, cliEnvironment, findCli, tailwindPaths } from './tailwind.js';

/**
 * runCli : run one Tailwind build and stop the process if it fails
 * @param {string} cli
 * @param {{ entry: string, output: string }} paths
 * @param {string} cwd
 */
const runCli = (cli, paths, cwd) => {

  const { status } = spawnSync(process.execPath, [cli, ...cliArguments(paths)], {
    cwd,
    env: cliEnvironment(),
    stdio: ['ignore', 'inherit', 'inherit']
  });
  if (status !== 0) process.exit(status ?? 1);

} // runCli

/**
 * readIfPresent : a file's contents, or null when it does not exist
 * @param {string} file
 */
const readIfPresent = (file) => readFile(file).catch((error) => {
  if (error.code === 'ENOENT') return null;
  throw error;
});

const main = async () => {

  const settings = loadSettings();
  if (settings.extensions?.tailwind === undefined) {
    console.log('The Tailwind extension is not configured; nothing to build.');
    return;
  }
  const cli = await findCli(settings.appRootPath);
  if (!cli) throw new Error('The Tailwind CLI is not installed; run pnpm install with development dependencies');

  const { entry, output } = tailwindPaths(settings);
  if (!process.argv.includes('--check')) {
    runCli(cli, { entry, output }, settings.appRootPath);
    return;
  }

  const directory = await mkdtemp(path.join(os.tmpdir(), 'altair-tailwind-'));
  try {
    const rebuilt = path.join(directory, 'tailwind.css');
    runCli(cli, { entry, output: rebuilt }, settings.appRootPath);
    const generated = await readIfPresent(output);
    if (!generated || !generated.equals(await readFile(rebuilt))) {
      console.error(`${output} is out of date; run pnpm css:build and commit the result`);
      process.exitCode = 1;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

} // main

await main();
