export class SearchProviderError extends Error {
  constructor(message, { code = 'SEARCH_PROVIDER_ERROR', status = 0 } = {}) {
    super(message);
    this.name = 'SearchProviderError';
    this.code = code;
    this.status = status;
  }
}

function classifyError(status, message = '') {
  const text = String(message || '').toLowerCase();
  if (status === 429 || /limit|quota|searches.*left|throughput|rate/.test(text)) return 'SERPAPI_QUOTA_OR_RATE_LIMIT';
  if (status === 401 || status === 403 || /invalid api key|api key/.test(text)) return 'SERPAPI_AUTH_ERROR';
  if (status >= 500) return 'SERPAPI_UPSTREAM_ERROR';
  return 'SERPAPI_REQUEST_FAILED';
}

export class SerpApiClient {
  constructor({ apiKey = '', timeoutMs = 60000 } = {}) {
    this.apiKey = String(apiKey || '').trim();
    this.timeoutMs = Math.max(5000, Math.min(120000, Number(timeoutMs || 60000)));
  }

  isConfigured() { return Boolean(this.apiKey && !this.apiKey.toLowerCase().includes('your-')); }

  async account() {
    if (!this.isConfigured()) return { status: 'disabled', configured: false, reason: 'SERPAPI_KEY is not configured' };
    const params = new URLSearchParams({ api_key: this.apiKey });
    try {
      const response = await fetch('https://serpapi.com/account.json?' + params.toString(), { headers: { accept: 'application/json', 'user-agent': 'Aharon-Search-Web/6.0' }, signal: AbortSignal.timeout(Math.min(this.timeoutMs, 15000)) });
      const raw = await response.text(); let body = null; try { body = JSON.parse(raw); } catch (_) {}
      if (!response.ok || body?.error) {
        const message = body?.error || body?.message || `HTTP ${response.status}`;
        throw new SearchProviderError(message, { code: classifyError(response.status, message), status: response.status });
      }
      return {
        status: 'ok', configured: true,
        plan_name: body.plan_name || '',
        searches_per_month: Number(body.searches_per_month || 0),
        searches_left: Number(body.total_searches_left ?? body.plan_searches_left ?? 0),
        this_month_usage: Number(body.this_month_usage || 0),
        this_hour_searches: Number(body.this_hour_searches || 0),
        hourly_limit: Number(body.account_rate_limit_per_hour || 0),
        renewal_date: body.plan_renewal_date || null,
      };
    } catch (error) {
      if (error instanceof SearchProviderError) return { status: 'error', configured: true, code: error.code, http_status: error.status, reason: String(error.message || error).slice(0, 500) };
      return { status: 'error', configured: true, code: 'SERPAPI_ACCOUNT_CHECK_FAILED', reason: String(error?.message || error).slice(0, 500) };
    }
  }

  accountUsable(account) {
    if (!account || account.status !== 'ok') return { usable: account?.code !== 'SERPAPI_AUTH_ERROR', reason: account?.reason || '' };
    if (account.searches_per_month > 0 && account.searches_left <= 0) return { usable: false, code: 'SERPAPI_MONTHLY_QUOTA_EXHAUSTED', reason: 'SerpAPI monthly search quota is exhausted' };
    if (account.hourly_limit > 0 && account.this_hour_searches >= account.hourly_limit) return { usable: false, code: 'SERPAPI_HOURLY_LIMIT_REACHED', reason: 'SerpAPI hourly throughput limit is reached' };
    return { usable: true };
  }

  async google(query, limit = 6) {
    if (!this.isConfigured()) throw new SearchProviderError('SERPAPI_KEY is not configured', { code: 'SERPAPI_NOT_CONFIGURED' });
    const params = new URLSearchParams({ engine: 'google', q: query, num: String(Math.max(1, Math.min(10, Number(limit || 6)))), hl: 'he', gl: 'il', safe: 'active', api_key: this.apiKey });
    const response = await fetch('https://serpapi.com/search.json?' + params.toString(), { headers: { accept: 'application/json', 'user-agent': 'Aharon-Search-Web/6.0' }, signal: AbortSignal.timeout(this.timeoutMs) });
    const text = await response.text(); let payload;
    try { payload = JSON.parse(text); } catch (_) { throw new SearchProviderError('Search provider returned invalid JSON', { code: 'SERPAPI_INVALID_JSON', status: response.status }); }
    if (!response.ok || payload.error) {
      const message = payload.error || `HTTP ${response.status}`;
      throw new SearchProviderError(message, { code: classifyError(response.status, message), status: response.status });
    }
    return payload;
  }

  async lens(imageUrl) {
    if (!this.isConfigured()) throw new SearchProviderError('SERPAPI_KEY is not configured', { code: 'SERPAPI_NOT_CONFIGURED' });
    const params = new URLSearchParams({ engine: 'google_lens', url: imageUrl, hl: 'he', country: 'il', safe: 'active', api_key: this.apiKey });
    const response = await fetch('https://serpapi.com/search.json?' + params.toString(), { headers: { accept: 'application/json', 'user-agent': 'Aharon-Search-Web/6.0' }, signal: AbortSignal.timeout(this.timeoutMs) });
    const raw = await response.text(); let payload = null; try { payload = JSON.parse(raw); } catch (_) {}
    if (!response.ok || payload?.error) {
      const message = payload?.error || `HTTP ${response.status}`;
      throw new SearchProviderError(message, { code: classifyError(response.status, message), status: response.status });
    }
    return payload;
  }
}