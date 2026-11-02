/**
 * Dependencies
 *
 * Optional packages load on first use, so a disabled feature adds nothing to
 * process memory: the minifiers load when MINIFY=true output is first
 * rendered, and http-server.js imports websocket-server.js (and ws) only when
 * ENABLE_WEBSOCKET=true.
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

// Optional minifiers; Node caches each module after its first import
const loadTerser = () => import('terser');
const loadCleanCSS = () => import('clean-css').then((module) => module.default);

export { fs, fsSync, path, loadTerser, loadCleanCSS };
