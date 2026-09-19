import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function parseJsonOutput(stdout) {
  const raw = String(stdout || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) {}
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    try { return JSON.parse(line); } catch (_) {}
  }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)); } catch (_) {}
  }
  return null;
}

function collectRows(value, out = []) {
  if (!value) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectRows(item, out);
    return out;
  }
  if (typeof value !== 'object') return out;
  const url = value.link || value.url || value.profile || value.profile_url || '';
  const detected = value.detected ?? value.found ?? value.exists ?? value.status;
  if (url && detected !== false && detected !== 'failed' && detected !== 'unknown') out.push(value);
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') collectRows(nested, out);
  }
  return out;
}

function sourceFromUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (host.includes('instagram.com')) return 'instagram';
    if (host.includes('tiktok.com')) return 'tiktok';
    if (host === 'x.com' || host.includes('twitter.com')) return 'x';
    if (host.includes('reddit.com')) return 'reddit';
    if (host.includes('facebook.com')) return 'facebook';
    if (host.includes('youtube.com')) return 'youtube';
    if (host.includes('github.com')) return 'github';
    return host || 'social_analyzer';
  } catch (_) { return 'social_analyzer'; }
}

export class SocialAnalyzerProvider {
  constructor({ enabled = false, command = 'social-analyzer', timeoutMs = 45000, top = 100 } = {}) {
    this.enabled = Boolean(enabled);
    this.command = command;
    this.timeoutMs = Math.max(5000, Math.min(180000, Number(timeoutMs || 45000)));
    this.top = Math.max(10, Math.min(1000, Number(top || 100)));
  }

  status() {
    return { enabled: this.enabled, command: this.command, top: this.top };
  }

  async lookup(record) {
    const username = String(record?.username || '').trim().replace(/^@/, '');
    if (!this.enabled) return { status: 'disabled', provider: 'social_analyzer', results: [] };
    if (!username) return { status: 'skipped', provider: 'social_analyzer', reason: 'username_required', results: [] };

    const args = ['--username', username, '--mode', 'fast', '--output', 'json', '--filter', 'good,maybe', '--profiles', 'detected', '--top', String(this.top), '--metadata', '--silent'];
    try {
      const { stdout, stderr } = await execFileAsync(this.command, args, {
        timeout: this.timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        env: process.env,
      });
      const payload = parseJsonOutput(stdout);
      if (!payload) {
        return { status: 'error', provider: 'social_analyzer', reason: 'invalid_json_output', stderr: String(stderr || '').slice(-600), results: [] };
      }
      const seen = new Set();
      const results = collectRows(payload).map((item) => {
        const url = String(item.link || item.url || item.profile || item.profile_url || '');
        return {
          source: sourceFromUrl(url),
          title: String(item.title || item.username || username),
          snippet: String(item.text || item.description || item.bio || item.metadata || '').slice(0, 1000),
          url,
          username: String(item.username || username).replace(/^@/, ''),
          thumbnail: String(item.image || item.avatar || item.picture || ''),
          social_analyzer_rate: Number(item.rate || item.score || 0),
          provenance: [{ source: 'social_analyzer', intent: 'username_profile_discovery', weight: 88 }],
        };
      }).filter((row) => row.url && !seen.has(row.url) && seen.add(row.url));
      return { status: 'ok', provider: 'social_analyzer', username, count: results.length, results };
    } catch (error) {
      const missing = error?.code === 'ENOENT';
      return {
        status: 'error', provider: 'social_analyzer', results: [],
        code: missing ? 'COMMAND_NOT_FOUND' : (error?.code || 'EXEC_FAILED'),
        reason: missing ? `Social Analyzer command not found: ${this.command}` : String(error?.message || error).slice(0, 800),
      };
    }
  }
}