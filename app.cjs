'use strict';

// Hostinger LiteSpeed loads its startup file via require().
// A CommonJS entrypoint must import our ESM server asynchronously.
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

console.info('[aharon-node-hub] HOSTINGER_CJS_BOOTSTRAP_LOADED');
const entrypoint = pathToFileURL(join(__dirname, 'src', 'server-unified.js')).href;
void import(entrypoint).catch((error) => {
  console.error('[aharon-node-hub] Unified server failed to start:', error);
  process.exitCode = 1;
});
