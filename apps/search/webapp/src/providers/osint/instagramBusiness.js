function clean(value, limit = 900) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit); }

export class InstagramBusinessProvider {
  constructor({ enabled = true, accessToken = '', igUserId = '', graphVersion = 'v26.0', timeoutMs = 12000 } = {}) {
    this.enabled = Boolean(enabled);
    this.accessToken = String(accessToken || '').trim();
    this.igUserId = String(igUserId || '').trim();
    this.graphVersion = String(graphVersion || 'v26.0').trim();
    this.timeoutMs = Math.max(3000, Math.min(30000, Number(timeoutMs || 12000)));
    this.source = 'instagram';
  }
  status() { return { enabled: this.enabled, configured: Boolean(this.accessToken && this.igUserId), mode: 'instagram_graph_business_discovery', graph_version: this.graphVersion }; }
  async lookup(record) {
    if (!this.enabled) return { status: 'disabled', provider: 'instagram_business', source: 'instagram', results: [] };
    if (!this.accessToken || !this.igUserId) return { status: 'disabled', provider: 'instagram_business', source: 'instagram', reason: 'META_ACCESS_TOKEN_or_META_IG_USER_ID_not_configured', results: [] };
    const username = String(record?.username || '').trim().replace(/^@/, '');
    if (!username) return { status: 'skipped', provider: 'instagram_business', source: 'instagram', reason: 'username_required_for_business_discovery', results: [] };
    const fields = `business_discovery.username(${username.replace(/[(){}]/g, '')}){id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url,website}`;
    const params = new URLSearchParams({ fields, access_token: this.accessToken });
    const url = `https://graph.facebook.com/${encodeURIComponent(this.graphVersion)}/${encodeURIComponent(this.igUserId)}?${params}`;
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) });
      const raw = await response.text(); let body = null; try { body = JSON.parse(raw); } catch (_) {}
      if (!response.ok || body?.error) throw new Error(body?.error?.message || `Instagram Graph HTTP ${response.status}`);
      const u = body?.business_discovery;
      if (!u?.username) return { status: 'ok', provider: 'instagram_business', source: 'instagram', count: 0, results: [] };
      const result = { source: 'instagram', title: u.name || `@${u.username}`, snippet: [u.biography, u.website, u.followers_count != null ? `followers=${u.followers_count}` : '', u.media_count != null ? `media=${u.media_count}` : ''].filter(Boolean).map((x) => clean(x, 450)).join(' · '), url: `https://www.instagram.com/${encodeURIComponent(u.username)}/`, username: u.username, thumbnail: u.profile_picture_url || '', instagram: { id: u.id || '', followers_count: u.followers_count ?? null, media_count: u.media_count ?? null }, provenance: [{ source: 'instagram_graph_api', intent: 'business_discovery', weight: 98 }] };
      return { status: 'ok', provider: 'instagram_business', source: 'instagram', count: 1, results: [result] };
    } catch (error) {
      return { status: 'error', provider: 'instagram_business', source: 'instagram', count: 0, results: [], reason: clean(error?.message || error, 500), code: 'INSTAGRAM_GRAPH_FAILED' };
    }
  }
}