import { mkdir, readFile, stat, writeFile, readdir, unlink } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import multipart from '@fastify/multipart';
import { bearerToken, equalToken } from '../../src/http.js';
import { AharonSearchEngine } from './webapp/src/engine.js';
import { AIReporter } from './webapp/src/aiReporter.js';
import { WhatsAppLinkedDeviceProvider } from './webapp/src/whatsapp.js';
import { RegistryMysqlProvider } from './webapp/src/providers/registryMysql.js';
import { SerpApiClient } from './webapp/src/providers/serpapi.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, 'webapp', 'public');
const IMAGE_TYPES = new Map([
  ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/webp', '.webp'],
]);
const STATIC = Object.freeze({
  '/search/': ['index.html', 'text/html; charset=utf-8'],
  '/search/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/search/app.js': ['app.js', 'application/javascript; charset=utf-8'],
  '/search/workflow.js': ['workflow.js', 'application/javascript; charset=utf-8'],
  '/search/style.css': ['style.css', 'text/css; charset=utf-8'],
});

function intEnv(key, fallback, min, max) {
  const n = Number(process.env[key] || fallback);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}
function isImage(buffer, mime) {
  if (mime === 'image/jpeg') return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === 'image/webp') return buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
}
function tokenGate(secret) {
  return async (req, reply) => {
    if (!equalToken(bearerToken(req), secret)) return reply.code(401).send({ ok: false, error: 'SEARCH_AUTH_REQUIRED' });
  };
}
function errorResponse(req, reply, code, err, status=500) {
  req.log.warn({ code, message: String(err?.message || err).slice(0, 250) }, 'Search sub-application error');
  return reply.code(status).send({ ok: false, error: code, reason: status === 500 ? 'Search operation failed' : String(err?.message || err).slice(0, 250) });
}

/**
 * Registers Aharon Search on the existing Fastify instance.
 * Never creates another listener; no existing CRM/Workspace/MCP routes are replaced.
 */
