/**
 * Dependencies
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import config from 'config';
import { minify } from 'terser';
import CleanCSS from 'clean-css';
import { WebSocketServer } from 'ws';

export { fs, fsSync, path, fileURLToPath, dotenv, config, minify, CleanCSS, WebSocketServer };
