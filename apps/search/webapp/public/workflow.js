const originalFetch = window.fetch.bind(window);
let registryRows = [];
let selectedPerson = null;

const $ = (id) => document.getElementById(id);
const validId = (v) => /^\d+$/.test(String(v ?? '').trim()) && Number(v) > 0;
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const escAttr = (v) => esc(v).replace(/'/g, '&#039;');

function birthDisplay(v) {
  const d = String(v ?? '').replace(/\D+/g, '');
  return /^(?:19|20)\d{6}$/.test(d) ? `${d.slice(6,8)}/${d.slice(4,6)}/${d.slice(0,4)}` : String(v ?? '');
}
function birthIso(v) {
  const d = String(v ?? '').replace(/\D+/g, '');
  return /^(?:19|20)\d{6}$/.test(d) ? `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` : '';
}
function setField(name, value) {
  const input = $('searchForm')?.elements?.namedItem(name);
  if (input && 'value' in input) input.value = value ?? '';
}

function enhanceRegistry() {
  const root = $('registryResults');
  if (!root || !registryRows.length) return;
  [...root.querySelectorAll('.registry-result')].forEach((card, index) => {
    if (card.querySelector('.registry-actions')) return;
    const row = registryRows[index];
    if (!row) return;
    const actions = document.createElement('div');
    actions.className = 'registry-actions';
    actions.innerHTML = `
      <button type="button" class="primary registry-action registry-action-select" data-action="select" data-index="${index}">בחר אדם והמשך להצלבה</button>
      ${validId(row.ID_FATHER) && String(row.ID_FATHER) !== String(row.ID || '') ? `<button type="button" class="secondary registry-action" data-action="father" data-id="${escAttr(row.ID_FATHER)}">חפש אבא</button>` : ''}
      ${validId(row.ID_MOTHER) && String(row.ID_MOTHER) !== String(row.ID || '') ? `<button type="button" class="secondary registry-action" data-action="mother" data-id="${escAttr(row.ID_MOTHER)}">חפש אמא</button>` : ''}`;
    card.append(actions);
  });
}

function searchParent(id, label) {
  if (!validId(id)) return;
  const form = $('registryForm');
  if (!form) return;
  form.reset();
  const input = form.elements.namedItem('id');
  if (input && 'value' in input) input.value = id;
  $('registryStatus').textContent = `מחפש ${label} לפי ת״ז ${id}...`;
  form.requestSubmit();
}

function selectPerson(row) {
  if (!row) return;
  selectedPerson = row;
  setField('id', row.ID || '');
  setField('first_name', row.F_NAME || '');
  setField('last_name', row.L_NAME || '');
  setField('father_id', validId(row.ID_FATHER) ? row.ID_FATHER : '');
  setField('mother_id', validId(row.ID_MOTHER) ? row.ID_MOTHER : '');
  setField('city_name', row.city_name || '');
  setField('street', row.STREET || '');
  setField('country_name', row.country_name || '');
  setField('birth_date', birthIso(row.B_YEAR));
  setField('birth_year', String(row.B_YEAR || '').slice(0,4));
  const card = $('selectedPersonCard');
  if (card) {
    $('selectedPersonName').textContent = [row.F_NAME, row.L_NAME].filter(Boolean).join(' ') || `רשומה ${row.ID || ''}`;
    $('selectedPersonMeta').innerHTML = [
      row.city_name ? ['עיר', row.city_name] : null,
      row.B_YEAR ? ['תאריך לידה', birthDisplay(row.B_YEAR)] : null,
      row.country_name ? ['ארץ לידה', row.country_name] : null,
      row.ID ? ['ת״ז במאגר', row.ID] : null,
    ].filter(Boolean).map(([label, value]) => `
      <span class="selected-person-meta-item">
        <span class="selected-person-meta-label">${esc(label)}: </span>
        <strong>${esc(value)}</strong>
      </span>`).join(' ');
    card.classList.remove('hidden');
  }
  $('searchTabBtn')?.click();
  if ($('summary')) $('summary').textContent = 'האדם נבחר. מחפש רשתות חברתיות, אזכורים וממצאים קשורים...';
  $('searchForm')?.requestSubmit();
}

$('registryResults')?.addEventListener('click', (event) => {
  const b = event.target.closest('[data-action]');
  if (!b) return;
  if (b.dataset.action === 'select') selectPerson(registryRows[Number(b.dataset.index)]);
  if (b.dataset.action === 'father') searchParent(b.dataset.id, 'אבא');
  if (b.dataset.action === 'mother') searchParent(b.dataset.id, 'אמא');
});
$('changePersonBtn')?.addEventListener('click', () => $('registryTabBtn')?.click());


function formatInlineMarkdown(value) {
  let text = esc(value);
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
  return text;
}

function markdownToSafeHtml(value) {
  const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  let listType = '';
  let listItems = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${paragraph.map(formatInlineMarkdown).join('<br>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    const tag = listType === 'ol' ? 'ol' : 'ul';
    out.push(`<${tag}>${listItems.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join('')}</${tag}>`);
    listItems = [];
    listType = '';
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(4, heading[1].length + 2);
      out.push(`<h${level}>${formatInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      flushParagraph();
      const nextType = numbered ? 'ol' : 'ul';
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push((bullet || numbered)[1]);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return out.join('');
}

function renderAIReport(data) {
  const section = $('reportSection');
  const target = $('reportTarget');
  const status = $('reportStatus');
  if (!section || !target || !status) return;

  const aiTarget = $('aiReportText') || target;
  const report = data?.ai_report || null;
  if (report?.status === 'ok' && report.text) {
    aiTarget.innerHTML = markdownToSafeHtml(report.text);
    status.textContent = report.model ? `נוצר באמצעות ${report.model}` : 'נוצר אוטומטית';
  } else if (report?.status === 'error') {
    aiTarget.innerHTML = '<p>החיפוש הסתיים, אך יצירת סיכום ה-AI נכשלה. שאר הממצאים נשארו זמינים.</p>';
    status.textContent = 'שגיאה בסיכום';
  } else {
    aiTarget.innerHTML = '<p>סיכום AI אינו מוגדר כרגע. יש להגדיר מפתח API לספק ה-AI.</p>';
    status.textContent = 'AI לא מוגדר';
  }

  const input = data?.input || {};
  target.innerHTML = [
    input.name ? ['שם', input.name] : null,
    input.city_name ? ['עיר', input.city_name] : null,
    input.country_name ? ['ארץ לידה', input.country_name] : null,
    input.birth_date || input.birth_year ? ['תאריך / שנת לידה', input.birth_date || input.birth_year] : null,
    input.username ? ['שם משתמש', '@' + input.username] : null,
  ].filter(Boolean).map(([label, value]) => `<div class="report-fact"><span>${esc(label)}: </span><strong>${esc(value)}</strong></div>`).join('') || '<div class="helper">לא הוזנו פרטים נוספים להצגה.</div>';

  const v = data?.verification || {};
  const strong = Array.isArray(v.strong_sources) ? v.strong_sources : [];
  if ($('reportVerification')) {
    const corroboration = strong.length >= 2 ? 'יש הצלבה ממספר מקורות' : (strong.length === 1 ? 'מקור חזק אחד בלבד' : 'ללא מקור חזק');
    $('reportVerification').textContent = `ציון התאמה למידע שהוזן: ${data?.score || 0}/100 · ${corroboration} · סתירות: ${v.conflict_count || 0}`;
  }

  const socialTypes = new Set(['instagram', 'facebook', 'x', 'tiktok', 'reddit', 'linkedin', 'youtube', 'github', 'whatsapp']);
  const socialSourceKeys = ['instagram', 'facebook', 'x', 'tiktok', 'reddit', 'linkedin', 'youtube', 'github'];
  const sourceStatus = data?.source_status || {};
  const socialSuccessful = socialSourceKeys.filter((key) => sourceStatus[key]?.status === 'ok');
  const socialFailed = socialSourceKeys.filter((key) => ['error', 'partial'].includes(sourceStatus[key]?.status));
  const social = (data?.linked_accounts || []).filter((item) => socialTypes.has(String(item.type || '').toLowerCase()));
  if ($('reportSocial')) {
    if (social.length) {
      $('reportSocial').innerHTML = social.map((item) => `<div>${esc(item.type)} · ${esc(item.label || '')} · אמון ${Number(item.score || 0)}</div>`).join('');
    } else if (!socialSuccessful.length && socialFailed.length) {
      $('reportSocial').innerHTML = `<div class="helper warning-text">לא ניתן לקבוע אם קיימים חשבונות חברתיים: החיפוש החיצוני לא הושלם בהצלחה (${esc(socialFailed.join(', '))}).</div>`;
    } else if (socialSuccessful.length) {
      $('reportSocial').innerHTML = '<div class="helper">במקורות החברתיים שנבדקו בהצלחה לא נמצא חשבון שניתן לקשור בביטחון לאדם שנבדק.</div>';
    } else {
      $('reportSocial').innerHTML = '<div class="helper">לא בוצעה בדיקה מספקת של רשתות חברתיות.</div>';
    }
  }

  const web = (data?.results || []).filter((item) => item?.url && !['registry', 'whatsapp'].includes(String(item.source || '').toLowerCase())).slice(0, 12);
  const publicKeys = ['web', 'forums', ...socialSourceKeys];
  const publicSuccessful = publicKeys.filter((key) => sourceStatus[key]?.status === 'ok');
  const publicFailed = publicKeys.filter((key) => ['error', 'partial'].includes(sourceStatus[key]?.status));
  if ($('reportWeb')) {
    if (web.length) {
      $('reportWeb').innerHTML = web.map((item) => `<div>${esc(item.title || item.source || '')}${item.url ? ` · <a href="${escAttr(item.url)}" target="_blank" rel="noreferrer">מקור</a>` : ''}</div>`).join('');
    } else if (!publicSuccessful.length && publicFailed.length) {
      $('reportWeb').innerHTML = `<div class="helper warning-text">לא התקבלו ממצאי אינטרנט שניתן להעריך, משום שהחיפוש החיצוני נכשל או הושלם חלקית (${esc(publicFailed.join(', '))}).</div>`;
    } else {
      $('reportWeb').innerHTML = '<div class="helper">לא נמצאו אזכורי אינטרנט נוספים בתוצאות שהתקבלו.</div>';
    }
  }

  const conflicts = Array.isArray(data?.conflicts) ? data.conflicts : [];
  if ($('reportConflicts')) {
    $('reportConflicts').innerHTML = conflicts.length
      ? conflicts.slice(0, 12).map((item) => `<div>${esc(typeof item === 'string' ? item : JSON.stringify(item))}</div>`).join('')
      : '<div class="helper">לא זוהו סתירות מהותיות בין הממצאים.</div>';
  }

  section.classList.remove('hidden');
}

$('searchForm')?.addEventListener('submit', () => {
  $('reportSection')?.classList.add('hidden');
  if ($('reportTarget')) $('reportTarget').textContent = '';
  if ($('aiReportText')) $('aiReportText').textContent = '';
}, { capture: true });

window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  const url = typeof args[0] === 'string' ? args[0] : String(args[0]?.url || '');
  if (response.ok && url.includes('/search/api/registry/search')) {
    response.clone().json().then((data) => { registryRows = Array.isArray(data.rows) ? data.rows : []; setTimeout(enhanceRegistry, 0); }).catch(() => {});
  }
  if (response.ok && url.includes('/search/api/search')) {
    response.clone().json().then((data) => { setTimeout(() => renderAIReport(data), 0); }).catch(() => {});
  }
  return response;
};

const root = $('registryResults');
if (root) new MutationObserver(enhanceRegistry).observe(root, {childList:true, subtree:true});