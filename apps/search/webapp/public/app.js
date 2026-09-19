const $ = (id) => document.getElementById(id);
const tokenKey = 'aharon_search_admin_token';
let authRequired = false;
let connectTimer = null;
let selectedImageFile = null;

function authHeaders() {
  const token = localStorage.getItem(tokenKey) || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...authHeaders(), ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.reason || data.error || `HTTP ${res.status}`);
  return data;
}

async function init() {
  const cfg = await api('/search/api/client-config');
  authRequired = cfg.auth_required;
  $('authBox').classList.toggle('hidden', !authRequired || Boolean(localStorage.getItem(tokenKey)));
  if ($('registryTabBtn')) $('registryTabBtn').classList.toggle('hidden', !cfg.registry_enabled);
  if (!cfg.registry_enabled && $('registryView')) $('registryView').classList.add('hidden');
  setupTabs();
  setupImageDrop();
  await refreshHealth();
}

function setupTabs() {
  const activate = (view) => {
    const search = view !== 'registry';
    $('searchView')?.classList.toggle('hidden', !search);
    $('registryView')?.classList.toggle('hidden', search);
    $('searchTabBtn')?.classList.toggle('active', search);
    $('registryTabBtn')?.classList.toggle('active', !search);
    $('searchTabBtn')?.setAttribute('aria-selected', String(search));
    $('registryTabBtn')?.setAttribute('aria-selected', String(!search));
  };
  $('searchTabBtn')?.addEventListener('click', () => activate('search'));
  $('registryTabBtn')?.addEventListener('click', () => activate('registry'));
  activate('search');
}

function setupImageDrop() {
  const zone = $('imageDropZone');
  const input = $('imageFile');
  if (!zone || !input) return;
  const choose = () => input.click();
  zone.addEventListener('click', choose);
  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); }
  });
  input.addEventListener('change', () => setImageFile(input.files?.[0] || null));
  for (const name of ['dragenter', 'dragover']) zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.add('dragover'); });
  for (const name of ['dragleave', 'drop']) zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.remove('dragover'); });
  zone.addEventListener('drop', (event) => setImageFile(event.dataTransfer?.files?.[0] || null));
}