export async function registerSearchRoutes(app) {
  if (process.env.SEARCH_ENABLED !== '1') {
    app.log.info('Aharon Search is disabled (SEARCH_ENABLED != 1)');
    return { enabled: false };
  }

  const adminToken = String(process.env.SEARCH_ADMIN_TOKEN || '').trim();
  if (adminToken.length < 32) {
    app.log.warn('Aharon Search disabled: SEARCH_ADMIN_TOKEN must contain at least 32 characters');
    return { enabled: false, reason: 'SEARCH_ADMIN_TOKEN_not_configured' };
  }
  const admin = tokenGate(adminToken);
  const dataDir = process.env.SEARCH_DATA_DIR || join(process.cwd(), 'runtime', 'search');
  const imageDir = join(dataDir, 'temp-images');
  const ttlMs = intEnv('SEARCH_TEMP_IMAGE_TTL_MS', 30 * 60 * 1000, 5 * 60 * 1000, 24 * 60 * 60 * 1000);
  await mkdir(imageDir, { recursive: true, mode: 0o700 });

  // Scoped to this same Fastify process; existing /v1/, /mcp and /oauth routes stay unchanged.
  await app.register(multipart, { limits: { files: 1, fileSize: 8 * 1024 * 1024, fields: 4 } });

  const registry = new RegistryMysqlProvider({
    enabled: process.env.SEARCH_REGISTRY_DB_ENABLED === '1',
    host: process.env.SEARCH_REGISTRY_DB_HOST || '127.0.0.1',
    port: intEnv('SEARCH_REGISTRY_DB_PORT', 3306, 1, 65535),
    user: process.env.SEARCH_REGISTRY_DB_USER || '',
    password: process.env.SEARCH_REGISTRY_DB_PASSWORD || '',
    database: process.env.SEARCH_REGISTRY_DB_NAME || '',
    connectionLimit: intEnv('SEARCH_REGISTRY_DB_POOL_SIZE', 4, 1, 10),
    connectTimeout: intEnv('SEARCH_REGISTRY_DB_CONNECT_TIMEOUT_MS', 10000, 3000, 30000),
  });
  const whatsapp = new WhatsAppLinkedDeviceProvider({
    enabled: process.env.SEARCH_WHATSAPP_ENABLED === '1',
    sessionDir: join(dataDir, 'whatsapp-auth'),
    timeoutMs: intEnv('SEARCH_WHATSAPP_TIMEOUT_MS', 180000, 60000, 300000),
  });
  const serp = new SerpApiClient({
    apiKey: process.env.SEARCH_SERPAPI_KEY || process.env.SERPAPI_KEY || '',
    timeoutMs: intEnv('SEARCH_TIMEOUT_MS', 45000, 10000, 120000),
  });
  const ai = new AIReporter({
    enabled: process.env.SEARCH_AI_REPORT_ENABLED === '1',
    apiKey: process.env.SEARCH_AI_REPORT_API_KEY || process.env.AI_REPORT_API_KEY || process.env.OPENROUTER_API_KEY || '',
    apiUrl: process.env.SEARCH_AI_REPORT_API_URL || 'https://openrouter.ai/api/v1/chat/completions',
    model: process.env.SEARCH_AI_REPORT_MODEL || 'openrouter/free',
    fallbackModel: process.env.SEARCH_AI_REPORT_FALLBACK_MODEL || 'openrouter/free',
    timeoutMs: intEnv('SEARCH_AI_REPORT_TIMEOUT_MS', 45000, 5000, 120000),
  });
  const engine = new AharonSearchEngine({
    serpapiKey: process.env.SEARCH_SERPAPI_KEY || process.env.SERPAPI_KEY || '',
    maxResultsPerSource: intEnv('SEARCH_MAX_RESULTS_PER_SOURCE', 6, 1, 10),
    maxQueriesPerSource: intEnv('SEARCH_MAX_QUERIES_PER_SOURCE', 1, 1, 2),
    expansionRounds: intEnv('SEARCH_MAX_EXPANSION_ROUNDS', 1, 0, 1),
    timeoutMs: intEnv('SEARCH_TIMEOUT_MS', 45000, 10000, 120000),
    whatsappEnabled: process.env.SEARCH_WHATSAPP_ENABLED === '1',
    whatsapp,
    registry,
    osintEnabled: process.env.SEARCH_OSINT_ENABLED !== '0',
  });

  const cleanup = async () => {
    try {
      const cutoff = Date.now() - ttlMs;
      for (const filename of await readdir(imageDir)) {
        if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(filename)) continue;
        const file = join(imageDir, filename);
        try { if ((await stat(file)).mtimeMs < cutoff) await unlink(file); } catch {}
      }
    } catch (err) { app.log.warn({ message: err.message }, 'Search upload cleanup failed'); }
  };
  await cleanup();
  const cleanupTimer = setInterval(() => void cleanup(), Math.min(ttlMs, 10 * 60 * 1000));
  cleanupTimer.unref?.();
  app.addHook('onClose', async () => {
    clearInterval(cleanupTimer);
    // WhatsAppLinkedDeviceProvider opens and closes sockets within each operation; it has no shutdown() method.
    await registry.close();
  });

  app.get('/search', async (_req, reply) => reply.code(302).header('location', '/search/').send());
  for (const [route, [file, type]] of Object.entries(STATIC)) {
    app.get(route, async (_req, reply) => {
      const html = await readFile(join(PUBLIC_DIR, file), 'utf8');
      return reply.type(type).header('cache-control', file === 'index.html' ? 'no-store' : 'public, max-age=60').header('x-content-type-options', 'nosniff').send(html);
    });
  }
  app.get('/search/api/client-config', async () => ({
    auth_required: true,
    registry_enabled: registry.status().configured,
    registry_integrated: true,
    version: 'search-in-hub/1.0',
  }));

  app.get('/search/api/health', { preHandler: admin }, async () => ({
    ok: true, app: 'Aharon Search (Aharon Node Hub)',
    registry: await registry.health(),
    whatsapp: whatsapp.status(),
    search_provider: await serp.account(),
    ai_report: ai.status(),
  }));
  app.post('/search/api/search', { preHandler: admin }, async (req, reply) => {
    try {
      const result = await engine.search(req.body || {});
      if (process.env.SEARCH_AI_REPORT_ENABLED === '1') {
        try {
          result.ai_report = await ai.summarize({
            record: result.input || {},
            ranked: {
              score: result.score || 0,
              results: result.results || [],
              linked_accounts: result.linked_accounts || [],
              conflicts: result.conflicts || [],
            },
            sourceStatus: result.source_status || {},
            verification: result.verification || {},
          });
        } catch (err) {
          result.ai_report = { status: 'error', reason: String(err?.message || err).slice(0, 200) };
        }
      } else result.ai_report = { status: 'disabled', reason: 'SEARCH_AI_REPORT_ENABLED=0' };
      return { ok: true, ...result };
    } catch (err) { return errorResponse(req, reply, 'SEARCH_FAILED', err, 400); }
  });

  app.post('/search/api/registry/search', { preHandler: admin }, async (req, reply) => {
    if (!registry.status().configured) return reply.code(503).send({ ok: false, error: 'SEARCH_REGISTRY_NOT_CONFIGURED' });
    try { return { ok: true, ...await registry.search(req.body || {}) }; }
    catch (err) { return errorResponse(req, reply, 'SEARCH_REGISTRY_FAILED', err, 400); }
  });

  app.post('/search/api/image-upload', { preHandler: admin }, async (req, reply) => {
    try {
      const part = await req.file();
      if (!part) return reply.code(400).send({ ok: false, error: 'IMAGE_REQUIRED' });
      const mime = String(part.mimetype || '').toLowerCase();
      const extension = IMAGE_TYPES.get(mime);
      if (!extension) return reply.code(415).send({ ok: false, error: 'UNSUPPORTED_IMAGE_TYPE' });
      const buffer = await part.toBuffer();
      if (!isImage(buffer, mime)) return reply.code(415).send({ ok: false, error: 'INVALID_IMAGE_CONTENT' });
      const filename = randomUUID() + extension;
      await writeFile(join(imageDir, filename), buffer, { flag: 'wx', mode: 0o600 });
      const base = String(process.env.SEARCH_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || ('https://' + req.hostname)).replace(/\/+$/, '');
      return { ok: true, image_url: base + '/search/uploads/' + filename, expires_in_ms: ttlMs };
    } catch (err) { return errorResponse(req, reply, 'SEARCH_IMAGE_UPLOAD_FAILED', err, 400); }
  });
  app.get('/search/uploads/:file', async (req, reply) => {
    const filename = String(req.params?.file || '');
    if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(filename)) return reply.code(404).send('Not found');
    const file = join(imageDir, filename);
    try {
      if (Date.now() - (await stat(file)).mtimeMs > ttlMs) return reply.code(404).send('Expired');
      const type = extname(file) === '.png' ? 'image/png' : (extname(file) === '.webp' ? 'image/webp' : 'image/jpeg');
      return reply.type(type).header('cache-control', 'private, max-age=300').send(await readFile(file));
    } catch { return reply.code(404).send('Not found'); }
  });

  app.get('/search/api/whatsapp/status', { preHandler: admin }, async () => ({ ok: true, status: whatsapp.status() }));
  app.post('/search/api/whatsapp/connect/start', { preHandler: admin }, async (req) => whatsapp.startConnect(req.body || {}));
  app.get('/search/api/whatsapp/connect/status', { preHandler: admin }, async () => whatsapp.connectStatus());
  app.post('/search/api/whatsapp/logout', { preHandler: admin }, async () => whatsapp.logout());

  app.log.info({ prefix: '/search', registry: registry.status().configured }, 'Aharon Search routes registered on existing Hub server');
  return { enabled: true };
}