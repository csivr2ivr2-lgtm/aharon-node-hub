'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

test('Hostinger main and default start both use the CJS bootstrap', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.main, 'app.cjs');
  assert.equal(pkg.scripts.start, 'node app.cjs');
  assert.equal(pkg.scripts['start:unified'], 'node app.cjs');
});

test('LiteSpeed-style require boots an async top-level-await ESM entrypoint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aharon-hostinger-start-'));
  try {
    mkdirSync(join(dir, 'src'));
    copyFileSync(resolve(__dirname, '../app.cjs'), join(dir, 'app.cjs'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(join(dir, 'src', 'server-unified.js'),
      "await Promise.resolve(); console.log('MOCK_ASYNC_ESM_STARTED');\n");
    const run = spawnSync(process.execPath, ['-e', "require('./app.cjs')"], {
      cwd: dir, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /HOSTINGER_CJS_BOOTSTRAP_LOADED/);
    assert.match(run.stdout, /MOCK_ASYNC_ESM_STARTED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