function setImageFile(file) {
  const status = $('imageUploadStatus');
  const preview = $('imagePreview');
  if (!file) {
    selectedImageFile = null;
    status.textContent = '';
    preview.classList.add('hidden');
    preview.removeAttribute('src');
    return;
  }
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) {
    selectedImageFile = null;
    status.textContent = 'סוג קובץ לא נתמך. השתמש ב-JPG, PNG או WEBP.';
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    selectedImageFile = null;
    status.textContent = 'התמונה גדולה מ-8MB.';
    return;
  }
  selectedImageFile = file;
  status.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)}MB`;
  preview.src = URL.createObjectURL(file);
  preview.classList.remove('hidden');
  $('imageDropZone')?.classList.remove('uploaded');
}

async function uploadSelectedImage() {
  if (!selectedImageFile) return '';
  const status = $('imageUploadStatus');
  status.textContent = 'מעלה תמונה זמנית...';
  const form = new FormData();
  form.append('image', selectedImageFile);
  const res = await fetch('/search/api/image-upload', { method: 'POST', headers: authHeaders(), body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.reason || data.error || `HTTP ${res.status}`);
  status.textContent = 'התמונה הועלתה ותשמש בחיפוש';
  $('imageDropZone')?.classList.add('uploaded');
  return data.image_url || '';
}

async function refreshHealth() {
  try {
    const h = await api('/search/api/health');
    const wa = h.whatsapp || {};
    const text = wa.connected ? 'המערכת פעילה · WhatsApp מחובר עכשיו' : (wa.session_ready ? 'המערכת פעילה · WhatsApp מוגדר ומוכן לבדיקה' : (wa.connecting ? 'מתבצע חיבור WhatsApp...' : 'המערכת פעילה · נדרש חיבור WhatsApp'));
    $('healthText').textContent = text;
    renderWhatsAppSetup(wa);
  } catch (error) {
    $('healthText').textContent = error.message;
  }
}

function renderWhatsAppSetup(status = {}) {
  const ready = Boolean(status.session_ready || status.connected || status.ready_for_lookup);
  $('waConnectedBox').classList.toggle('hidden', !ready);
  $('waSetupBox').classList.toggle('hidden', ready);
  if (ready) $('connectBox').innerHTML = '';
}

$('saveToken').onclick = () => {
  localStorage.setItem(tokenKey, $('tokenInput').value.trim());
  $('authBox').classList.add('hidden');
  refreshHealth();
};

$('settingsBtn').onclick = () => { $('settingsDialog').showModal(); refreshHealth(); };
$('refreshWa').onclick = refreshHealth;
$('connectQr').onclick = () => startWhatsAppConnect('qr');
$('connectCode').onclick = () => startWhatsAppConnect('code');

async function startWhatsAppConnect(mode) {
  clearInterval(connectTimer);
  const phone = $('waPhone').value.trim();
  $('connectBox').textContent = mode === 'code' ? 'מבקש קוד חיבור...' : 'מכין QR...';
  try {
    const body = mode === 'code' ? { mode, phone } : { mode };
    await api('/search/api/whatsapp/connect/start', { method: 'POST', body: JSON.stringify(body) });
    pollConnectStatus(mode);
  } catch (error) {
    $('connectBox').textContent = error.message;
  }
}

function pollConnectStatus(mode) {
  const started = Date.now();
  connectTimer = setInterval(async () => {
    try {
      const status = await api('/search/api/whatsapp/connect/status');
      if (status.pairing_code) {
        $('connectBox').innerHTML = `<div class="qr-text">ב־WhatsApp: מכשירים מקושרים → קישור באמצעות מספר טלפון</div><div class="pair-code">${escapeHtml(status.pairing_code)}</div><p class="muted">הזן את הקוד הזה בטלפון שמחובר לחשבון.</p>`;
      } else if (status.qr && mode !== 'code') {
        $('connectBox').innerHTML = `<div class="qr-text">סרוק ב־WhatsApp → מכשירים מקושרים</div><textarea readonly>${escapeHtml(status.qr)}</textarea>`;
      } else if (!status.session_ready && !status.connected) {
        $('connectBox').textContent = status.last_error || (mode === 'code' ? 'ממתין לקוד חיבור...' : 'ממתין לסריקה...');
      }
      if (status.session_ready || status.connected) {
        clearInterval(connectTimer);
        $('connectBox').innerHTML = '';
        await refreshHealth();
        setTimeout(() => { if ($('settingsDialog').open) $('settingsDialog').close(); }, 900);
      }
      if (Date.now() - started > 300000) {
        clearInterval(connectTimer);
        $('connectBox').textContent = status.last_error || 'החיבור לא הושלם בזמן. נסה שוב.';
      }
    } catch (error) {
      clearInterval(connectTimer);
      $('connectBox').textContent = error.message;
    }
  }, 1500);
}

$('registryForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  $('registryStatus').textContent = 'מחפש...';
  $('registryResults').innerHTML = '';
  $('registryCityResolution').textContent = '';
  $('registryCountryResolution').textContent = '';
  const body = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    const data = await api('/search/api/registry/search', { method: 'POST', body: JSON.stringify(body) });
    $('registryStatus').textContent = `${data.count || 0} תוצאות · ${data.elapsed_ms || 0}ms`;
    const resolution = data.city_resolution;
    if (resolution?.input) {
      const names = (resolution.rows || []).map((row) => `${row.NAME_CITY} (#${row.ID})`).join(', ');
      $('registryCityResolution').textContent = resolution.matched
        ? `המרת עיר: ${resolution.input} → ${names}${resolution.exact ? '' : ' (התאמת תחילית)'}`
        : `לא נמצא קוד עיר עבור: ${resolution.input}`;
    }
    const countryResolution = data.country_resolution;
    if (countryResolution?.input) {
      const names = (countryResolution.rows || []).map((row) => `${row.NAME_HEB || row.NAME_ENG || ''} (#${row.ID})`).join(', ');
      $('registryCountryResolution').textContent = countryResolution.matched
        ? `המרת ארץ לידה: ${countryResolution.input} → ${names}${countryResolution.exact ? '' : ' (התאמת תחילית)'}`
        : `לא נמצא קוד ארץ עבור: ${countryResolution.input}`;
    }
    $('registryResults').innerHTML = (data.rows || []).map(renderRegistryRow).join('');
  } catch (error) {
    $('registryStatus').textContent = `שגיאה: ${error.message}`;
  }
});

