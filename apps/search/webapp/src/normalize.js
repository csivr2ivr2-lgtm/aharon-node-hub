import { parsePhoneNumberFromString } from 'libphonenumber-js';

export function nowIso() {
  return new Date().toISOString();
}

export function cleanText(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

export function normalizeText(value) {
  return String(value ?? '').toLocaleLowerCase('he-IL').replace(/[^\p{L}\p{N}]+/gu, '');
}

export function normalizeUsername(value) {
  const text = cleanText(value, 80).replace(/^@/, '');
  if (!text || text.includes('@') || /\s/.test(text)) return '';
  return /^[A-Za-z0-9._-]{2,64}$/.test(text) ? text : '';
}

export function normalizeInput(data = {}) {
  const firstName = cleanText(data.first_name, 80);
  const lastName = cleanText(data.last_name, 80);
  const record = {
    name: [firstName, lastName].filter(Boolean).join(' ') || cleanText(data.name),
    alias: cleanText(data.alias || data.nickname || data.business_name, 120),
    phone: cleanText(data.phone),
    username: normalizeUsername(data.username || data.user),
    text: cleanText(data.text || data.query),
    image_url: cleanText(data.image_url || data.imageUrl || data.image),
    id: cleanText(data.id || data.registry_id, 20),
    first_name: firstName,
    last_name: lastName,
    father_id: cleanText(data.father_id, 20),
    mother_id: cleanText(data.mother_id, 20),
    city_id: cleanText(data.city_id, 20),
    city_name: cleanText(data.city_name || data.city, 80),
    street: cleanText(data.street, 80),
    country_id: cleanText(data.country_id, 20),
    country_name: cleanText(data.country_name || data.country, 80),
    birth_year: cleanText(data.birth_year, 4),
    birth_date: cleanText(data.birth_date, 20),
  };
  if (record.image_url && !/^https?:\/\//i.test(record.image_url)) record.image_url = '';
  if (!Object.values(record).some(Boolean)) {
    throw new Error('צריך להזין לפחות פרט אחד לחיפוש');
  }
  return record;
}

export function phoneInfo(raw, defaultCountry = 'IL') {
  const input = cleanText(raw, 80);
  if (!input) return { status: 'empty', input: '' };
  let parsed = null;
  try {
    parsed = parsePhoneNumberFromString(input, input.startsWith('+') ? undefined : defaultCountry);
  } catch (_) {}
  if (!parsed) return { status: 'invalid', input };
  const possible = parsed.isPossible();
  const valid = parsed.isValid();
  const e164 = parsed.number || '';
  return {
    status: 'ok',
    input,
    possible,
    valid,
    e164,
    international: parsed.formatInternational(),
    national: parsed.formatNational(),
    country_code: Number(parsed.countryCallingCode || 0),
    national_number: parsed.nationalNumber || '',
    region_code: parsed.country || '',
    number_type: parsed.getType?.() || 'unknown',
    whatsapp_msisdn: e164.replace(/\D+/g, ''),
    metadata_source: 'libphonenumber-js metadata',
    limitations: [
      'carrier/location are numbering-plan metadata only',
      'no subscriber identity is inferred',
    ],
  };
}

export function digitsOnly(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

function parseCandidatePhone(raw, defaultCountry = 'IL') {
  const text = String(raw || '').trim();
  const digits = digitsOnly(text);
  if (digits.length < 7 || digits.length > 15) return null;
  let parsed = null;
  try {
    const parseAs = text.startsWith('+') ? text : (digits.startsWith('972') ? `+${digits}` : text);
    parsed = parsePhoneNumberFromString(parseAs, parseAs.startsWith('+') ? undefined : defaultCountry);
  } catch (_) {}
  if (!parsed || !parsed.number) return null;
  return {
    raw: text,
    digits,
    e164: parsed.number,
    msisdn: digitsOnly(parsed.number),
    country_code: Number(parsed.countryCallingCode || 0),
    national_number: parsed.nationalNumber || '',
    region_code: parsed.country || '',
  };
}

export function extractPhoneCandidates(text, defaultCountry = 'IL') {
  const value = String(text || '');
  const candidates = [];
  const seen = new Set();
  const patterns = [
    /\+?\d[\d\s().-]{5,}\d/g,
    /(?<!\d)\d{7,15}(?!\d)/g,
  ];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const parsed = parseCandidatePhone(match[0], defaultCountry);
      if (!parsed) continue;
      const key = `${parsed.e164}:${parsed.raw}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(parsed);
    }
  }
  return candidates;
}

export function phoneMatch(rawPhone, haystack, defaultCountry = 'IL') {
  const target = phoneInfo(rawPhone, defaultCountry);
  if (target.status !== 'ok' || !target.e164) {
    return { matched: false, matches: [], collisions: [], candidates: [], reason: 'invalid_target_phone' };
  }

  const targetMsisdn = target.whatsapp_msisdn;
  const targetNational = target.national_number || '';
  const candidates = extractPhoneCandidates(haystack, defaultCountry);
  const matches = [];
  const collisions = [];

  for (const candidate of candidates) {
    if (candidate.e164 === target.e164 || candidate.msisdn === targetMsisdn) {
      matches.push(candidate);
      continue;
    }
    const sameTail = targetNational && (
      candidate.national_number === targetNational ||
      candidate.msisdn.endsWith(targetNational)
    );
    if (sameTail) collisions.push(candidate);
  }

  return {
    matched: matches.length > 0,
    matches,
    collisions,
    candidates,
    reason: matches.length ? 'exact_e164_or_local_match' : (collisions.length ? 'same_digits_different_country' : 'not_found'),
  };
}

export function phoneVariants(raw) {
  const info = phoneInfo(raw);
  const set = new Set();
  const digits = digitsOnly(raw);
  if (digits) set.add(digits);
  if (info.status === 'ok') {
    set.add(info.e164);
    set.add(info.whatsapp_msisdn);
    if (info.region_code === 'IL' && info.national_number) set.add('0' + info.national_number);
    const spaced = info.national?.replace(/[\s-]+/g, '');
    if (spaced) set.add(spaced);
  } else if (digits.startsWith('0') && digits.length >= 9) {
    set.add('972' + digits.slice(1));
    set.add('+972' + digits.slice(1));
  }
  return [...set].filter(Boolean);
}

export function nameScore(name, haystack) {
  const wanted = normalizeText(name);
  const hay = normalizeText(haystack);
  if (!wanted || !hay) return 0;
  if (hay.includes(wanted)) return 100;
  const tokens = String(name).split(/\s+/).map(normalizeText).filter((x) => x.length >= 2);
  if (!tokens.length) return 0;
  return Math.round(tokens.filter((token) => hay.includes(token)).length / tokens.length * 100);
}

export function canonicalUrl(url) {
  try {
    const parsed = new URL(String(url));
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString();
  } catch (_) {
    return String(url || '');
  }
}