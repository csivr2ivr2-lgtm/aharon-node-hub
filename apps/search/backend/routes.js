import { join } from 'node:path';
import { bearerToken, equalToken } from '../../../src/http.js';
import { AharonSearchEngine } from '../webapp/src/engine.js';
import { AIReporter } from '../webapp/src/aiReporter.js';
import { WhatsAppLinkedDeviceProvider } from '../webapp/src/whatsapp.js';
import { RegistryMysqlProvider } from '../webapp/src/providers/registryMysql.js';
import { SearchJobQueue } from './jobs.js';

function numeric(name, fallback, lower, upper) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? Math.min(upper, Math.max(lower, Math.floor(value))) : fallback;
}
function failure(reply, status, code) {
  return reply.code(status).send({ ok: false, error: code });
}
export function validateSearchInput(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const allowed = [
    'name', 'first_name', 'last_name', 'alias', 'nickname', 'business_name',
    'phone', 'username', 'user', 'text', 'query', 'image_url', 'imageUrl', 'image',
    'id', 'registry_id', 'father_id', 'mother_id', 'city_name', 'city', 'street',
    'country_name', 'country', 'birth_year', 'birth_date',
  ];
  const payload = {};
  for (const name of allowed) {
    if (data[name] == null) continue;
    if (typeof data[name] !== 'string' && typeof data[name] !== 'number') return null;
    const value = String(data[name]).trim();
    if (value.length > 500) return null;
    if (value) payload[name] = value;
  }
  return Object.keys(payload).length ? payload : null;
}

/**
 * Private server-to-server API, not another UI. The existing Aharon-Search
 * web app stays on search.aharon.cloud and the CRM stays on crm.ivrphone.org.
 */