function formatBirthDate(value) {
  const raw = String(value ?? '').trim();
  const digits = raw.replace(/\D+/g, '');
  if (/^(?:19|20)\d{6}$/.test(digits)) {
    return `${digits.slice(6, 8)}/${digits.slice(4, 6)}/${digits.slice(0, 4)}`;
  }
  return raw;
}

function renderRegistryRow(row) {
  const name = [row.F_NAME, row.L_NAME].filter(Boolean).join(' ') || `רשומה ${row.ID || ''}`;
  const city = row.city_name || row.ID_CITY || '';
  const country = row.country_name || row.B_COUNTRY || '';
  const field = (label, value, { ltr = false, wide = false } = {}) => {
    if (value === null || value === undefined || String(value).trim() === '') return '';
    return `<div class="registry-field${wide ? ' wide' : ''}"><span class="registry-field-label">${escapeHtml(label)}</span><strong${ltr ? ' dir="ltr"' : ''}>${escapeHtml(value)}</strong></div>`;
  };

  const fields = [
    field('תאריך לידה', formatBirthDate(row.B_YEAR), { ltr: true }),
    field('שנת לידה', String(row.B_YEAR || '').slice(0, 4), { ltr: true }),
    field('עיר', city),
    field('רחוב', row.STREET),
    field('מספר בית', row.HOUSE, { ltr: true }),
    field('דירה / בית', row.BAIT, { ltr: true }),
    field('ארץ לידה', country),
    field('שם האב', row.FATHER_NAME),
    field('תעודת זהות אב', row.ID_FATHER, { ltr: true }),
    field('שם האם', row.MOTHER_NAME),
    field('תעודת זהות אם', row.ID_MOTHER, { ltr: true }),
  ].filter(Boolean).join('');

  return `
    <article class="registry-result" dir="rtl">
      <div class="registry-result-head">
        <div class="registry-person">
          <span class="registry-kicker">רשומת מאגר</span>
          <h3>${escapeHtml(name)}</h3>
        </div>
        ${row.ID != null ? `<div class="registry-id"><span>תעודת זהות</span><strong dir="ltr">${escapeHtml(row.ID)}</strong></div>` : ''}
      </div>
      <div class="registry-detail-grid">${fields || '<div class="registry-empty">אין פרטים נוספים להצגה</div>'}</div>
    </article>`;
}

$('searchForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('summary').textContent = 'בודק ומצליב ממצאים...';
  $('score').textContent = '...';
  $('linksBody').innerHTML = '';
  $('results').innerHTML = '';
  const form = new FormData(event.currentTarget);
  const body = Object.fromEntries(form.entries());
  try {
    if (selectedImageFile) {
      const uploadedUrl = await uploadSelectedImage();
      if (uploadedUrl) {
        body.image_url = uploadedUrl;
        if ($('imageUrl')) $('imageUrl').value = uploadedUrl;
      }
    }
    const data = await api('/search/api/search', { method: 'POST', body: JSON.stringify(body) });
    render(data);
  } catch (error) {
    $('summary').textContent = `שגיאה: ${error.message}`;
    $('score').textContent = 'ERR';
  }
});

