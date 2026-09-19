function clean(value, limit = 800) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit); }

export class XDirectProvider {
  constructor({ enabled = true, bearerToken = '', timeoutMs = 12000 } = {}) {
    this.enabled = Boolean(enabled);
    this.bearerToken = String(bearerToken || '').trim();
    this.timeoutMs = Math.max(3000, Math.min(30000, Number(timeoutMs || 12000)));
    this.source = 'x';
  }
  status() { return { enabled: this.enabled, configured: Boolean(this.bearerToken), mode: 'x_api_v2' }; }
  async lookup(record) {
    if (!this.enabled) return { status: 'disabled', provider: 'x_direct', source: 'x', results: [] };
    if (!this.bearerToken) return { status: 'disabled', provider: 'x_direct', source: 'x', reason: 'X_BEARER_TOKEN_not_configured', results: [] };
    const username = String(record?.username || '').trim().replace(/^@/, '');
    if (!username) return { status: 'skipped', provider: 'x_direct', source: 'x', reason: 'username_required_for_exact_x_lookup', results: [] };
    const fields = 'id,name,username,description,location,profile_image_url,public_metrics,verified,created_at,url';
    const url = `https://api.x.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=${encodeURIComponent(fields)}`;
    try {
      const response = await fetch(url, { headers: { authorization: `Bearer ${this.bearerToken}`, accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) });
      const raw = await response.text(); let body = null; try { body = JSON.parse(raw); } catch (_) {}
      if (response.status === 404 || (!body?.data && response.ok)) return { status: 'ok', provider: 'x_direct', source: 'x', count: 0, results: [] };
      if (!response.ok) throw new Error(body?.detail || body?.title || body?.errors?.[0]?.message || `X HTTP ${response.status}`);
      const u = body.data;
      const result = { source: 'x', title: u.name || `@${u.username}`, snippet: [u.description, u.location, u.public_metrics?.followers_count != null ? `followers=${u.public_metrics.followers_count}` : ''].filter(Boolean).map((x) => clean(x, 400)).join(' · '), url: `https://x.com/${encodeURIComponent(u.username)}`, username: u.username || username, thumbnail: u.profile_image_url || '', x: { id: u.id || '', verified: Boolean(u.verified), public_metrics: u.public_metrics || {} }, provenance: [{ source: 'x_api', intent: 'exact_username', weight: 98 }] };
      return { status: 'ok', provider: 'x_direct', source: 'x', count: 1, results: [result] };
    } catch (error) {
      return { status: 'error', provider: 'x_direct', source: 'x', count: 0, results: [], reason: clean(error?.message || error, 500), code: 'X_API_FAILED' };
    }
  }
}