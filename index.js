'use strict';

import { main } from './web-app/main.js';

main().catch((error) => {
  console.error('[Startup] The web app failed to start');
  console.error(error);
  process.exit(1);
});
