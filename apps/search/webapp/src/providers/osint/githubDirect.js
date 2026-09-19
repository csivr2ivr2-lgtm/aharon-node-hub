function cleanText(value, limit = 800) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

export class GitHubDirectProvider {
  constructor({ enabled = true, token = '', timeoutMs = 12000, maxCandidates = 4 } = {}) {
    this.enabled = Boolean(enabled);
    this.token = String(token || '').trim();
    this.timeoutMs = Math.max(3000, Math.min(30000, Number(timeoutMs || 12000)));
    this.maxCandidates = Math.max(1, Math.min(8, Number(maxCandidates || 4)));
    this.source = 'github';
  }

  status() { return { enabled: this.enabled, authenticated: Boolean(this.token), mode: 'github_rest_api' }; }

  async _request(path) {
    const headers = {
      accept: 'application/vnd.github+json',
      'user-agent': 'Aharon-Search/6.0',
      'x-github-api-version': '2026-03-10',
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(this.timeoutMs) });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch (_) {}
    if (!response.ok) {
      const error = new Error(body?.message || `GitHub HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  _row(user, weight = 94) {
    return {
      source: 'github',
      title: user.name || user.login || 'GitHub profile',
      snippet: [user.bio, user.company, user.location, Number.isFinite(user.public_repos) ? `repos=${user.public_repos}` : '', Number.isFinite(user.followers) ? `followers=${user.followers}` : ''].filter(Boolean).map((x) => cleanText(x, 260)).join(' · '),
      url: user.html_url || (user.login ? `https://github.com/${encodeURIComponent(user.login)}` : ''),
      username: user.login || '',
      thumbnail: user.avatar_url || '',
      github: { id: user.id || null, type: user.type || '', blog: user.blog || '', created_at: user.created_at || '' },
      provenance: [{ source: 'github_api', intent: 'direct_profile', weight }],
    };
  }

  async lookup(record) {
    if (!this.enabled) return { status: 'disabled', provider: 'github_direct', source: 'github', results: [] };
    const username = String(record?.username || '').trim().replace(/^@/, '');
    const name = String(record?.name || '').trim();
    try {
      if (username && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(username)) {
        try {
          const user = await this._request(`/users/${encodeURIComponent(username)}`);
          return { status: 'ok', provider: 'github_direct', source: 'github', count: 1, results: [this._row(user, 98)] };
        } catch (error) {
          if (error.status === 404) return { status: 'ok', provider: 'github_direct', source: 'github', count: 0, results: [] };
          throw error;
        }
      }
      if (!name) return { status: 'skipped', provider: 'github_direct', source: 'github', reason: 'username_or_name_required', results: [] };
      const q = encodeURIComponent(`${name} in:fullname`);
      const search = await this._request(`/search/users?q=${q}&per_page=${this.maxCandidates}`);
      const candidates = (search?.items || []).slice(0, this.maxCandidates);
      const details = await Promise.all(candidates.map(async (item) => {
        try { return await this._request(`/users/${encodeURIComponent(item.login)}`); } catch (_) { return item; }
      }));
      const results = details.map((user) => this._row(user, 78));
      return { status: 'ok', provider: 'github_direct', source: 'github', count: results.length, results };
    } catch (error) {
      return { status: 'error', provider: 'github_direct', source: 'github', count: 0, results: [], reason: cleanText(error?.message || error, 500), code: error?.status ? `HTTP_${error.status}` : 'GITHUB_FAILED' };
    }
  }
}