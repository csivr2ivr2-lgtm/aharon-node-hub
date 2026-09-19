import mysql from 'mysql2/promise';

function cleanText(value, limit = 80) {
  return String(value ?? '').trim().slice(0, limit);
}

function cleanInt(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (!/^-?\d+$/.test(text)) throw new Error(`ערך מספרי לא תקין: ${text}`);
  const n = Number(text);
  if (!Number.isSafeInteger(n)) throw new Error('ערך מספרי גדול מדי');
  return n;
}

function birthDateCandidates(value) {
  const text = cleanText(value, 20);
  if (!text) return [];
  const out = new Set();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) out.add(`${match[1]}${match[2]}${match[3]}`);
  match = text.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
  if (match) out.add(`${match[3]}${match[2]}${match[1]}`);
  const digits = text.replace(/\D+/g, '');
  if (/^\d{8}$/.test(digits)) {
    out.add(digits);
    if (!/^(?:19|20)/.test(digits) && /^(?:19|20)/.test(digits.slice(4))) {
      out.add(`${digits.slice(4)}${digits.slice(2, 4)}${digits.slice(0, 2)}`);
    }
  }
  return [...out].filter((x) => /^(?:19|20)\d{6}$/.test(x));
}

export class RegistryMysqlProvider {
  constructor({ enabled = false, host = '', port = 3306, user = '', password = '', database = '', connectionLimit = 4, connectTimeout = 10000 } = {}) {
    this.enabled = Boolean(enabled);
    this.configured = this.enabled && Boolean(host && user && database);
    this.pool = null;
    if (this.configured) {
      this.pool = mysql.createPool({
        host,
        port: Number(port || 3306),
        user,
        password,
        database,
        waitForConnections: true,
        connectionLimit: Math.max(1, Math.min(10, Number(connectionLimit || 4))),
        queueLimit: 16,
        connectTimeout: Math.max(3000, Math.min(30000, Number(connectTimeout || 10000))),
        charset: 'utf8mb4',
        namedPlaceholders: false,
      });
    }
  }

  status() {
    return { enabled: this.enabled, configured: this.configured };
  }

  async health() {
    if (!this.configured) return { ...this.status(), connected: false };
    try {
      const [rows] = await this.pool.query('SELECT 1 AS ok');
      return { ...this.status(), connected: rows?.[0]?.ok === 1 };
    } catch (error) {
      return { ...this.status(), connected: false, error: String(error?.code || error?.message || error).slice(0, 160) };
    }
  }

  async resolveCityName(name) {
    if (!this.configured) throw new Error('REGISTRY_DB_NOT_CONFIGURED');
    const cityName = cleanText(name, 80);
    if (!cityName) return { input: '', matched: false, exact: false, rows: [] };

    const [exactRows] = await this.pool.execute(
      'SELECT `ID`, `NAME_CITY` FROM `CITY` WHERE `NAME_CITY` COLLATE utf8mb4_uca1400_ai_ci = (CONVERT(? USING utf8mb4) COLLATE utf8mb4_uca1400_ai_ci) ORDER BY `ID` LIMIT 10',
      [cityName],
    );
    if (exactRows.length) {
      return { input: cityName, matched: true, exact: true, rows: exactRows };
    }

    const [prefixRows] = await this.pool.execute(
      'SELECT `ID`, `NAME_CITY` FROM `CITY` WHERE `NAME_CITY` COLLATE utf8mb4_uca1400_ai_ci LIKE (CONCAT(CONVERT(? USING utf8mb4), _utf8mb4\'%\') COLLATE utf8mb4_uca1400_ai_ci) ORDER BY `NAME_CITY`, `ID` LIMIT 10',
      [cityName],
    );
    return { input: cityName, matched: prefixRows.length > 0, exact: false, rows: prefixRows };
  }

  async resolveCountryName(name) {
    if (!this.configured) throw new Error('REGISTRY_DB_NOT_CONFIGURED');
    const countryName = cleanText(name, 80);
    if (!countryName) return { input: '', matched: false, exact: false, rows: [] };

    const [exactRows] = await this.pool.execute(
      'SELECT `ID`, `NAME_HEB`, `NAME_ENG` FROM `COUNTRY` WHERE `NAME_HEB` COLLATE utf8mb4_uca1400_ai_ci = (CONVERT(? USING utf8mb4) COLLATE utf8mb4_uca1400_ai_ci) OR `NAME_ENG` COLLATE utf8mb4_uca1400_ai_ci = (CONVERT(? USING utf8mb4) COLLATE utf8mb4_uca1400_ai_ci) ORDER BY `ID` LIMIT 10',
      [countryName, countryName],
    );
    if (exactRows.length) {
      return { input: countryName, matched: true, exact: true, rows: exactRows };
    }

    const [prefixRows] = await this.pool.execute(
      'SELECT `ID`, `NAME_HEB`, `NAME_ENG` FROM `COUNTRY` WHERE `NAME_HEB` COLLATE utf8mb4_uca1400_ai_ci LIKE (CONCAT(CONVERT(? USING utf8mb4), _utf8mb4\'%\') COLLATE utf8mb4_uca1400_ai_ci) OR `NAME_ENG` COLLATE utf8mb4_uca1400_ai_ci LIKE (CONCAT(CONVERT(? USING utf8mb4), _utf8mb4\'%\') COLLATE utf8mb4_uca1400_ai_ci) ORDER BY `NAME_HEB`, `NAME_ENG`, `ID` LIMIT 10',
      [countryName, countryName],
    );
    return { input: countryName, matched: prefixRows.length > 0, exact: false, rows: prefixRows };
  }