export async function registerSearchBackendRoutes(app) {
  if (process.env.SEARCH_ENABLED !== '1') {
    app.log.info('Search backend disabled: SEARCH_ENABLED is not 1');
    return { enabled: false };
  }

  const token = String(process.env.SEARCH_WORKER_TOKEN || '').trim();
  if (token.length < 32 || /^(change|your_|example)/i.test(token)) {
    app.log.warn('Search backend disabled: SEARCH_WORKER_TOKEN must have 32+ chars');
    return { enabled: false, reason: 'SEARCH_WORKER_TOKEN_REQUIRED' };
  }
  const auth = async (req, reply) => {
    if (!equalToken(bearerToken(req), token)) return failure(reply, 401, 'UNAUTHORIZED');
  };
  const whatsapp = new WhatsAppLinkedDeviceProvider({
    enabled: process.env.SEARCH_WHATSAPP_ENABLED === '1',
    sessionDir: join(process.env.SEARCH_DATA_DIR || './runtime/search', 'whatsapp-auth'),
    timeoutMs: numeric('SEARCH_WHATSAPP_TIMEOUT_MS', 180000, 60000, 300000),
  });
  const registry = new RegistryMysqlProvider({
    enabled: process.env.SEARCH_REGISTRY_DB_ENABLED === '1',
    host: process.env.SEARCH_REGISTRY_DB_HOST || '127.0.0.1',
    port: numeric('SEARCH_REGISTRY_DB_PORT', 3306, 1, 65535),
    user: process.env.SEARCH_REGISTRY_DB_USER || '',
    password: process.env.SEARCH_REGISTRY_DB_PASSWORD || '',
    database: process.env.SEARCH_REGISTRY_DB_NAME || '',
    connectionLimit: numeric('SEARCH_REGISTRY_DB_POOL_SIZE', 4, 1, 10),
    connectTimeout: numeric('SEARCH_REGISTRY_DB_CONNECT_TIMEOUT_MS', 10000, 3000, 30000),
  });
  const engine = new AharonSearchEngine({
    serpapiKey: process.env.SEARCH_SERPAPI_KEY || process.env.SERPAPI_KEY || '',
    maxResultsPerSource: numeric('SEARCH_MAX_RESULTS_PER_SOURCE', 6, 1, 10),
    maxQueriesPerSource: numeric('SEARCH_MAX_QUERIES_PER_SOURCE', 1, 1, 2),
    expansionRounds: numeric('SEARCH_MAX_EXPANSION_ROUNDS', 1, 0, 1),
    timeoutMs: numeric('SEARCH_TIMEOUT_MS', 45000, 10000, 120000),
    whatsappEnabled: process.env.SEARCH_WHATSAPP_ENABLED === '1',
    whatsapp,
    registry,
    osintEnabled: process.env.SEARCH_OSINT_ENABLED !== '0',
  });
  const reporter = new AIReporter({
    enabled: process.env.SEARCH_AI_REPORT_ENABLED === '1',
    apiKey: process.env.SEARCH_AI_REPORT_API_KEY || process.env.AI_REPORT_API_KEY || process.env.OPENROUTER_API_KEY || '',
    apiUrl: process.env.SEARCH_AI_REPORT_API_URL || 'https://openrouter.ai/api/v1/chat/completions',
    model: process.env.SEARCH_AI_REPORT_MODEL || 'openrouter/free',
    fallbackModel: process.env.SEARCH_AI_REPORT_FALLBACK_MODEL || 'openrouter/free',
    timeoutMs: numeric('SEARCH_AI_REPORT_TIMEOUT_MS', 45000, 5000, 120000),
  });

  const queue = new SearchJobQueue({
    maxPending: numeric('SEARCH_WORKER_MAX_JOBS', 12, 1, 30),
    ttlMs: numeric('SEARCH_WORKER_RESULT_TTL_MS', 900000, 60000, 3600000),
    run: async (input) => {
      const result = await engine.search(input);
      if (process.env.SEARCH_AI_REPORT_ENABLED === '1') {
        try {
          result.ai_report = await reporter.summarize({
            record: result.input || input,
            ranked: {
              score: result.score || 0,
              results: result.results || [],
              linked_accounts: result.linked_accounts || [],
              conflicts: result.conflicts || [],
            },
            sourceStatus: result.source_status || {},
            verification: result.verification || {},
          });
        } catch {
          result.ai_report = { status: 'error', reason: 'AI_REPORT_UNAVAILABLE' };
        }
      } else {
        result.ai_report = { status: 'disabled' };
      }
      return { ok: true, ...result };
    },
  });

  app.get('/v1/search-backend/status', { preHandler: auth }, async () => ({
    ok: true,
    service: 'aharon-search-background',
    mode: 'api_only',
    queue: { running: queue.active, waiting: queue.pending.length },
    registry: registry.status(),
    whatsapp: whatsapp.status(),
  }));
  app.post('/v1/search-backend/jobs', { preHandler: auth }, async (req, reply) => {
    const input = validateSearchInput(req.body);
    if (!input) return failure(reply, 422, 'INVALID_SEARCH_INPUT');
    const job = queue.submit(input);
    if (!job) return failure(reply, 429, 'SEARCH_QUEUE_FULL');
    return reply.code(202).header('cache-control', 'no-store').send({
      ok: true,
      id: job.id,
      status: job.status,
      status_path: '/v1/search-backend/jobs/' + job.id,
    });
  });
  app.get('/v1/search-backend/jobs/:id', { preHandler: auth }, async (req, reply) => {
    const id = String(req.params?.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return failure(reply, 404, 'JOB_NOT_FOUND');
    const job = queue.get(id);
    if (!job) return failure(reply, 404, 'JOB_NOT_FOUND');
    return reply.header('cache-control', 'no-store').send({ ok: true, ...job });
  });

  // Optional, authenticated auxiliary providers for the site's own API proxy.
  app.post('/v1/search-backend/registry/search', { preHandler: auth }, async (req, reply) => {
    if (!registry.status().configured) return failure(reply, 503, 'REGISTRY_UNAVAILABLE');
    try {
      return reply.header('cache-control', 'no-store').send({ ok: true, ...await registry.search(req.body || {}) });
    } catch {
      return failure(reply, 422, 'REGISTRY_SEARCH_FAILED');
    }
  });
  app.get('/v1/search-backend/whatsapp/status', { preHandler: auth }, async () => ({ ok: true, status: whatsapp.status() }));
  app.post('/v1/search-backend/whatsapp/connect/start', { preHandler: auth }, async (req) => whatsapp.startConnect(req.body || {}));
  app.get('/v1/search-backend/whatsapp/connect/status', { preHandler: auth }, async () => whatsapp.connectStatus());
  app.post('/v1/search-backend/whatsapp/logout', { preHandler: auth }, async () => whatsapp.logout());

  app.addHook('onClose', async () => {
    queue.close();
    await registry.close();
  });
  app.log.info('Search backend API enabled; no search UI served by Hub');
  return { enabled: true };
}
