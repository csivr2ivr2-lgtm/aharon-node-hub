function text(value, limit = 900) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit); }

export class YouTubeDirectProvider {
  constructor({ enabled = true, apiKey = '', timeoutMs = 12000, searchByName = true } = {}) {
    this.enabled = Boolean(enabled);
    this.apiKey = String(apiKey || '').trim();
    this.timeoutMs = Math.max(3000, Math.min(30000, Number(timeoutMs || 12000)));
    this.searchByName = Boolean(searchByName);
    this.source = 'youtube';
  }
  status() { return { enabled: this.enabled, configured: Boolean(this.apiKey), mode: 'youtube_data_api_v3', search_by_name: this.searchByName }; }
  async _get(path, params) {
    const query = new URLSearchParams({ ...params, key: this.apiKey });
    const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${query}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) });
    const raw = await response.text(); let body = null; try { body = JSON.parse(raw); } catch (_) {}
    if (!response.ok) throw new Error(body?.error?.message || `YouTube HTTP ${response.status}`);
    return body;
  }
  _channelRow(item, weight = 92) {
    const id = item.id?.channelId || item.id || '';
    const snippet = item.snippet || {};
    return { source: 'youtube', title: snippet.title || 'YouTube channel', snippet: text(snippet.description, 700), url: id ? `https://www.youtube.com/channel/${id}` : '', username: '', thumbnail: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || '', youtube: { channel_id: id }, provenance: [{ source: 'youtube_api', intent: 'direct_channel', weight }] };
  }
  async lookup(record) {
    if (!this.enabled) return { status: 'disabled', provider: 'youtube_direct', source: 'youtube', results: [] };
    if (!this.apiKey) return { status: 'disabled', provider: 'youtube_direct', source: 'youtube', reason: 'YOUTUBE_API_KEY_not_configured', results: [] };
    const username = String(record?.username || '').trim().replace(/^@/, '');
    const name = String(record?.name || '').trim();
    try {
      if (username) {
        const body = await this._get('channels', { part: 'snippet,statistics', forHandle: username, maxResults: '1' });
        const results = (body.items || []).map((item) => this._channelRow(item, 97));
        return { status: 'ok', provider: 'youtube_direct', source: 'youtube', count: results.length, results };
      }
      if (!name || !this.searchByName) return { status: 'skipped', provider: 'youtube_direct', source: 'youtube', reason: 'username_or_name_required', results: [] };
      const body = await this._get('search', { part: 'snippet', type: 'channel', q: name, maxResults: '5' });
      const results = (body.items || []).map((item) => this._channelRow(item, 75));
      return { status: 'ok', provider: 'youtube_direct', source: 'youtube', count: results.length, results };
    } catch (error) {
      return { status: 'error', provider: 'youtube_direct', source: 'youtube', count: 0, results: [], reason: text(error?.message || error, 500), code: 'YOUTUBE_FAILED' };
    }
  }
}