import { canonicalUrl, nameScore, normalizeText, phoneMatch } from './normalize.js';

export const SOCIAL_HOSTS = {
  'facebook.com': 'facebook', 'www.facebook.com': 'facebook',
  'instagram.com': 'instagram', 'www.instagram.com': 'instagram',
  'x.com': 'x', 'www.x.com': 'x', 'twitter.com': 'x', 'www.twitter.com': 'x',
  'tiktok.com': 'tiktok', 'www.tiktok.com': 'tiktok',
  'youtube.com': 'youtube', 'www.youtube.com': 'youtube', 'youtu.be': 'youtube',
  'reddit.com': 'reddit', 'www.reddit.com': 'reddit',
  'github.com': 'github', 'www.github.com': 'github',
  'linkedin.com': 'linkedin', 'www.linkedin.com': 'linkedin',
};
const FORUM_HOSTS = new Set([
  'fxp.co.il', 'www.fxp.co.il',
  'tapuz.co.il', 'www.tapuz.co.il',
  'quora.com', 'www.quora.com',
]);
const RESERVED = new Set(['watch', 'shorts', 'results', 'search', 'explore', 'reel', 'reels', 'p', 'r', 'user', 'users', 'video']);

export function sourceFromUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (SOCIAL_HOSTS[host]) return SOCIAL_HOSTS[host];
    if (FORUM_HOSTS.has(host) || /\/(forum|forums|thread|threads|topic|topics)\b/i.test(parsed.pathname)) return 'forums';
    return 'web';
  } catch (_) { return 'web'; }
}

export function handleFromUrl(url) {
  try {
    const parsed = new URL(url);
    const type = sourceFromUrl(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (!parts.length || type === 'web') return '';
    let handle = parts[0].replace(/^@/, '');
    if (type === 'reddit' && handle.toLowerCase() === 'user' && parts[1]) handle = parts[1];
    if (RESERVED.has(handle.toLowerCase())) return '';
    return /^[A-Za-z0-9._-]{2,64}$/.test(handle) ? handle : '';
  } catch (_) { return ''; }
}

export function rankAndFilter(record, rows, inspections = [], external = []) {
  const inspectionByUrl = new Map(inspections.map((item) => [canonicalUrl(item.url), item]));
  const username = String(record.username || '').replace(/^@/, '').toLowerCase();
  const name = String(record.name || '');
  const alias = String(record.alias || '');
  const recordId = String(record.id || '').trim();
  const merged = new Map();
  for (const row of [...rows, ...external]) {
    const fallbackKey = row.source === 'registry'
      ? `registry:${row.registry_id || row.title || ''}`
      : `${row.source}:${row.title}:${row.phone}:${row.username}`;
    const key = canonicalUrl(row.url || fallbackKey);
    const existing = merged.get(key) || {};
    merged.set(key, { ...existing, ...row, provenance: [...(existing.provenance || []), ...(row.provenance || [])] });
  }

  const ranked = [];
  const linked = [];
  const conflicts = [];
  for (const item of merged.values()) {
    const inspection = inspectionByUrl.get(canonicalUrl(item.url || '')) || {};
    const hay = [item.title, item.snippet, item.url, item.name, item.phone, item.username, inspection.text].map((x) => String(x || '')).join(' ');
    const reasons = [];
    const itemConflicts = [];
    let score = 3;
    const ns = nameScore(name, hay);
    if (name && ns === 100) { score += 28; reasons.push('שם מלא תואם'); }
    else if (name && ns >= 70) { score += 16; reasons.push(`שם דומה ${ns}%`); }
    const aliasScore = nameScore(alias, hay);
    if (alias && aliasScore === 100) { score += 22; reasons.push('כינוי/שם עסק תואם'); }
    else if (alias && aliasScore >= 70) { score += 12; reasons.push(`כינוי/שם עסק דומה ${aliasScore}%`); }
    const phoneSignal = record.phone ? phoneMatch(record.phone, hay) : { matched: false, matches: [], collisions: [] };
    if (phoneSignal.matched) { score += 38; reasons.push('מספר תואם במדויק'); }
    if (!phoneSignal.matched && phoneSignal.collisions?.length) {
      score -= 60;
      itemConflicts.push('נמצא מספר דומה, אבל עם קידומת מדינה אחרת');
    }
    if (username && hay.toLowerCase().includes(username)) { score += 34; reasons.push('username תואם'); }
    if (item.source === 'whatsapp' && item.registered !== false) { score += 42; reasons.push('WhatsApp מחובר החזיר פרופיל'); }
    if (item.source === 'registry') {
      const registryId = String(item.registry_id || '').trim();
      const matchScore = Math.max(0, Math.min(100, Number(item.registry_match_score || 0)));
      if (recordId && registryId && registryId === recordId) {
        score += 72;
        reasons.push('תעודת זהות תואמת במאגר הפנימי');
      } else if (matchScore) {
        score += Math.round(matchScore * 0.36);
        reasons.push(`התאמה במאגר הפנימי ${matchScore}%`);
      } else {
        score += 20;
        reasons.push('נמצא במאגר הפנימי');
      }
    }
    const handle = handleFromUrl(item.url || '');
    if (username && handle && handle.toLowerCase() === username) { score += 18; reasons.push('handle ב־URL תואם'); }
    if (phoneSignal.matched && (ns >= 70 || aliasScore >= 70 || (username && hay.toLowerCase().includes(username)))) { score += 20; reasons.push('כמה מזהים באותו מקור'); }
    for (const p of item.provenance || []) score += Math.min(12, Math.round((Number(p.weight || 0) - 50) / 8));
    if (username && handle && handle.toLowerCase() !== username && item.source !== 'web' && !hay.toLowerCase().includes(username)) {
      score -= 20; itemConflicts.push('handle שונה מה־username שסופק');
    }
    if (name && ns > 0 && ns < 45 && !phoneSignal.matched && !hay.toLowerCase().includes(username)) score -= 15;
    const rankScore = Math.max(1, Math.min(100, Math.round(score)));
    const enriched = { ...item, rank_score: rankScore, rank_reasons: reasons, conflicts: itemConflicts, handle };
    if (itemConflicts.length) conflicts.push(...itemConflicts.map((reason) => ({ reason, url: item.url || '' })));
    ranked.push(enriched);
  }
  ranked.sort((a, b) => b.rank_score - a.rank_score);
  const kept = ranked.filter((item) => item.rank_score >= 35 || item.source === 'whatsapp');
  for (const item of kept) {
    const type = item.source || sourceFromUrl(item.url || '');
    if (!item.url && type !== 'whatsapp') continue;
    const verified = item.rank_score >= 70 || type === 'whatsapp';
    linked.push({ type, url: item.url || '', label: item.name || item.title || item.username || item.handle || type, score: item.rank_score, verified, evidence: item.rank_reasons?.join(' · ') || '' });
  }
  const strongSources = [...new Set(kept.filter((item) => item.rank_score >= 70).map((item) => item.source || sourceFromUrl(item.url || '')))];
  return {
    score: kept.length ? Math.max(1, Math.min(100, Math.round(kept.slice(0, 8).reduce((sum, x) => sum + x.rank_score, 0) / Math.min(8, kept.length)))) : 1,
    linked_accounts: linked.slice(0, 40),
    results: kept.slice(0, 80),
    strong_sources: strongSources,
    conflicts,
    summary: {
      result_count: kept.length,
      raw_result_count: ranked.length,
      filtered_count: Math.max(0, ranked.length - kept.length),
      linked_count: linked.length,
      strong_source_count: strongSources.length,
      conflict_count: conflicts.length,
    },
  };
}