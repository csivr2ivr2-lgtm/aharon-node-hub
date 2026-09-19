function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let digits = raw.replace(/\D+/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length >= 9 && digits.length <= 10) digits = '972' + digits.slice(1);
  return digits ? `+${digits}` : '';
}

async function getJson(url, timeoutMs) {
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'Aharon-Search/OSINT-Hub' }, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch (_) {}
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
  return body;
}

export class PhoneInfogaProvider {
  constructor({ enabled = false, baseUrl = '', timeoutMs = 15000 } = {}) {
    this.enabled = Boolean(enabled && baseUrl);
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.timeoutMs = Math.max(3000, Math.min(60000, Number(timeoutMs || 15000)));
  }

  status() { return { enabled: this.enabled, base_url_configured: Boolean(this.baseUrl) }; }

  async lookup(record) {
    const phone = normalizePhone(record?.phone);
    if (!this.enabled) return { status: 'disabled', provider: 'phoneinfoga', results: [] };
    if (!phone) return { status: 'skipped', provider: 'phoneinfoga', reason: 'phone_required', results: [] };
    const encoded = encodeURIComponent(phone.replace(/^\+/, ''));
    const scanners = ['local', 'googlesearch', 'ovh', 'numverify'];
    const scans = {};
    await Promise.all(scanners.map(async (scanner) => {
      try { scans[scanner] = await getJson(`${this.baseUrl}/api/numbers/${encoded}/scan/${scanner}`, this.timeoutMs); }
      catch (error) { scans[scanner] = { success: false, error: String(error?.message || error) }; }
    }));

    const local = scans.local?.result || {};
    const numverify = scans.numverify?.result || {};
    const ovh = scans.ovh?.result || {};
    const results = [];
    if (local.e164 || numverify.number || ovh.found) {
      const snippet = [
        local.country ? `country=${local.country}` : '',
        numverify.carrier ? `carrier=${numverify.carrier}` : '',
        numverify.line_type ? `type=${numverify.line_type}` : '',
        numverify.location ? `location=${numverify.location}` : '',
        ovh.city ? `ovh_city=${ovh.city}` : '',
      ].filter(Boolean).join(' · ');
      results.push({
        source: 'phoneinfoga', title: local.e164 || phone, snippet, url: '', phone: local.e164 || phone,
        provenance: [{ source: 'phoneinfoga', intent: 'phone_metadata', weight: 72 }],
      });
    }
    const google = scans.googlesearch?.result || {};
    const links = [];
    const walk = (value) => {
      if (!value) return;
      if (typeof value === 'string' && /^https?:\/\//i.test(value)) links.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(google);
    for (const url of [...new Set(links)].slice(0, 20)) {
      results.push({ source: 'phoneinfoga', title: 'Phone footprint search', snippet: phone, url, phone, provenance: [{ source: 'phoneinfoga', intent: 'phone_web_footprint', weight: 60 }] });
    }
    return { status: 'ok', provider: 'phoneinfoga', phone, scans, count: results.length, results };
  }
}