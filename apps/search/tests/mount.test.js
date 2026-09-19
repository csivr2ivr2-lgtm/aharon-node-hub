import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const read = async (path) => readFile(new URL(path, root), 'utf8');

test('unified entrypoint preserves existing hub code unchanged', async () => {
  const original = await read('src/server.js');
  const unified = await read('src/server-unified.js');
  const registrationImport = 'import {registerSearchRoutes} from "../apps/search/routes.js";\n';
  const registrationCall = 'await registerSearchRoutes(app);\n';
  assert.equal(unified.replace(registrationImport, '').replace(registrationCall, ''), original);
  assert.equal((unified.match(/app\.listen\(/g) || []).length, 1);
});

test('search module registers only namespaced routes and does not create a second listener', async () => {
  const routes = await read('apps/search/routes.js');
  assert.match(routes, /app\.get\('\/search\/api\/client-config'/);
  assert.match(routes, /app\.post\('\/search\/api\/search'/);
  assert.doesNotMatch(routes, /app\.listen\(/);
  assert.doesNotMatch(routes, /app\.(get|post|all)\('\/(?:v1|mcp|health)(?:\/|')/);
});

test('search assets and browser API calls are namespaced', async () => {
  const html = await read('apps/search/webapp/public/index.html');
  const app = await read('apps/search/webapp/public/app.js');
  const workflow = await read('apps/search/webapp/public/workflow.js');
  for (const asset of ['/search/app.js', '/search/workflow.js', '/search/style.css']) assert.ok(html.includes(asset));
  assert.ok(app.includes("api('/search/api/search'"));
  assert.ok(workflow.includes("'/search/api/search'"));
  assert.doesNotMatch(html, /(?:src|href)="\/(?:app\.js|workflow\.js|style\.css)"/);
});

test('separate secrets and opt-in search registration are required', async () => {
  const routes = await read('apps/search/routes.js');
  assert.match(routes, /SEARCH_ENABLED !== '1'/);
  assert.match(routes, /SEARCH_ADMIN_TOKEN/);
  assert.match(routes, /adminToken\.length < 32/);
  assert.doesNotMatch(routes, /CORE_API_TOKEN/);
  assert.doesNotMatch(routes, /CRM_TOKEN/);
});
