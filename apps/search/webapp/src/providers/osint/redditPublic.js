function clean(value, limit = 900) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit); }

export class RedditPublicProvider {
  constructor({ enabled = true, timeoutMs = 12000, clientId = '', clientSecret = '', userAgent = 'AharonSearch/6.0 profile-correlation' } = {}) {
    this.enabled = Boolean(enabled);
    this.timeoutMs = Math.max(3000, Math.min(30000, Number(timeoutMs || 12000)));
    this.clientId = String(clientId || '').trim();
    this.clientSecret = String(clientSecret || '').trim();
    this.userAgent = String(userAgent || 'AharonSearch/6.0 profile-correlation');
    this.source = 'reddit';
    this._token = null;
    this._tokenExpires = 0;
  }

  status() { return { enabled: this.enabled, oauth_configured: Boolean(this.clientId && this.clientSecret), mode: this.clientId && this.clientSecret ? 'reddit_oauth_api' : 'reddit_public_json' }; }

  async _oauthToken() {
    if (!this.clientId || !this.clientSecret) return '';
    if (this._token && Date.now() < this._tokenExpires - 30000) return this._token;
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: { authorization: `Basic ${credentials}`, 'content-type': 'application/x-www-form-urlencoded', 'user-agent': this.userAgent },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.access_token) throw new Error(body?.message || body?.error || `Reddit OAuth HTTP ${response.status}`);
    this._token = body.access_token;
    this._tokenExpires = Date.now() + Number(body.expires_in || 3600) * 1000;
    return this._token;
  }

  async _get(path) {
    const token = await this._oauthToken();
    const base = token ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
    const headers = { accept: 'application/json', 'user-agent': this.userAgent };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(base + path, { headers, signal: AbortSignal.timeout(this.timeoutMs) });
    if (response.status === 404) return null;
    const raw = await response.text(); let body = null; try { body = JSON.parse(raw); } catch (_) {}
    if (!response.ok) throw new Error(body?.message || body?.error || `Reddit HTTP ${response.status}`);
    return body;
  }

  _row(data, weight = 94) {
    return {
      source: 'reddit', title: `u/${data.name}`,
      snippet: [`karma=${Number(data.total_karma || data.link_karma || 0)}`, data.subreddit?.public_description || data.subreddit?.title || ''].filter(Boolean).map((x) => clean(x, 450)).join(' · '),
      url: `https://www.reddit.com/user/${encodeURIComponent(data.name)}/`, username: data.name,
      thumbnail: data.icon_img || data.snoovatar_img || '',
      reddit: { id: data.id || '', created_utc: data.created_utc || 0, total_karma: Number(data.total_karma || 0), verified: Boolean(data.verified), is_employee: Boolean(data.is_employee) },
      provenance: [{ source: 'reddit_api', intent: 'public_profile', weight }],
    };
  }

  async lookup(record) {
    const username = String(record?.username || '').trim().replace(/^@/, '');
    const name = String(record?.name || '').trim();
    if (!this.enabled) return { status: 'disabled', provider: 'reddit_public', source: 'reddit', results: [] };
    if (!username && !name) return { status: 'skipped', provider: 'reddit_public', source: 'reddit', reason: 'username_or_name_required', results: [] };
    try {
      if (username && /^[A-Za-z0-9_-]{3,20}$/.test(username)) {
        const payload = await this._get(`/user/${encodeURIComponent(username)}/about.json?raw_json=1`);
        const data = payload?.data || {};
        if (!data.name) return { status: 'ok', provider: 'reddit_public', source: 'reddit', count: 0, results: [] };
        return { status: 'ok', provider: 'reddit_public', source: 'reddit', count: 1, results: [this._row(data, 96)] };
      }
      const payload = await this._get(`/users/search.json?q=${encodeURIComponent(name)}&limit=5&raw_json=1`);
      const users = (payload?.data?.children || []).map((x) => x?.data).filter((x) => x?.name);
      return { status: 'ok', provider: 'reddit_public', source: 'reddit', count: users.length, results: users.map((x) => this._row(x, 72)) };
    } catch (error) {
      return { status: 'error', provider: 'reddit_public', source: 'reddit', count: 0, results: [], reason: clean(error?.message || error, 500), code: 'REDDIT_FAILED' };
    }
  }
}