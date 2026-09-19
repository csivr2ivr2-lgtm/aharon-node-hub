function clean(value, limit = 900) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit); }
export class TikTokWorkerProvider {
  constructor({ enabled = false, baseUrl = '', timeoutMs = 20000 } = {}) {
    this.enabled = Boolean(enabled && baseUrl);
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.timeoutMs = Math.max(3000, Math.min(60000, Number(timeoutMs || 20000)));
    this.source = 'tiktok';
  }
  status() { return { enabled: this.enabled, configured: Boolean(this.baseUrl), mode: 'tiktok_api_worker' }; }
  async lookup(record) {
    if (!this.enabled) return { status: 'disabled', provider: 'tiktok_worker', source: 'tiktok', reason: 'TIKTOK_WORKER_URL_not_configured', results: [] };
    const username = String(record?.username || '').trim().replace(/^@/, '');
    if (!username) return { status: 'skipped', provider: 'tiktok_worker', source: 'tiktok', reason: 'username_required', results: [] };
    try {
      const response = await fetch(`${this.baseUrl}/profile?username=${encodeURIComponent(username)}`, { headers: { accept: 'application/json', 'user-agent': 'Aharon-Search/6.0' }, signal: AbortSignal.timeout(this.timeoutMs) });
      const raw = await response.text(); let body = null; try { body = JSON.parse(raw); } catch (_) {}
      if (response.status === 404) return { status: 'ok', provider: 'tiktok_worker', source: 'tiktok', count: 0, results: [] };
      if (!response.ok) throw new Error(body?.error || body?.detail || `TikTok worker HTTP ${response.status}`);
      const u = body?.user || body?.data || body;
      if (!u) return { status: 'ok', provider: 'tiktok_worker', source: 'tiktok', count: 0, results: [] };
      const handle = u.uniqueId || u.unique_id || u.username || username;
      const result = { source: 'tiktok', title: u.nickname || u.display_name || `@${handle}`, snippet: [u.signature || u.bio, u.followerCount != null ? `followers=${u.followerCount}` : '', u.videoCount != null ? `videos=${u.videoCount}` : ''].filter(Boolean).map((x) => clean(x, 450)).join(' · '), url: `https://www.tiktok.com/@${encodeURIComponent(handle)}`, username: handle, thumbnail: u.avatarLarger || u.avatar_url || u.avatar || '', provenance: [{ source: 'tiktok_worker', intent: 'public_profile', weight: 94 }] };
      return { status: 'ok', provider: 'tiktok_worker', source: 'tiktok', count: 1, results: [result] };
    } catch (error) {
      return { status: 'error', provider: 'tiktok_worker', source: 'tiktok', count: 0, results: [], reason: clean(error?.message || error, 500), code: 'TIKTOK_WORKER_FAILED' };
    }
  }
}