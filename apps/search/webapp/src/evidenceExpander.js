import { ALL_SOURCES, SearchPlanner } from './planner.js';
import { handleFromUrl } from './correlator.js';
import { phoneVariants } from './normalize.js';

export class EvidenceExpander {
  static trustedFacts(record, ranked) {
    const facts = [];
    const add = (type, value, confidence, source) => {
      const clean = String(value || '').trim().replace(/^@/, '');
      if (!clean) return;
      const key = `${type}:${clean.toLowerCase()}`;
      if (!facts.some((f) => f.key === key)) facts.push({ key, type, value: clean, confidence, source });
    };
    const wa = ranked.results?.find((item) => item.source === 'whatsapp') || null;
    if (wa) {
      add('name', wa.name || wa.title, 96, 'whatsapp');
      add('username', wa.whatsapp_username || wa.username, 94, 'whatsapp');
      add('phone', wa.phone, 98, 'whatsapp');
    }
    for (const item of ranked.results || []) {
      const score = Number(item.rank_score || 0);
      if (score < 72 && item.source !== 'registry') continue;
      const handle = item.handle || handleFromUrl(item.url || '');
      if (handle) add('username', handle, score, item.source || 'web');
      if (item.name) add('name', item.name, item.source === 'registry' ? Math.max(84, score) : score, item.source || 'web');
      if (item.phone) add('phone', item.phone, score, item.source || 'web');
      if (item.source === 'registry') {
        if (item.city_name) add('context', item.city_name, 86, 'registry');
        if (item.country_name) add('context', item.country_name, 82, 'registry');
        if (item.birth_year) add('context', item.birth_year, 78, 'registry');
      }
    }
    for (const base of ['name', 'username', 'phone']) if (record[base]) add(base, record[base], 100, 'input');
    return facts.sort((a, b) => b.confidence - a.confidence).slice(0, 12);
  }

  static expansionPlans(record, ranked, seenQueries, maxPerRound = 24, sources = ALL_SOURCES) {
    const facts = this.trustedFacts(record, ranked);
    const derived = { ...record };
    for (const fact of facts) {
      if (fact.type === 'name' && !derived.name) derived.name = fact.value;
      if (fact.type === 'username' && !derived.username) derived.username = fact.value;
      if (fact.type === 'phone' && !derived.phone) derived.phone = fact.value;
    }
    const candidates = SearchPlanner.plan(derived, 2, sources)
      .map((p) => ({ ...p, intent: `expansion_${p.intent}`, weight: Math.min(100, p.weight + 4) }));
    const phoneFacts = facts.filter((f) => f.type === 'phone').flatMap((f) => phoneVariants(f.value));
    const usernameFacts = facts.filter((f) => f.type === 'username').map((f) => f.value);
    const nameFacts = facts.filter((f) => f.type === 'name').map((f) => f.value);
    const contextFacts = facts.filter((f) => f.type === 'context').map((f) => f.value);
    for (const username of usernameFacts) {
      for (const source of sources) {
        candidates.push({
          source,
          intent: 'expansion_trusted_username',
          weight: 97,
          query: `${SearchPlanner.prefixFor(source)}"${username}"`,
        });
      }
    }
    for (const name of nameFacts.slice(0, 2)) {
      for (const phone of phoneFacts.slice(0, 2)) candidates.push({ source: 'web', intent: 'expansion_trusted_name_phone', weight: 99, query: `"${name}" "${phone}"` });
      for (const username of usernameFacts.slice(0, 2)) candidates.push({ source: 'web', intent: 'expansion_trusted_name_username', weight: 98, query: `"${name}" "${username}"` });
      for (const context of contextFacts.slice(0, 2)) {
        for (const source of sources) {
          candidates.push({
            source,
            intent: 'expansion_trusted_name_context',
            weight: 92,
            query: `${SearchPlanner.prefixFor(source)}"${name}" "${context}"`,
          });
        }
      }
    }
    const out = [];
    for (const plan of candidates) {
      if (!plan.query || plan.query.includes('undefined')) continue;
      const key = `${plan.source}:${plan.query}`;
      if (seenQueries.has(key)) continue;
      seenQueries.add(key);
      out.push(plan);
      if (out.length >= maxPerRound) break;
    }
    return { facts, plans: out };
  }
}