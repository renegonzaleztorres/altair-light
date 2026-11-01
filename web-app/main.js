/**
 * Main
 */

import WebApp from './web-app.js';

export const main = async () => {

    // Start web app
    const wa = new WebApp();
    await wa.start();

    return wa;

}; // main