  async search(input = {}) {
    if (!this.configured) throw new Error('REGISTRY_DB_NOT_CONFIGURED');

    const id = cleanInt(input.id);
    const fatherId = cleanInt(input.father_id);
    const motherId = cleanInt(input.mother_id);
    const cityId = cleanInt(input.city_id);
    const cityName = cleanText(input.city_name || input.city, 80);
    const countryId = cleanInt(input.country_id);
    const countryName = cleanText(input.country_name || input.country, 80);
    const firstName = cleanText(input.first_name, 40);
    const lastName = cleanText(input.last_name, 50);
    const street = cleanText(input.street, 60);
    const birthYear = cleanText(input.birth_year, 4);
    const birthDate = cleanText(input.birth_date, 20);
    const birthDates = birthDateCandidates(birthDate);
    const limit = Math.max(1, Math.min(100, Number(input.limit || 50)));
    const cityResolution = cityName ? await this.resolveCityName(cityName) : null;
    const countryResolution = countryName ? await this.resolveCountryName(countryName) : null;

    const where = [];
    const params = [];
    let indexedPredicate = false;

    const eq = (sql, value, indexed = true) => {
      if (value === null || value === '') return;
      where.push(sql);
      params.push(value);
      indexedPredicate ||= indexed;
    };

    eq('m.`ID` = ?', id);
    eq('m.`L_NAME` = ?', lastName);
    eq('m.`F_NAME` = ?', firstName);
    eq('m.`ID_FATHER` = ?', fatherId);
    eq('m.`ID_MOTHER` = ?', motherId);
    eq('m.`ID_CITY` = ?', cityId);
    if (cityName) {
      const ids = (cityResolution?.rows || []).map((row) => Number(row.ID)).filter(Number.isSafeInteger);
      if (!ids.length) {
        return { status: 'ok', count: 0, limit, elapsed_ms: 0, city_resolution: cityResolution, country_resolution: countryResolution, rows: [] };
      }
      where.push(`m.\`ID_CITY\` IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
      indexedPredicate = true;
    }
    eq('m.`STREET` = ?', street);
    eq('m.`B_COUNTRY` = ?', countryId);
    if (countryName) {
      const ids = (countryResolution?.rows || []).map((row) => Number(row.ID)).filter(Number.isSafeInteger);
      if (!ids.length) {
        return { status: 'ok', count: 0, limit, elapsed_ms: 0, city_resolution: cityResolution, country_resolution: countryResolution, rows: [] };
      }
      where.push(`m.\`B_COUNTRY\` IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
      indexedPredicate = true;
    }
    if (birthDate) {
      if (!birthDates.length) throw new Error('תאריך לידה לא תקין');
      where.push(`CAST(m.\`B_YEAR\` AS UNSIGNED) IN (${birthDates.map(() => '?').join(',')})`);
      params.push(...birthDates.map(Number));
    }
    if (birthYear) {
      if (!/^\d{4}$/.test(birthYear)) throw new Error('שנת לידה חייבת להיות 4 ספרות');
      where.push('CAST(LEFT(m.`B_YEAR`, 4) AS UNSIGNED) = ?');
      params.push(Number(birthYear));
    }

    if (!where.length) throw new Error('צריך להזין לפחות שדה חיפוש אחד במאגר');
    if (!indexedPredicate) throw new Error('חיפוש לפי תאריך/שנת לידה בלבד חסום כדי למנוע סריקה מלאה של המאגר');

    const sql = `
      SELECT
        m.\`ID\`, m.\`L_NAME\`, m.\`F_NAME\`, m.\`F_NAME_OLD\`, m.\`B_YEAR\`,
        m.\`ID_MAT_STATUS\`, m.\`FATHER_NAME\`, m.\`MOTHER_NAME\`,
        m.\`ID_FATHER\`, m.\`ID_MOTHER\`, m.\`B_COUNTRY\`, m.\`ID_CITY\`,
        m.\`STREET\`, m.\`HOUSE\`, m.\`BAIT\`,
        c.\`NAME_CITY\` AS city_name,
        co.\`NAME_HEB\` AS country_name
      FROM \`M\` m
      LEFT JOIN \`CITY\` c ON c.\`ID\` = m.\`ID_CITY\`
      LEFT JOIN \`COUNTRY\` co ON co.\`ID\` = m.\`B_COUNTRY\`
      WHERE ${where.join(' AND ')}
      LIMIT ?`;
    params.push(limit);

    const started = Date.now();
    const [rows] = await this.pool.execute(sql, params);
    return {
      status: 'ok',
      count: rows.length,
      limit,
      elapsed_ms: Date.now() - started,
      city_resolution: cityResolution,
      country_resolution: countryResolution,
      rows,
    };
  }

  async searchEvidence(input = {}, limit = 12) {
    if (!this.configured) return { status: 'disabled', count: 0, rows: [] };

    const cap = Math.max(1, Math.min(25, Number(limit || 12)));
    const attempts = [];
    const common = {
      father_id: input.father_id || '',
      mother_id: input.mother_id || '',
      city_id: input.city_id || '',
      city_name: input.city_name || input.city || '',
      street: input.street || '',
      country_id: input.country_id || '',
      country_name: input.country_name || input.country || '',
      birth_year: input.birth_year || '',
      birth_date: input.birth_date || '',
    };
    const addAttempt = (payload, matchType, matchScore) => {
      const key = JSON.stringify(payload);
      if (!attempts.some((x) => x.key === key)) attempts.push({ key, payload, matchType, matchScore });
    };

    if (input.id) {
      addAttempt({ id: input.id, limit: Math.min(5, cap) }, 'id', 100);
    }

    const hasRelationship = Boolean(input.father_id || input.mother_id);
    const hasAddressPair = Boolean((input.city_id || input.city_name || input.city) && input.street);
    const hasIndexedContext = Boolean(input.city_id || input.city_name || input.city || input.street || input.country_id || input.country_name || input.country);
    const explicitName = Boolean(input.first_name || input.last_name);
    if (hasRelationship || hasAddressPair || hasIndexedContext || explicitName) {
      addAttempt({
        ...common,
        first_name: input.first_name || '',
        last_name: input.last_name || '',
        limit: cap,
      }, hasRelationship ? 'family_relation' : (hasAddressPair ? 'address' : (explicitName ? 'structured_name' : 'structured_context')), hasRelationship ? 92 : (hasAddressPair ? 86 : (explicitName ? 88 : 76)));
    }

    const name = cleanText(input.name, 120);
    if (name && !explicitName) {
      const tokens = name.split(/\s+/).filter(Boolean);
      if (tokens.length >= 2) {
        addAttempt({
          ...common,
          first_name: tokens[0],
          last_name: tokens.slice(1).join(' '),
          limit: cap,
        }, 'name', 88);
        addAttempt({
          ...common,
          first_name: tokens[tokens.length - 1],
          last_name: tokens.slice(0, -1).join(' '),
          limit: cap,
        }, 'name_reversed', 82);
      } else if (tokens.length === 1) {
        addAttempt({ ...common, first_name: tokens[0], limit: Math.min(10, cap) }, 'first_name', 66);
        addAttempt({ ...common, last_name: tokens[0], limit: Math.min(10, cap) }, 'last_name', 66);
      }
    }

    if (!attempts.length) {
      return { status: 'skipped', reason: 'no_precise_registry_predicate', count: 0, rows: [] };
    }

    const deduped = new Map();
    let elapsed = 0;
    for (const attempt of attempts.slice(0, 3)) {
      const result = await this.search(attempt.payload);
      elapsed += Number(result.elapsed_ms || 0);
      for (const row of result.rows || []) {
        const key = String(row.ID ?? '');
        if (!key) continue;
        const current = deduped.get(key);
        const enriched = {
          ...row,
          _registry_match_type: attempt.matchType,
          _registry_match_score: attempt.matchScore,
        };
        if (!current || Number(enriched._registry_match_score) > Number(current._registry_match_score)) {
          deduped.set(key, enriched);
        }
        if (deduped.size >= cap) break;
      }
      if (deduped.size >= cap) break;
    }

    const rows = [...deduped.values()]
      .sort((a, b) => Number(b._registry_match_score || 0) - Number(a._registry_match_score || 0))
      .slice(0, cap);

    return {
      status: 'ok',
      count: rows.length,
      elapsed_ms: elapsed,
      rows,
    };
  }

  async close() {
    if (this.pool) await this.pool.end();
  }
}