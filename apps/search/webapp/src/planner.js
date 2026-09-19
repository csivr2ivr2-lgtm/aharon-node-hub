import { phoneVariants } from './normalize.js';

export const SOURCE_DOMAINS = {
  instagram: 'instagram.com',
  facebook: 'facebook.com',
  x: 'x.com',
  tiktok: 'tiktok.com',
  linkedin: 'linkedin.com',
  reddit: 'reddit.com',
  youtube: 'youtube.com',
  github: 'github.com',
};

export const FORUM_QUERY_PREFIX =
  '(inurl:forum OR inurl:thread OR inurl:topic OR site:fxp.co.il OR site:tapuz.co.il OR site:quora.com OR site:stackoverflow.com/questions OR site:stackexchange.com OR site:news.ycombinator.com/item)';

export const ALL_SOURCES = ['web', 'forums', ...Object.keys(SOURCE_DOMAINS)];

const q = (value) => `"${String(value || '').replaceAll('"', '').trim()}"`;

export class SearchPlanner {
  static SOURCE_DOMAINS = SOURCE_DOMAINS;
  static ALL_SOURCES = ALL_SOURCES;

  static prefixFor(source) {
    if (source === 'web') return '';
    if (source === 'forums') return `${FORUM_QUERY_PREFIX} `;
    const domain = SOURCE_DOMAINS[source];
    return domain ? `site:${domain} ` : '';
  }

  static plan(record, maxPerSource = 3, sourceOverride = null) {
    const sources = sourceOverride || ALL_SOURCES;
    const name = String(record.name || '').trim();
    const alias = String(record.alias || '').trim();
    const username = String(record.username || '').replace(/^@/, '').trim();
    const text = String(record.text || '').trim();
    const phoneTerms = record.phone ? phoneVariants(record.phone).filter((x) => x.startsWith('+') || x.startsWith('0') || x.startsWith('972')).slice(0, 3) : [];
    const plans = [];
    for (const source of sources) {
      const prefix = this.prefixFor(source);
      const candidates = [];
      if (username) candidates.push({ source, intent: 'username_exact', weight: 105, query: prefix + q(username) });
      if (name && phoneTerms.length) candidates.push({ source, intent: 'name_phone', weight: 103, query: `${prefix}${q(name)} (${phoneTerms.map(q).join(' OR ')})` });
      if (name && username) candidates.push({ source, intent: 'name_username', weight: 98, query: `${prefix}${q(name)} ${q(username)}` });
      if (alias && phoneTerms.length) candidates.push({ source, intent: 'alias_phone', weight: 96, query: `${prefix}${q(alias)} (${phoneTerms.map(q).join(' OR ')})` });
      if (name && alias) candidates.push({ source, intent: 'name_alias', weight: 91, query: `${prefix}${q(name)} ${q(alias)}` });
      if (phoneTerms.length) candidates.push({ source, intent: 'phone_exact', weight: 94, query: `${prefix}(${phoneTerms.map(q).join(' OR ')})` });
      if (alias) candidates.push({ source, intent: 'alias_exact', weight: 82, query: prefix + q(alias) });
      if (name) candidates.push({ source, intent: 'name_exact', weight: 72, query: prefix + q(name) });
      if (text) candidates.push({ source, intent: 'free_text', weight: 55, query: prefix + q(text) });
      const seen = new Set();
      for (const item of candidates.sort((a, b) => b.weight - a.weight)) {
        if (seen.has(item.query)) continue;
        seen.add(item.query);
        plans.push({ ...item, weight: Math.min(100, item.weight) });
        if (plans.filter((p) => p.source === source).length >= maxPerSource) break;
      }
    }
    return plans;
  }

  static manualLinks(plans) {
    const out = {};
    for (const plan of plans) {
      out[plan.source] ||= [];
      out[plan.source].push('https://www.google.com/search?' + new URLSearchParams({ q: plan.query }).toString());
    }
    return out;
  }
}