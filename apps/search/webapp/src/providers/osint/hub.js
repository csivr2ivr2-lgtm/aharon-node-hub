import { SocialAnalyzerProvider } from './socialAnalyzer.js';
import { PhoneInfogaProvider } from './phoneInfoga.js';
import { RedditPublicProvider } from './redditPublic.js';
import { GitHubDirectProvider } from './githubDirect.js';
import { YouTubeDirectProvider } from './youtubeDirect.js';
import { XDirectProvider } from './xDirect.js';
import { InstagramBusinessProvider } from './instagramBusiness.js';
import { TikTokWorkerProvider } from './tiktokWorker.js';

function dedupeResults(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${String(row.source || '')}|${String(row.url || '')}|${String(row.username || '')}|${String(row.phone || '')}`.toLowerCase();
    if (!key.replace(/\|/g, '') || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function mergeSourceStatus(current, next) {
  if (!current) return next;
  const priority = { ok: 6, partial: 5, error: 4, skipped: 3, disabled: 2, pending: 1 };
  const preferred = (priority[next.status] || 0) >= (priority[current.status] || 0) ? next : current;
  return {
    ...preferred,
    count: Number(current.count || 0) + Number(next.count || 0),
    providers: [...new Set([...(current.providers || []), ...(next.providers || [])])],
  };
}

export class OsintHub {
  constructor({ enabled = true, timeoutMs = 45000 } = {}) {
    this.enabled = Boolean(enabled);
    this.providers = [
      new GitHubDirectProvider({ enabled: this.enabled && process.env.GITHUB_DIRECT_ENABLED !== '0', token: process.env.GITHUB_PUBLIC_TOKEN || '', timeoutMs: Number(process.env.GITHUB_DIRECT_TIMEOUT_MS || 12000), maxCandidates: Number(process.env.GITHUB_MAX_CANDIDATES || 4) }),
      new RedditPublicProvider({ enabled: this.enabled && process.env.REDDIT_PUBLIC_ENABLED !== '0', timeoutMs: Number(process.env.REDDIT_PUBLIC_TIMEOUT_MS || 12000), clientId: process.env.REDDIT_CLIENT_ID || '', clientSecret: process.env.REDDIT_CLIENT_SECRET || '', userAgent: process.env.REDDIT_USER_AGENT || 'AharonSearch/6.0 profile-correlation' }),
      new YouTubeDirectProvider({ enabled: this.enabled && process.env.YOUTUBE_DIRECT_ENABLED !== '0', apiKey: process.env.YOUTUBE_API_KEY || '', timeoutMs: Number(process.env.YOUTUBE_DIRECT_TIMEOUT_MS || 12000), searchByName: process.env.YOUTUBE_SEARCH_BY_NAME !== '0' }),
      new XDirectProvider({ enabled: this.enabled && process.env.X_DIRECT_ENABLED !== '0', bearerToken: process.env.X_BEARER_TOKEN || '', timeoutMs: Number(process.env.X_DIRECT_TIMEOUT_MS || 12000) }),
      new InstagramBusinessProvider({ enabled: this.enabled && process.env.INSTAGRAM_DIRECT_ENABLED !== '0', accessToken: process.env.META_ACCESS_TOKEN || '', igUserId: process.env.META_IG_USER_ID || '', graphVersion: process.env.META_GRAPH_VERSION || 'v26.0', timeoutMs: Number(process.env.INSTAGRAM_DIRECT_TIMEOUT_MS || 12000) }),
      new TikTokWorkerProvider({ enabled: this.enabled && process.env.TIKTOK_WORKER_ENABLED === '1', baseUrl: process.env.TIKTOK_WORKER_URL || '', timeoutMs: Number(process.env.TIKTOK_WORKER_TIMEOUT_MS || 20000) }),
      new SocialAnalyzerProvider({ enabled: this.enabled && process.env.SOCIAL_ANALYZER_ENABLED === '1', command: process.env.SOCIAL_ANALYZER_COMMAND || 'social-analyzer', timeoutMs: Number(process.env.SOCIAL_ANALYZER_TIMEOUT_MS || timeoutMs), top: Number(process.env.SOCIAL_ANALYZER_TOP || 100) }),
      new PhoneInfogaProvider({ enabled: this.enabled && process.env.PHONEINFOGA_ENABLED === '1', baseUrl: process.env.PHONEINFOGA_BASE_URL || '', timeoutMs: Number(process.env.PHONEINFOGA_TIMEOUT_MS || 15000) }),
    ];
  }

  status() {
    return { enabled: this.enabled, providers: Object.fromEntries(this.providers.map((p) => [p.constructor.name, p.status()])) };
  }

  async lookup(record) {
    if (!this.enabled) return { status: 'disabled', results: [], providers: {}, sources: {} };
    const settled = await Promise.all(this.providers.map(async (provider) => {
      try { return await provider.lookup(record); }
      catch (error) { return { status: 'error', provider: provider.constructor.name, source: provider.source || '', reason: String(error?.message || error), results: [] }; }
    }));
    const providers = Object.fromEntries(settled.map((item) => [item.provider || 'unknown', { status: item.status, count: Number(item.count || item.results?.length || 0), reason: item.reason || '', code: item.code || '' }]));
    const results = dedupeResults(settled.flatMap((item) => Array.isArray(item.results) ? item.results : []));
    const sources = {};
    for (const item of settled) {
      if (item.source) {
        sources[item.source] = mergeSourceStatus(sources[item.source], { status: item.status, count: Number(item.count || item.results?.length || 0), reason: item.reason || '', code: item.code || '', providers: [item.provider || 'unknown'] });
      }
    }
    for (const row of results) {
      if (!row.source) continue;
      const current = sources[row.source] || {};
      sources[row.source] = {
        ...current,
        status: 'ok',
        count: Math.max(1, Number(current.count || 0)),
        reason: '',
        code: '',
        providers: [...new Set([...(current.providers || []), 'result'])],
      };
    }
    sources.facebook ||= { status: 'disabled', count: 0, reason: 'Meta Graph API does not provide arbitrary public-person profile search; use username probe/Social Analyzer only when explicitly enabled.', providers: [] };
    sources.linkedin ||= { status: 'disabled', count: 0, reason: 'LinkedIn Profile API access is restricted and does not support general public-person enrichment.', providers: [] };
    const ok = settled.some((item) => item.status === 'ok');
    return { status: ok ? 'ok' : (settled.some((item) => item.status === 'error') ? 'partial' : 'skipped'), providers, sources, count: results.length, results };
  }
}