function render(data) {
  $('score').textContent = `${data.score || 1}/100`;
  const s = data.summary || {};
  $('summary').textContent = `${s.result_count || 0} תוצאות מתאימות · ${s.linked_count || 0} ממצאים מרכזיים · ${s.filtered_count || 0} תוצאות לא רלוונטיות הוסרו`;
  renderSourceStatus(data.source_status || {}, data.verification || {});
  const chips = [];
  const chipKeys = new Set();
  const addChip = (value) => {
    const text = String(value || '').trim();
    const key = text.toLowerCase();
    if (!text || chipKeys.has(key)) return;
    chipKeys.add(key);
    chips.push(text);
  };
  if (data.phone_intelligence?.e164) addChip(data.phone_intelligence.e164);
  if (data.whatsapp_profile?.registered) addChip('WhatsApp נמצא');
  if (data.whatsapp_profile?.status === 'ok' && data.whatsapp_profile?.registered === false) addChip('WhatsApp לא נמצא');
  for (const fact of (data.expansion_facts || [])) {
    if (chips.length >= 6) break;
    addChip(`${factLabel(fact.type)}: ${formatFactValue(fact.value)}`);
  }
  $('chips').innerHTML = chips.map((x) => `<span>${escapeHtml(x)}</span>`).join(' ');
  $('linkedCount').textContent = `${data.linked_accounts?.length || 0}`;
  $('linksBody').innerHTML = (data.linked_accounts || []).map((x) => `<tr><td>${escapeHtml(x.type)}</td><td>${x.score}</td><td>${x.verified ? 'חזק' : 'נמצא'}</td><td>${escapeHtml(x.label)}</td><td><a href="${escapeAttr(x.url)}" target="_blank" rel="noreferrer">פתיחה</a></td></tr>`).join('');
  $('resultCount').textContent = `${data.results?.length || 0}`;
  $('results').innerHTML = (data.results || []).map((x) => `<article class="result"><div class="result-score">${x.rank_score}</div><div><h3>${escapeHtml(x.title || x.url || x.source)}</h3><p>${escapeHtml(x.snippet || '')}</p><p class="reason">${escapeHtml((x.rank_reasons || []).join(' · '))}</p>${x.url ? `<a href="${escapeAttr(x.url)}" target="_blank" rel="noreferrer">${escapeHtml(x.url)}</a>` : ''}</div></article>`).join('');
}

function renderSourceStatus(statuses = {}, verification = {}) {
  const labels = {
    web: 'Web', forums: 'פורומים', instagram: 'Instagram', facebook: 'Facebook', x: 'X', tiktok: 'TikTok', linkedin: 'LinkedIn', reddit: 'Reddit', youtube: 'YouTube', github: 'GitHub', whatsapp: 'WhatsApp', registry: 'מאגר פנימי',
  };
  const stateLabel = { ok: 'נבדק', manual: 'ידני', pending: 'ממתין', disabled: 'כבוי', skipped: 'דולג', error: 'שגיאה', partial: 'חלקי' };
  const ordered = ['registry', 'whatsapp', 'web', 'forums', 'instagram', 'facebook', 'x', 'tiktok', 'reddit', 'linkedin', 'youtube', 'github'];
  $('sourceStatus').innerHTML = ordered.filter((key) => statuses[key]).map((key) => {
    const st = statuses[key] || {};
    const suffix = Number(st.count || 0) ? ` · ${Number(st.count || 0)}` : '';
    const text = `${labels[key] || key}: ${stateLabel[st.status] || st.status || '—'}${suffix}`;
    const title = st.reason ? ` title="${escapeAttr(st.reason)}"` : '';
    return `<span class="source-chip state-${escapeAttr(st.status || 'unknown')}"${title}>${escapeHtml(text)}</span>`;
  }).join(' ');
  const strong = Array.isArray(verification.strong_sources) ? verification.strong_sources : [];
  const verified = verification.status === 'corroborated';
  $('verificationBadge').textContent = verified ? 'מאומת ממספר מקורות' : (verification.status === 'single_strong_source' ? 'מקור חזק אחד' : 'טרם אומת');
  $('verificationText').textContent = `מקורות חזקים: ${strong.length ? strong.map((x) => labels[x] || x).join(', ') : 'אין'} · סבבי חיפוש משני: ${verification.secondary_rounds || 0} · התאמות מאגר: ${verification.registry_matches || 0} · סתירות: ${verification.conflict_count || 0}`;
}

function formatFactValue(value) {
  const raw = String(value ?? '').trim();
  const digits = raw.replace(/\D+/g, '');
  if (/^(?:19|20)\d{6}$/.test(digits)) return `${digits.slice(6,8)}/${digits.slice(4,6)}/${digits.slice(0,4)}`;
  return raw;
}

function factLabel(type) {
  return ({ phone: 'טלפון', username: 'שם משתמש', name: 'שם', context: 'הקשר', url: 'קישור', image: 'תמונה' }[type] || 'פרט');
}

function escapeHtml(v) { return String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
function escapeAttr(v) { return escapeHtml(v).replace(/'/g, '&#039;'); }

init().catch((error) => { $('summary').textContent = error.message; });