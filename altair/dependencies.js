/**
 * Dependencies
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { minify } from 'terser';
import CleanCSS from 'clean-css';
import { WebSocketServer } from 'ws';

export { fs, fsSync, path, minify, CleanCSS, WebSocketServer };
