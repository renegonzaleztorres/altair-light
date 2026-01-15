/**
 * Constants
 */

import { path, fileURLToPath, dotenv, config } from './dependencies.js'

dotenv.config(); 
const __fileName = fileURLToPath(import.meta.url);
const __dirName = path.dirname(__fileName);
const __appRootPath = path.dirname(__dirName);
const __version = config.get('version');
const __localPort = config.get('localPort');
const __NODE_ENV = process.env.NODE_ENV;
const __APP_NAME = process.env.APP_NAME;
const __ACTIVE_SPACE = process.env.ACTIVE_SPACE;
const __PUBLIC_LOCATION = process.env.PUBLIC_LOCATION;
const __PAGES_LOCATION = process.env.PAGES_LOCATION;
const __DATA_LOCATION = process.env.DATA_LOCATION || '';
const __DATA_FILE = process.env.DATA_FILE || '';
const __ENABLE_DATA_WATCH = process.env.ENABLE_DATA_WATCH !== 'false';
const __MINIFY = process.env.MINIFY === 'true';
const __DEBUG = process.env.DEBUG === 'true';

export { __dirName, __appRootPath, __version, __localPort, __NODE_ENV, __APP_NAME, __ACTIVE_SPACE, __PUBLIC_LOCATION, __PAGES_LOCATION, __DATA_LOCATION, __DATA_FILE, __ENABLE_DATA_WATCH, __MINIFY, __DEBUG };