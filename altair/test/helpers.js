import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

export { createTestSettings };
