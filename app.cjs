'use strict';

// LiteSpeed/lsnode loads the configured startup file using require().
// Import the existing async ESM entrypoint without requiring its top-level await graph.
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const entrypoint = pathToFileURL(join(__dirname, 'src', 'server-unified.js')).href;

void import(entrypoint).catch((error) => {
  console.error('[aharon-node-hub] Unified server failed to start:', error);
  process.exitCode = 1;
});
