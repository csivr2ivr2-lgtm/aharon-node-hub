import { SearchPlanner, ALL_SOURCES } from './planner.js';
import { SerpApiClient } from './providers/serpapi.js';
import { nowIso, normalizeInput, phoneInfo } from './normalize.js';
import { rankAndFilter, handleFromUrl, sourceFromUrl } from './correlator.js';
import { EvidenceExpander } from './evidenceExpander.js';
import { WhatsAppLinkedDeviceProvider } from './whatsapp.js';
import { OsintHub } from './providers/osint/hub.js';

const SERP_SOURCES = ['web', 'forums'];

async function mapLimit(items, limit, worker) {
  const out = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

export class AharonSearchEngine {
  constructor({ serpapiKey = '', maxResultsPerSource = 6, maxQueriesPerSource = 1, timeoutMs = 60000, expansionRounds = 1, whatsappEnabled = true, whatsapp = null, registry = null, osintEnabled = true, osint = null } = {}) {
    this.client = new SerpApiClient({ apiKey: serpapiKey, timeoutMs });
    this.maxResultsPerSource = Math.max(1, Math.min(15, Number(maxResultsPerSource || 6)));
    this.maxQueriesPerSource = Math.max(1, Math.min(5, Number(maxQueriesPerSource || 1)));
    this.timeoutMs = Math.max(10000, Math.min(120000, Number(timeoutMs || 60000)));
    this.expansionRounds = Math.max(0, Math.min(3, Number(expansionRounds || 1)));
    this.whatsappEnabled = Boolean(whatsappEnabled);
    this.whatsapp = whatsapp || new WhatsAppLinkedDeviceProvider({ enabled: whatsappEnabled });
    this.registry = registry;
    this.osint = osint || new OsintHub({ enabled: osintEnabled, timeoutMs });
  }

  async search(data) {
    const record = normalizeInput(data);
    const phone_intelligence = record.phone ? phoneInfo(record.phone) : null;
    const initialPlans = SearchPlanner.plan(record, this.maxQueriesPerSource, SERP_SOURCES);
    const manual_links = SearchPlanner.manualLinks(initialPlans);
    const seenPlans = new Set(initialPlans.map((p) => `${p.source}:${p.query}`));
    const source_status = Object.fromEntries(ALL_SOURCES.map((source) => [source, { status: 'pending', queries: 0, count: 0 }]));
    source_status.whatsapp = { status: 'pending', queries: 0, count: 0 };
    source_status.registry = { status: 'pending', queries: 0, count: 0 };
    source_status.osint = { status: 'pending', queries: 0, count: 0 };
    let results = [];
    let inspections = [];
    let expansion_facts = [];
    let expansion_rounds_executed = 0;
    const external = [];

    const whatsappPromise = this._lookupWhatsApp(record).catch((error) => ({ status: 'error', reason: String(error?.message || error) }));
    const registryPromise = this._lookupRegistry(record).catch((error) => ({ status: 'error', reason: String(error?.message || error), count: 0, rows: [] }));
    const osintPromise = this.osint.lookup(record).catch((error) => ({ status: 'error', reason: String(error?.message || error), count: 0, results: [], providers: {}, sources: {} }));
    const search_provider = await this.client.account();
    const providerUsability = this.client.accountUsable(search_provider);
    const serpUsable = this.client.isConfigured() && providerUsability.usable;
    if (serpUsable) {
      const executed = await this._executePlans(initialPlans);
      results.push(...executed.results);
      Object.assign(source_status, executed.source_status);
    } else {
      for (const source of SERP_SOURCES) source_status[source] = { status: this.client.isConfigured() ? 'error' : 'manual', reason: providerUsability.reason || 'SERPAPI_KEY is not configured', code: providerUsability.code || (this.client.isConfigured() ? 'SERPAPI_UNAVAILABLE' : 'SERPAPI_NOT_CONFIGURED'), queries: initialPlans.filter((p) => p.source === source).length, count: 0 };
    }

    const [whatsapp_profile, registry_profile, osint_profile] = await Promise.all([whatsappPromise, registryPromise, osintPromise]);
    const waResult = this._whatsappAsResult(record, whatsapp_profile);
    if (waResult) external.push(waResult);
    source_status.whatsapp = {
      status: whatsapp_profile?.status || 'disabled',
      queries: (record.phone || record.username) ? 1 : 0,
      count: waResult ? 1 : 0,
      reason: whatsapp_profile?.reason || '',
    };

    const registryResults = this._registryAsResults(registry_profile);
    external.push(...registryResults);
    source_status.registry = {
      status: registry_profile?.status || 'disabled',
      queries: registry_profile?.status === 'ok' ? 1 : 0,
      count: registryResults.length,
      reason: registry_profile?.reason || '',
      elapsed_ms: Number(registry_profile?.elapsed_ms || 0),
    };

    const osintResults = Array.isArray(osint_profile?.results) ? osint_profile.results : [];
    external.push(...osintResults);
    source_status.osint = {
      status: osint_profile?.status || 'disabled',
      queries: (record.username || record.phone || record.name) ? 1 : 0,
      count: osintResults.length,
      reason: osint_profile?.reason || '',
      providers: osint_profile?.providers || {},
    };
    for (const [source, status] of Object.entries(osint_profile?.sources || {})) {
      source_status[source] = { ...source_status[source], ...status, queries: Number(status.count || 0) ? 1 : 0 };
    }
    for (const source of ALL_SOURCES) {
      if (!SERP_SOURCES.includes(source) && source_status[source]?.status === 'pending') {
        source_status[source] = { status: 'disabled', queries: 0, count: 0, reason: 'Direct provider is not configured for this source' };
      }
    }

    if (record.image_url && serpUsable) {
      try {
        const lens = await this.client.lens(record.image_url);
        const imageRows = this._parseImageResults(lens).map((row) => ({ ...row, source: 'google_lens', provenance: [{ source: 'google_lens', intent: 'reverse_image', weight: 95 }] }));
        results.push(...imageRows);
      } catch (error) {
        external.push({ source: 'image', title: 'Google Lens failed', snippet: String(error?.message || error), url: '', rank_score: 1 });
      }
    }

    inspections = await this._inspectTop(results);
    results.push(...this._resultsFromInspections(inspections));
    let ranked = rankAndFilter(record, results, inspections, external);

    for (let round = 1; round <= this.expansionRounds && serpUsable; round++) {
      const expansion = EvidenceExpander.expansionPlans(record, ranked, seenPlans, Math.max(2, this.maxQueriesPerSource * 2), SERP_SOURCES);
      expansion_facts.push(...expansion.facts.map((fact) => ({ ...fact, round })));
      if (!expansion.plans.length) break;
      expansion_rounds_executed = round;
      const executed = await this._executePlans(expansion.plans);
      results.push(...executed.results);
      for (const [source, status] of Object.entries(executed.source_status)) {
        source_status[source] ||= { status: 'ok', queries: 0, count: 0 };
        source_status[source].queries += status.queries || 0;
        source_status[source].count += status.count || 0;
        if (status.status === 'error') source_status[source].status = source_status[source].status === 'ok' ? 'partial' : source_status[source].status;
      }
      const moreInspections = await this._inspectTop(executed.results);
      inspections.push(...moreInspections);
      results.push(...this._resultsFromInspections(moreInspections));
      ranked = rankAndFilter(record, results, inspections, external);
    }

    return {
      mode: 'node_web_graph',
      input: record,
      score: ranked.score,
      linked_accounts: ranked.linked_accounts,
      results: ranked.results,
      summary: ranked.summary,
      strong_sources: ranked.strong_sources,
      conflicts: ranked.conflicts,
      source_status,
      manual_links,
      query_plan: initialPlans,
      expansion_facts: expansion_facts.slice(0, 50),
      page_inspections: inspections.slice(0, 20),
      phone_intelligence,
      search_provider,
      whatsapp_profile,
      osint_profile: {
        status: osint_profile?.status || 'disabled',
        count: Number(osint_profile?.count || 0),
        providers: osint_profile?.providers || {},
      },
      registry_profile: {
        status: registry_profile?.status || 'disabled',
        count: Number(registry_profile?.count || 0),
        elapsed_ms: Number(registry_profile?.elapsed_ms || 0),
      },
      verification: {
        status: ranked.strong_sources.length >= 2 ? 'corroborated' : (ranked.strong_sources.length === 1 ? 'single_strong_source' : 'unverified'),
        strong_sources: ranked.strong_sources,
        strong_source_count: ranked.strong_sources.length,
        conflict_count: Number(ranked.summary?.conflict_count || 0),
        secondary_rounds: expansion_rounds_executed,
        registry_matches: registryResults.length,
        whatsapp_match: Boolean(waResult),
        osint_matches: osintResults.length,
      },
      generated_at: nowIso(),
    };
  }

  async _executePlans(plans) {
    const results = [];
    const source_status = {};
    await mapLimit(plans, 6, async (plan) => {
      try {
        const payload = await this.client.google(plan.query, this.maxResultsPerSource);
        const rows = this._parseOrganic(payload, plan).map((row) => ({ ...row, provenance: [{ source: plan.source, intent: plan.intent, query: plan.query, weight: plan.weight }] }));
        results.push(...rows);
        source_status[plan.source] ||= { status: 'ok', queries: 0, count: 0 };
        source_status[plan.source].queries += 1;
        source_status[plan.source].count += rows.length;
      } catch (error) {
        source_status[plan.source] = { status: 'error', queries: 0, count: 0, reason: String(error?.message || error).slice(0, 300), code: error?.code || '' };
      }
    });
    return { results, source_status };
  }

  _parseOrganic(payload, plan) {
    return (payload.organic_results || []).slice(0, this.maxResultsPerSource).map((item, index) => ({
      source: sourceFromUrl(item.link || '') || plan.source,
      search_source: plan.source,
      title: item.title || '',
      snippet: item.snippet || item.rich_snippet?.top?.detected_extensions?.join(' ') || '',
      url: item.link || '',
      position: item.position || index + 1,
      thumbnail: item.thumbnail || '',
    }));
  }

  _parseImageResults(payload) {
    return [...(payload.visual_matches || []), ...(payload.image_results || [])].slice(0, 10).map((item, index) => ({ title: item.title || 'Image match', snippet: item.source || '', url: item.link || item.source || '', thumbnail: item.thumbnail || item.image || '', position: index + 1 }));
  }

  async _inspectTop(rows) {
    const candidates = rows.filter((r) => r.url && /^https?:\/\//i.test(r.url)).slice(0, 8);
    return (await mapLimit(candidates, 3, async (row) => {
      try {
        const response = await fetch(row.url, { headers: { 'user-agent': 'Aharon-Search-Web/5.0' }, signal: AbortSignal.timeout(Math.min(30000, this.timeoutMs)) });
        const html = await response.text();
        const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 12000);
        const links = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]).filter((u) => /^https?:\/\//i.test(u)).slice(0, 80);
        const social_links = links.map((url) => ({ type: sourceFromUrl(url), handle: handleFromUrl(url), url })).filter((x) => x.type !== 'web' && x.handle);
        return { status: 'ok', url: row.url, text, social_links };
      } catch (error) {
        return { status: 'error', url: row.url, reason: String(error?.message || error).slice(0, 300), social_links: [] };
      }
    })).filter(Boolean);
  }

  _resultsFromInspections(inspections) {
    const rows = [];
    for (const inspection of inspections) {
      for (const link of inspection.social_links || []) rows.push({ source: link.type, title: link.handle, snippet: `נמצא כקישור בדף ${inspection.url}`, url: link.url, username: link.handle, provenance: [{ source: 'page_expansion', intent: 'social_link_on_page', weight: 86 }] });
    }
    return rows;
  }

  async _lookupRegistry(record) {
    if (!this.registry || typeof this.registry.searchEvidence !== 'function') {
      return { status: 'disabled', reason: 'registry_provider_unavailable', count: 0, rows: [] };
    }
    return this.registry.searchEvidence(record, 12);
  }

  _registryAsResults(profile) {
    if (!profile || profile.status !== 'ok') return [];
    return (profile.rows || []).slice(0, 12).map((row) => {
      const name = [row.F_NAME, row.L_NAME].filter(Boolean).join(' ').trim();
      const address = [row.city_name || row.ID_CITY || '', row.STREET || '', row.HOUSE || '', row.BAIT || ''].filter((x) => String(x).trim() !== '').join(' ');
      const parents = [
        row.FATHER_NAME ? `אב: ${row.FATHER_NAME}` : '',
        row.MOTHER_NAME ? `אם: ${row.MOTHER_NAME}` : '',
      ].filter(Boolean).join(' · ');
      const snippet = [
        row.ID != null ? `מזהה: ${row.ID}` : '',
        row.B_YEAR ? `שנת לידה: ${row.B_YEAR}` : '',
        parents,
        address ? `כתובת: ${address}` : '',
        (row.country_name || row.B_COUNTRY) ? `ארץ לידה: ${row.country_name || row.B_COUNTRY}` : '',
      ].filter(Boolean).join(' · ');
      const matchScore = Math.max(0, Math.min(100, Number(row._registry_match_score || 0)));
      return {
        source: 'registry',
        title: name || `רשומת מאגר ${row.ID || ''}`.trim(),
        snippet,
        url: '',
        name,
        registry_id: String(row.ID ?? ''),
        registry_match_type: row._registry_match_type || '',
        registry_match_score: matchScore,
        city_name: row.city_name || '',
        country_name: row.country_name || '',
        birth_year: row.B_YEAR || '',
        father_name: row.FATHER_NAME || '',
        mother_name: row.MOTHER_NAME || '',
        provenance: [{ source: 'registry', intent: row._registry_match_type || 'registry_match', weight: matchScore || 80 }],
      };
    });
  }

  async _lookupWhatsApp(record) {
    if (!this.whatsappEnabled || (!record.phone && !record.username)) return { status: 'disabled' };
    return this.whatsapp.lookup({ phone: record.phone, username: record.username });
  }

  _whatsappAsResult(record, profile) {
    if (!profile || profile.status !== 'ok' || !profile.registered) return null;
    const digits = String(profile.phone || '').replace(/\D+/g, '');
    const username = String(profile.username || record.username || '').replace(/^@/, '');
    return {
      source: 'whatsapp',
      title: profile.verified_name || profile.pushname || username || 'WhatsApp profile',
      snippet: [profile.about, username ? `username גלוי: @${username}` : '', profile.cross_check?.status ? `הצלבה: ${profile.cross_check.status}` : ''].filter(Boolean).join(' · '),
      url: username ? `https://wa.me/${username}` : (digits ? `https://wa.me/${digits}` : ''),
      name: profile.verified_name || profile.pushname || '',
      phone: digits,
      username,
      whatsapp_username: profile.username || '',
      registered: true,
      profile_image_url: profile.profile_picture_url || '',
      thumbnail: profile.profile_picture_url || '',
      provenance: [{ source: 'whatsapp', intent: 'linked_device_public_profile', weight: 99 }],
    };
  }
}