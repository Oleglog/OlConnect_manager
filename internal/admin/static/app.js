// OlConnect Manager SPA
(function() {
'use strict';

const API = '/api';
let creds = JSON.parse(localStorage.getItem('olcrtc_creds') || 'null'); // {username, password}
let loginNotice = ''; // one-shot message shown on the login screen
let usagePollTimer = null;
const latestInstanceUsage = new Map();
// Version shown in the sidebar footer, from the last /system/status response.
let panelVersion = '';

const JITSI_PRESETS = [
  { host: 'meet.jit.si', label: 'meet.jit.si', preferred: true, note: 'official, baseline' },
  { host: 'jitsi.hamburg.ccc.de', label: 'hamburg.ccc', preferred: true, note: 'tested public' },
  { host: 'meet.ffmuc.net', label: 'ffmuc', preferred: true, note: 'tested public' },
  { host: 'meet.systemli.org', label: 'systemli', preferred: true, note: 'tested public' },
  { host: 'jitsi.debian.social', label: 'debian.social', preferred: true, note: 'tested public' },
  { host: 'meet.opensuse.org', label: 'opensuse', preferred: true, note: 'tested public' },
  { host: 'vc.autistici.org', label: 'autistici', preferred: true, note: 'tested public' },
  { host: 'freejitsi01.netcup.net', label: 'netcup', preferred: false, note: 'tested public' },
  { host: 'jitsi.php-friends.de', label: 'php-friends', preferred: false, note: 'tested public' },
  { host: 'jitsi.eichstaett.social', label: 'eichstaett', preferred: false, note: 'tested public' },
  { host: 'meet.lug-stormarn.de', label: 'lug-stormarn', preferred: false, note: 'tested public' },
  { host: 'meet.in-berlin.de', label: 'in-berlin', preferred: false, note: 'tested public' },
  { host: 'jitsi.freifunk-duesseldorf.de', label: 'freifunk-dus', preferred: false, note: 'tested public' },
  { host: 'jitsi.math.uzh.ch', label: 'math.uzh', preferred: false, note: 'tested public' },
  { host: 'konferenz.netzbegruenung.de', label: 'netzbegruenung', preferred: false, note: 'tested public' },
  { host: 'jitsi.is', label: 'jitsi.is', preferred: false, note: 'tested public' },
  { host: 'virtual.chaosdorf.space', label: 'chaosdorf', preferred: false, note: 'tested public' },
  { host: 'meet.rollenspiel.monster', label: 'rollenspiel', preferred: false, note: 'tested public' },
  { host: 'meet.weimarnetz.de', label: 'weimarnetz', preferred: false, note: 'tested public' },
  { host: 'meet.f3n-ac.de', label: 'f3n-ac', preferred: false, note: 'tested public' },
];


// ── Network helper ───────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const url = API + path;
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (creds) {
    headers['Authorization'] = 'Basic ' + btoa(creds.username + ':' + creds.password);
  }
  const res = await fetch(url, { headers, ...opts });
  if (res.status === 401) {
    localStorage.removeItem('olcrtc_creds');
    creds = null;
    route('/login');
    throw new Error('Unauthorized');
  }
  if (res.status === 429) {
    // The admin answers 429 from the Basic-auth rate limiter, which trips after
    // a couple of bad credentials and then holds the whole IP for five minutes.
    // Stale credentials cached in localStorage look exactly like that, so the
    // user gets a bare "Too Many Requests" in whatever modal was open (issue
    // #59). Drop the creds, explain, and land on a working login form.
    localStorage.removeItem('olcrtc_creds');
    creds = null;
    loginNotice = 'Слишком много неудачных попыток входа. Подождите 5 минут и войдите снова.';
    route('/login');
    throw new Error(loginNotice);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Theme ────────────────────────────────────────────────────────────────────
// One theme: strict black & white. The light/dark switch is gone on purpose —
// maintaining two palettes doubled every visual decision and the accent hue
// competed with the status colours. Everything now distinguishes by luminance.
function getTheme() {
  return 'dark';
}

function setTheme() {
  document.documentElement.setAttribute('data-theme', 'dark');
}

// ── DOM helpers ──────────────────────────────────────────────────────────────
// Issue #52: the supported carrier/transport matrix lives in one place so the
// create and edit modals cannot drift apart. Mirrors carrier_compat.go and
// OlcrtcProfile.supports() on Android.
function compatibleTransports(carrier) {
  if (carrier === 'telemost' || carrier === 'wbstream') return ['vp8channel'];
  if (carrier === 'jitsi') return ['datachannel'];
  if (carrier === 'openflux') return ['auto', 'boards', 'vyandex', 'yandex', 'mailru', 'avito', 'cups', 'telemost', 'bitrix24'];
  return ['vp8channel', 'datachannel'];
}

function el(type, cls, text) {
  const e = document.createElement(type);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function compareSemverJS(a, b) {
  const ap = (a || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const bp = (b || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const av = ap[i] || 0, bv = bp[i] || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

const ICONS = {
  'settings': '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  'copy': '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  'qr-code': '<rect x="2" y="2" width="8" height="8"/><rect x="14" y="2" width="8" height="8"/><rect x="2" y="14" width="8" height="8"/><path d="M14 14h.01"/><path d="M18 14h.01"/><path d="M14 18h.01"/><path d="M18 18h.01"/><path d="M22 14v4a2 2 0 0 1-2 2h-2"/><path d="M10 22H6a2 2 0 0 1-2-2v-2"/>',
  'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',
  'square': '<rect x="5" y="5" width="14" height="14" rx="2" ry="2" fill="currentColor"/>',
  'stop': '<rect x="5" y="5" width="14" height="14" rx="2" ry="2" fill="currentColor"/>',
  'play': '<polygon points="5 3 19 12 5 21 5 3"/>',
  'sliders': '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  'trash-2': '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  'plus': '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  'eye': '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
  'arrow-left': '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  'alert-circle': '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  'alert-triangle': '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  'lock': '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'unlock': '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  'key': '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  'wifi': '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
  'tag': '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  'clock': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'check-circle': '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  'x-circle': '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
  'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  'rotate-ccw': '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  'shield': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  'sliders-horizontal': '<line x1="21" y1="4" x2="14" y2="4"/><line x1="10" y1="4" x2="3" y2="4"/><line x1="21" y1="12" x2="12" y2="12"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="21" y1="20" x2="16" y2="20"/><line x1="12" y1="20" x2="3" y2="20"/><line x1="14" y1="2" x2="14" y2="6"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="16" y1="18" x2="16" y2="22"/>',
  'video': '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>',
  'cloud': '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/>',
  'sun': '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  'moon': '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
};

function icon(name, sz) {
  const size = sz || 16;
  const body = ICONS[name];
  if (!body) return '';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
}

function renderBrandLogo(sz) {
  const s = sz || 26;
  const iconSz = Math.round(s * 0.68);
  const fontSz = Math.max(16, Math.round(s * 0.62));
  return '<div class="brand-logo" style="display:inline-flex;align-items:center;gap:10px;text-decoration:none;user-select:none;">' +
    '<div class="brand-icon-box" style="width:' + s + 'px;height:' + s + 'px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--color-lavender-subtle);border:1px solid var(--color-lavender-border);color:var(--color-primary);flex-shrink:0;">' +
      '<svg width="' + iconSz + '" height="' + iconSz + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' +
        '<circle cx="12" cy="11" r="3" fill="currentColor" fill-opacity="0.35"/>' +
      '</svg>' +
    '</div>' +
    '<div style="display:flex;align-items:baseline;gap:6px;">' +
      '<span style="font-size:' + fontSz + 'px;font-weight:800;letter-spacing:-0.5px;line-height:1;">' +
        '<span style="color:var(--color-ink);">Ol</span><span style="color:var(--color-primary);">Connect</span>' +
      '</span>' +
      '<span class="brand-badge" style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;background:var(--color-lavender-subtle);color:var(--color-primary);border:1px solid var(--color-lavender-border);letter-spacing:0.5px;line-height:1;">MANAGER</span>' +
    '</div>' +
  '</div>';
}

function randHex(bytes = 32) {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

// Status wording lives in fmtInstanceState now: the card shows a Russian word
// plus the hour of history, not a dot and a pill saying the same thing twice.
function fmtTransportInfo(inst) {
  const t = (inst.transport || '').toLowerCase();
  const room = inst.room_id || '';
  if (inst.carrier !== 'openflux') {
    if (t === 'vp8channel') return { label: 'VP8-канал', hint: 'Legacy-видеоканал (WBStream/Телемост). Совместим только с таким же VP8-профилем на клиенте.' };
    if (t === 'datachannel') return { label: 'Data-канал', hint: 'Jitsi data-канал.' };
    return { label: inst.transport || '-', hint: '' };
  }
  switch (t) {
    case 'mailru':
      return { label: '📮 Mail.ru Документы', hint: 'Документ: ' + (room || '—') + '. Нужны куки cloud.mail.ru (файл /etc/olcrtc/cookies.txt на сервере + поле «Куки» в профиле клиента).' };
    case 'vyandex':
      return { label: '🟡 Волга (Яндекс)', hint: 'Документ /edit/d/: ' + (room || '—') + '. Нужны куки yandex.ru. Без кук — капча-цикл.' };
    case 'yandex':
      return { label: '🟡 Яндекс (классика)', hint: 'Документ disk.yandex.ru: ' + (room || '—') + '. Нужны куки yandex.ru.' };
    case 'telemost':
      return { label: '📹 Телемост (OpenFlux)', hint: 'Встреча: ' + (room || '—') + '. Создайте встречу на telemost.yandex.ru и вставьте ссылку. Несовместим с legacy VP8-профилем!' };
    case 'cups':
    case 'cupsonline':
      return { label: '🧪 CUPS (live-coding)', hint: 'Румы создаются автоматически при старте ноды, вручную ничего создавать не надо. Строка для клиента — из QR/URI инстанса.' };
    case 'bitrix24':
      return { label: '🏢 Битрикс24', hint: 'Портал: ' + (room || '—') + '. Нужны куки портала + sessid + chat ID.' };
    case 'avito':
      return { label: '🟢 Авито (code.avito.ru)', hint: 'Звонок создаётся сам: залогиньтесь на code.avito.ru, скопируйте куки в поле «Куки» профиля — POST /web/1/code/room выполнит транспорт.' };
    case 'boards':
    case 'board':
      return { label: '🧩 Яндекс Доски', hint: 'Доска: ' + (room || '—') + '. Ключ шифрования обязателен: доска отбрасывает кадры, внутри которых виден IP-пакет. Клиенту нужна ссылка openflux:// с k=.' };
    case 'auto':
      return { label: '✨ Авто', hint: 'Транспорт определится по ссылке документа.' };
    default:
      return { label: inst.transport || '-', hint: room };
  }
}



// ── Toast ────────────────────────────────────────────────────────────────────
function ensureToastContainer() {
  let c = document.getElementById('toast-container');
  if (!c) {
    c = el('div', 'toast-container');
    c.id = 'toast-container';
    document.body.appendChild(c);
  }
  return c;
}

function showToast(msg, kind) {
  const c = ensureToastContainer();
  const variant = kind || 'success';
  const t = el('div', 'toast toast-' + variant);
  const iconName = variant === 'error' ? 'x-circle' : variant === 'info' ? 'alert-circle' : 'check-circle';
  const iconSpan = el('span', 'toast-icon');
  iconSpan.innerHTML = icon(iconName, 16);
  t.appendChild(iconSpan);
  t.appendChild(el('span', '', msg));
  c.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(8px)';
    setTimeout(() => t.remove(), 250);
  }, 3000);
}

// ── Confirm modal ────────────────────────────────────────────────────────────
function showConfirm({ title, message, danger, confirmText, cancelText }) {
  return new Promise((resolve) => {
    const div = el('div', '');
    const h = el('h3', 'text-lg font-semibold mb-2');
    h.innerHTML = '<span class="inline-flex items-center gap-2">' + (danger ? icon('alert-triangle', 18) : icon('alert-circle', 18)) + '<span>' + (title || 'Подтверждение') + '</span></span>';
    div.appendChild(h);
    const body = el('div', 'text-sm text-gray-300 mb-4');
    body.textContent = message || '';
    div.appendChild(body);
    const row = el('div', 'flex gap-2 justify-end');
    const cancelBtn = el('button', 'btn btn-secondary');
    cancelBtn.textContent = cancelText || 'Отмена';
    const okBtn = el('button', danger ? 'btn btn-danger' : 'btn btn-primary');
    okBtn.textContent = confirmText || (danger ? 'Удалить' : 'OK');
    row.appendChild(cancelBtn);
    row.appendChild(okBtn);
    div.appendChild(row);

    const overlay = showModal(div, { small: true });
    function close(result) {
      document.removeEventListener('keydown', onKey);
      closeModal(overlay);
      resolve(result);
    }
    function onKey(e) {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    }
    document.addEventListener('keydown', onKey);
    overlay.dataset.onOutsideClose = 'cancel';
    overlay.addEventListener('outside-click', () => close(false));
    cancelBtn.onclick = () => close(false);
    okBtn.onclick = () => close(true);
    okBtn.focus();
  });
}

// ── Async button helper ──────────────────────────────────────────────────────
async function withLoading(btn, fn) {
  if (!btn) return fn();
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

// ── Router ───────────────────────────────────────────────────────────────────
function route(path) {
  history.pushState({}, '', path);
  render();
}

function render() {
  stopUsagePolling();
  const path = location.pathname;
  const app = document.getElementById('app');
  app.innerHTML = '';
  if (!creds && path !== '/login') {
    route('/login');
    return;
  }
  if (path === '/login') {
    renderLogin(app);
  } else {
    // /instances/new and /instances/<id> are pages of their own; everything else
    // is a section.
    if (path === '/instances/new') {
      renderInstanceCreatePage(app);
      return;
    }
    const instanceMatch = path.match(/^\/instances\/(\d+)$/);
    if (instanceMatch) {
      renderInstancePage(app, Number(instanceMatch[1]));
      return;
    }
    // Default '/' opens System; deeper sections are separate viewed blocks.
    const section = path === '/' ? 'system' : path.replace(/^\//, '') || 'system';
    if (section === 'settings') {
      renderSettings(app);
    } else {
      renderDashboard(app, section);
    }
  }
}
window.addEventListener('popstate', render);

// Shared layout, transplanted from the approved mockup (ofx-design/admin-instances.html):
// .shell > aside.side (brand + nav + nav-foot) and main.main. The sidebar's own
// classes, the old app-shell grid and its link styles are gone; the frame now
// comes from base.css, the mockup's own stylesheet.
const BRAND_MARK = '<svg class="brand-mark" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12h4l2-7 4 14 2-7h6"/></svg>';

function renderShell(activeSection) {
  const sections = [
    { id: 'system', label: 'Система', icon: 'shield' },
    { id: 'instances', label: 'Инстансы', icon: 'cloud' },
    { id: 'subscriptions', label: 'Подписки', icon: 'tag' },
    { id: 'settings', label: 'Настройки', icon: 'settings' },
  ];

  const shell = el('div', 'shell');

  const side = el('aside', 'side');
  const brand = el('div', 'brand');
  brand.innerHTML = BRAND_MARK + '<span class="brand-name">olcRTC<span class="brand-tail"> panel</span></span>';
  side.appendChild(brand);

  const nav = el('nav', 'nav');
  nav.setAttribute('aria-label', 'Разделы');
  sections.forEach((s) => {
    const item = el('button', 'nav-item');
    if (s.id === activeSection) item.setAttribute('aria-current', 'true');
    item.innerHTML = icon(s.icon, 16) + s.label;
    item.setAttribute('aria-label', s.label);
    item.onclick = () => route('/' + s.id);
    nav.appendChild(item);
  });
  side.appendChild(nav);

  // The mockup's nav-foot carries the version; the logout control the panel needs
  // and the mockup does not show sits there too, in the same class.
  const foot = el('div', 'nav-foot');
  const versionLine = el('div', '', 'Версия ' + (panelVersion || '—'));
  foot.appendChild(versionLine);
  const logoutBtn = el('button', 'nav-item');
  logoutBtn.innerHTML = icon('log-out', 16) + 'Выход';
  logoutBtn.setAttribute('aria-label', 'Выход');
  logoutBtn.onclick = () => { creds = null; localStorage.removeItem('olcrtc_creds'); route('/login'); };
  foot.appendChild(logoutBtn);
  side.appendChild(foot);

  const main = el('main', 'main');
  shell.appendChild(side);
  shell.appendChild(main);
  return { shell, main };
}

// ── Login ────────────────────────────────────────────────────────────────────
function renderLogin(app) {
  const box = el('div', 'flex items-center justify-center min-h-screen p-4 login-page');
  const card = el('div', 'card p-8 w-full max-w-sm login-card');
  
  const logoWrap = el('div', 'flex flex-col items-center mb-6');
  logoWrap.innerHTML = '<div class="mb-2">' + renderBrandLogo(36) + '</div><div class="text-xs font-medium" style="color:var(--color-ink-subtle);">Панель управления сервером</div>';
  card.appendChild(logoWrap);

  const userInp = el('input', 'mb-3');
  userInp.type = 'text';
  userInp.placeholder = 'Логин';
  userInp.value = 'admin';
  userInp.setAttribute('aria-label', 'Логин');

  const passInp = el('input', 'mb-3');
  passInp.type = 'password';
  passInp.placeholder = 'Пароль';
  passInp.setAttribute('aria-label', 'Пароль');

  const btn = el('button', 'btn btn-primary w-full');
  btn.textContent = 'Войти';

  const err = el('div', 'text-rose-400 text-sm mt-2 hidden text-center');
  if (loginNotice) {
    // Set by the 429 branch in api(): the bounce reason has to survive the
    // re-render, otherwise the user just sees an empty login form again.
    err.textContent = loginNotice;
    err.classList.remove('hidden');
    loginNotice = '';
  }

  async function submit() {
    err.classList.add('hidden');
    await withLoading(btn, async () => {
      try {
        const u = userInp.value;
        const p = passInp.value;
        const res = await fetch(API + '/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: u, password: p })
        });
        const data = await res.json();
        if (data.ok) {
          creds = { username: u, password: p };
          localStorage.setItem('olcrtc_creds', JSON.stringify(creds));
          route('/');
        } else {
          throw new Error('invalid');
        }
      } catch (e) {
        err.textContent = 'Неверный логин или пароль';
        err.classList.remove('hidden');
      }
    });
  }
  btn.onclick = submit;
  passInp.onkeydown = (e) => { if (e.key === 'Enter') submit(); };

  card.appendChild(userInp);
  card.appendChild(passInp);
  card.appendChild(btn);
  card.appendChild(err);
  box.appendChild(card);
  app.appendChild(box);
  setTimeout(() => passInp.focus(), 0);
}

// ── Dashboard ────────────────────────────────────────────────────────────────
async function renderDashboard(app, section) {
  const frame = renderShell(section);
  const main = frame.main;

  let sys = {};
  let instances = [];
  let subs = [];
  let subsError = null;
  let instanceMemberships = null;

  try { sys = await api('/system/status'); } catch (e) { console.error(e); }
  try { instances = await api('/instances'); } catch (e) { console.error(e); }
  instances.forEach(instance => latestInstanceUsage.set(String(instance.id), instance));
  try { subs = await api('/subs'); } catch (e) {
    try {
      const errData = JSON.parse(e.message);
      if (errData.error === 'subscription_service_unavailable') {
        subsError = errData.message;
      }
    } catch { console.error(e); }
  }
  if (!subsError) {
    try {
      instanceMemberships = await Promise.all((subs || []).map(async subscription => ({
        subscription,
        entries: await api('/subs/' + subscription.slug + '/instances'),
      })));
    } catch (e) {
      console.error('Не удалось загрузить связи подписок с инстансами', e);
    }
  }

  panelVersion = sys.version || '';
  const head = renderPageHead(section, section === 'instances'
    ? renderInstancesHead(instances, instanceMemberships)
    : { title: SECTION_TITLES[section] || '', sub: '', action: null });
  main.appendChild(head);

  const bodyEl = el('div', 'body');
  if (section === 'instances') {
    renderInstancesBlock(bodyEl, instances, instanceMemberships);
  } else if (section === 'subscriptions') {
    bodyEl.appendChild(renderSubscriptionsBlock(subs, subsError, instances, sys));
  } else {
    bodyEl.appendChild(renderSystemBlock(sys));
  }
  main.appendChild(bodyEl);

  app.appendChild(frame.shell);
  startUsagePolling();
}

const SECTION_TITLES = {
  system: 'Система',
  instances: 'Инстансы',
  subscriptions: 'Подписки',
  settings: 'Настройки',
};

// .head exactly as the mockup has it: h1, a one-line sub, and the screen's one
// primary action on the right.
function renderPageHead(section, parts) {
  const head = el('div', 'head');
  const left = el('div', '');
  left.appendChild(el('h1', '', parts.title));
  if (parts.sub) left.appendChild(el('p', 'sub', parts.sub));
  head.appendChild(left);
  if (parts.action) head.appendChild(parts.action);
  return head;
}

function makePrimaryButton(label, onClick) {
  const btn = el('button', 'btn btn-primary');
  btn.innerHTML = icon('plus') + label;
  btn.onclick = onClick;
  return btn;
}

function renderSystemBlock(sys) {
  // Same vocabulary as every other screen: one panel, its facts in facts/fact-k/
  // fact-v. No second stylesheet, no icon slab, no badge.
  const panel = el('section', 'panel');

  const head = el('div', 'panel-head');
  head.appendChild(el('h2', '', 'Сервер olcRTC'));
  const hintBits = ['онлайн'];
  if (sys.version) hintBits.push('версия ' + sys.version);
  if (sys.os) hintBits.push(sys.os);
  head.appendChild(el('span', 'hint', hintBits.join(', ')));
  panel.appendChild(head);

  const items = [
    { label: 'Аптайм', val: sys.uptime || '-', mono: true },
    { label: 'Активные пиры', val: String(Number(sys.active_peers) || 0), id: 'active-peer-count', mono: true },
    { label: 'Инстансы', val: (sys.instances_running || 0) + ' / ' + (sys.instances_total || 0) },
    { label: 'Публичный IP', val: sys.public_ip || '-', copy: true, mono: true },
    { label: 'TLS / Домен', val: (sys.tls_mode || '-') + (sys.domain ? ' (' + sys.domain + ')' : '') },
    { label: 'Порт админки', val: sys.admin_port || '-', mono: true },
    { label: 'Подписки', val: sys.sub_enabled ? (sys.sub_running ? 'Включены' : 'Сбой') : 'Выключены' },
  ];

  const facts = el('div', 'facts');
  items.forEach(it => {
    const cell = el('div', '');
    cell.appendChild(el('div', 'fact-k', it.label));
    const cls = 'fact-v' + (it.mono ? ' num' : '') + (it.copy ? ' copyable' : '');
    const val = el('div', cls);
    if (it.id) val.id = it.id;
    val.textContent = it.val;
    cell.appendChild(val);
    facts.appendChild(cell);
  });
  panel.appendChild(facts);

  return panel;
}

function renderInstancesHead(instances, memberships) {
  const total = instances.length;
  const running = instances.filter(i => i.status === 'running' || i.status === 'active').length;
  const stopped = total - running;
  let flapping = 0;
  let limited = 0;
  instances.forEach(inst => {
    const state = fmtInstanceState(inst, fmtInstanceHistory(inst));
    if (state.cls === 's-degraded') flapping += 1;
    else if (state.cls === 's-warn') limited += 1;
  });
  const parts = [total + ' ' + pluralInstances(total) + ':'];
  const counts = [];
  if (running) counts.push(running + ' активны');
  if (stopped) counts.push(stopped + ' остановлены');
  let sub = parts.concat(counts.join(', ')).join(' ');
  const channel = [];
  if (flapping) channel.push(flapping + ' рвётся');
  if (limited) channel.push(limited + ' на пределе');
  if (channel.length) sub += '. По каналу: ' + channel.join(', ');
  return {
    title: 'Инстансы',
    sub,
    action: makePrimaryButton('Добавить', () => route('/instances/new')),
  };
}

// One panel per group, exactly the mockup's panel > panel-head > rows shape.
function renderInstancesBlock(container, instances, instanceMemberships) {
  if (instances.length === 0) {
    const panel = el('section', 'panel');
    const head = el('div', 'panel-head');
    head.appendChild(el('h2', '', 'Инстансов нет'));
    panel.appendChild(head);
    const facts = el('div', 'facts');
    facts.appendChild(el('div', 'fact-v', 'Создайте первый инстанс кнопкой «Добавить» в шапке.'));
    panel.appendChild(facts);
    container.appendChild(panel);
    return container;
  }
  container.appendChild(renderInstanceGroups(instances, instanceMemberships));
  return container;
}

function renderSubscriptionsBlock(subs, subsError, instances, sys) {
  const subSection = el('div', 'card p-4');
  const subHeader = el('div', 'flex items-center justify-between mb-4');
  subHeader.innerHTML = '<h2 class="text-lg font-semibold">Подписки</h2>';
  const subActions = el('div', 'flex gap-2 flex-wrap');
  const addSubBtn = el('button', 'btn btn-primary btn-sm');
  addSubBtn.innerHTML = icon('plus') + '<span>Создать</span>';
  addSubBtn.onclick = () => showCreateSubModal();
  const exportBtn = el('button', 'btn btn-secondary btn-sm');
  exportBtn.innerHTML = icon('download') + '<span>Экспорт</span>';
  exportBtn.onclick = async () => {
    await withLoading(exportBtn, async () => {
      try {
        const data = await api('/subs/export');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'olcrtc-subscriptions.json'; a.click();
        URL.revokeObjectURL(url);
        showToast('Экспортировано');
      } catch (e) { showToast('Ошибка экспорта: ' + e.message, 'error'); }
    });
  };
  const importBtn = el('button', 'btn btn-secondary btn-sm');
  importBtn.textContent = 'Импорт';
  importBtn.onclick = () => showImportSubModal();
  subActions.appendChild(addSubBtn);
  subActions.appendChild(exportBtn);
  subActions.appendChild(importBtn);
  subHeader.appendChild(subActions);
  subSection.appendChild(subHeader);

  const subList = el('div', 'space-y-3');
  if (subsError) {
    subList.appendChild(el('div', 'text-amber-300 text-sm', 'Сервис подписок недоступен. Проверьте, что olcrtc-server запущен с OLCRTC_SUB_ENABLED=1.'));
  } else if (!subs || subs.length === 0) {
    subList.appendChild(el('div', 'text-gray-400 text-sm', 'Нет подписок'));
  } else {
    subs.forEach(sub => subList.appendChild(renderSubRow(sub, instances, sys, subs)));
  }
  subSection.appendChild(subList);
  return subSection;
}

function stopUsagePolling() {
  if (usagePollTimer !== null) {
    clearInterval(usagePollTimer);
    usagePollTimer = null;
  }
}

function startUsagePolling() {
  stopUsagePolling();
  const poll = async () => {
    if (document.hidden || location.pathname === '/settings' || location.pathname === '/login') return;
    try {
      applyUsageSnapshot(await api('/instances/usage'));
    } catch (e) {
      console.error('Не удалось обновить использование инстансов', e);
    }
  };
  usagePollTimer = setInterval(poll, 10000);
}

function applyUsageSnapshot(snapshot) {
  (snapshot.instances || []).forEach(usage => {
    latestInstanceUsage.set(String(usage.id), usage);
    document.querySelectorAll('[data-instance-usage="' + usage.id + '"]').forEach(node => {
      setUsageBadge(node, usage);
    });
  });
  const total = document.getElementById('active-peer-count');
  if (total) total.textContent = String(Number(snapshot.active_peers) || 0);
}


async function confirmBusyInstance(inst, action) {
  const usage = await refreshInstanceUsage(inst);
  if (!usage.usage_known || usage.active_peers <= 0) return true;
  return showConfirm({
    title: 'Инстанс сейчас используется',
    message: 'Активных подключений: ' + usage.active_peers + '. Действие «' + action + '» оборвёт их соединение.',
    danger: true,
    confirmText: action,
  });
}

async function refreshInstanceUsage(inst) {
  try {
    applyUsageSnapshot(await api('/instances/usage'));
  } catch (e) {
    console.error('Не удалось проверить использование инстанса', e);
  }
  return latestInstanceUsage.get(String(inst.id)) || inst;
}

function renderInstanceGroups(instances, memberships) {
  const root = el('div', '');
  // Group numbers are assigned in render order so "01" is always the first
  // block on screen. A user matches an instance to its group by number first,
  // shade second — on a monochrome canvas two adjacent greys are hard to tell
  // apart, a number is not.
  let groupNumber = 0;
  if (!memberships) {
    root.appendChild(renderInstanceGroup('Все инстансы', instances, null));
    root.appendChild(el('p', 'hint', 'Принадлежность к подпискам временно недоступна. Показан общий список.'));
    return root;
  }

  const instancesByID = new Map(instances.map(instance => [String(instance.id), instance]));
  const linkedIDs = new Set();
  memberships.forEach(group => {
    const groupIDs = new Set();
    const linked = [];
    (group.entries || []).forEach(entry => {
      if (entry.source_instance_id === null || entry.source_instance_id === undefined) return;
      const id = String(entry.source_instance_id);
      const instance = instancesByID.get(id);
      if (!instance || groupIDs.has(id)) return;
      groupIDs.add(id);
      linked.push(instance);
    });
    if (linked.length === 0) return;
    linked.forEach(instance => linkedIDs.add(String(instance.id)));
    groupNumber += 1;
    root.appendChild(renderInstanceGroup(group.subscription.name, linked, group.subscription, group.entries, groupNumber));
  });

  const unassigned = instances.filter(instance => !linkedIDs.has(String(instance.id)));
  if (unassigned.length > 0) {
    root.appendChild(renderInstanceGroup('Без подписки', unassigned, null, groupNumber + 1));
  }
  return root;
}

// A group is one panel, as in the mockup: the title and its one-line hint sit in
// panel-head, the channels are rows under hairlines inside it.
function renderInstanceGroup(title, instances, subscription, entries, groupNumber = 0) {
  const panel = el('section', 'panel');

  const head = el('div', 'panel-head');
  const heading = el('div', '');
  const numbered = groupNumber > 0 ? String(groupNumber).padStart(2, '0') + ' ' + title : title;
  heading.appendChild(el('h2', '', numbered));
  head.appendChild(heading);
  const hintBits = [instances.length + ' ' + pluralInstances(instances.length)];
  if (subscription) hintBits.push(subscription.slug);
  head.appendChild(el('span', 'hint', hintBits.join(', ')));
  panel.appendChild(head);

  const aliases = buildInstanceAliases(instances, subscription ? subscription.name : null, entries);
  const rows = el('div', 'rows');
  instances.forEach(instance => rows.appendChild(renderInstanceCard(instance, {
    displayName: aliases.get(String(instance.id)),
    subscription,
    groupNumber,
  })));
  panel.appendChild(rows);

  // details.more with the facts the mockup keeps behind a click.
  const more = el('details', 'more');
  more.appendChild(el('summary', '', 'Служебное группы'));
  const facts = el('div', 'facts');
  const factPairs = [
    ['Инстансов в группе', String(instances.length)],
    ['Активных', String(instances.filter(i => i.status === 'running' || i.status === 'active').length)],
  ];
  if (subscription) factPairs.push(['Подписка', subscription.slug]);
  factPairs.forEach(pair => {
    const cell = el('div', '');
    cell.appendChild(el('div', 'fact-k', pair[0]));
    cell.appendChild(el('div', 'fact-v num', pair[1]));
    facts.appendChild(cell);
  });
  more.appendChild(facts);
  panel.appendChild(more);
  return panel;
}

function buildInstanceAliases(instances, subscriptionName, entries = []) {
  const subscriptionGroup = subscriptionName !== null;
  const items = subscriptionGroup ? entries : instances;
  const providers = items.map(item => subscriptionGroup
    ? uriProvider(item.raw_uri)
    : instanceProviderPrefix(item));
  const totals = new Map();
  providers.forEach(provider => totals.set(provider, (totals.get(provider) || 0) + 1));
  const seen = new Map();
  const suffix = subscriptionGroup ? (cleanInstanceNamePart(subscriptionName) || 'subscription') : 'olcrtc';
  const result = new Map();
  items.forEach((item, index) => {
    const provider = providers[index];
    const ordinal = (seen.get(provider) || 0) + 1;
    seen.set(provider, ordinal);
    let name = provider + '_' + suffix;
    if ((totals.get(provider) || 0) > 1) name += '_' + ordinal;
    const id = subscriptionGroup ? item.source_instance_id : item.id;
    if (id !== null && id !== undefined) result.set(String(id), name);
  });
  return result;
}

function instanceProviderPrefix(item) {
  if (!item) return 'olcrtc';
  if ((item.carrier || '').toLowerCase() === 'openflux') {
    return uriProvider(item.subscription_uri || item.uri || '');
  }
  return cleanInstanceNamePart(item.carrier || 'olcrtc').toLowerCase() || 'olcrtc';
}

function uriProvider(rawURI) {
  try {
    const parsed = new URL(rawURI);
    const proto = parsed.protocol.toLowerCase();
    if (proto === 'openflux:') {
      const t = (parsed.searchParams.get('t') || parsed.searchParams.get('transport') || '').toLowerCase();
      const host = (parsed.hostname || '').toLowerCase();
      const docUrl = ((parsed.searchParams.get('url') || '') + ' ' + (parsed.searchParams.get('u') || '')).toLowerCase();
      if (t === 'mailru' || host === 'mailru' || docUrl.includes('mail.ru')) return 'openflux_mailru';
      if (t === 'avito' || host === 'avito' || docUrl.includes('avito.ru')) return 'openflux_avito';
      if (t === 'cups' || t === 'cupsonline' || host === 'cups' || host === 'cupsonline' || docUrl.includes('cups.online')) return 'openflux_cups';
      if (t === 'telemost' || host === 'telemost' || docUrl.includes('telemost.yandex.ru')) return 'openflux_telemost';
      if (t === 'bitrix24' || t === 'bitrix' || host === 'bitrix24' || host === 'bitrix' || docUrl.includes('bitrix24')) return 'openflux_bitrix24';
      if (t === 'vyandex' || t === 'volga' || host === 'vyandex' || docUrl.includes('/edit/d/')) return 'openflux_volga';
      if (t === 'boards' || t === 'board' || host === 'boards' || docUrl.includes('boards.yandex.ru')) return 'openflux_boards';
      if (t === 'yandex' || host === 'yandex' || docUrl.includes('yandex.')) return 'openflux_yandex';
      return 'openflux';
    }
    if ((proto !== 'olcrtc:' && proto !== 'olconnect:') || !parsed.username) return 'olcrtc';
    return cleanInstanceNamePart(decodeURIComponent(parsed.username)).toLowerCase() || 'olcrtc';
  } catch {
    return 'olcrtc';
  }
}

function cleanInstanceNamePart(value) {
  return String(value || '')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');
}
function pluralInstances(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'инстанс';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'инстанса';
  return 'инстансов';
}

function withInstanceName(rawURI, name) {
  if (!rawURI || !name) return rawURI || '';
  return rawURI.replace(/#.*$/, '') + '#' + encodeURIComponent(name);
}


// fmtInstanceHistory folds the ribbon into runs so the rail is a handful of
// elements instead of sixty, and counts what the state line explains.
// One minute of the ribbon is one letter from /api/instances: L live, U flapping,
// P at the limit, D dead, I stopped, and null when the panel has no measurement
// for that minute. The panel never invents a state for a minute it did not
// measure, and "no data" draws as nothing rather than as idle.
const VL_STATE = {
  L: { cls: 's-live', word: 'жив', colour: 'var(--st-live)' },
  U: { cls: 's-degraded', word: 'рвётся', colour: 'var(--st-degraded)' },
  P: { cls: 's-warn', word: 'на пределе', colour: 'var(--st-warn)' },
  D: { cls: 's-down', word: 'мёртв', colour: 'var(--st-down)' },
  I: { cls: 's-idle', word: 'остановлен', colour: 'var(--st-idle)' },
};

// fmtInstanceHistory folds the ribbon into runs and counts what the state line
// explains. Each run keeps its mockup class and the colour the mockup paints.
function fmtInstanceHistory(inst) {
  const history = Array.isArray(inst.history) ? inst.history : [];
  const runs = [];
  const counts = { L: 0, U: 0, P: 0, D: 0, I: 0, gap: 0 };
  let rejects = 0;
  history.forEach(slot => {
    const code = slot && typeof slot.state === 'string' ? slot.state : '';
    const key = code && VL_STATE[code] ? code : 'gap';
    counts[key] += 1;
    if (slot && slot.rejects) rejects += slot.rejects;
    const cls = key === 'gap' ? 'is-gap' : VL_STATE[key].cls;
    const colour = key === 'gap' ? 'transparent' : VL_STATE[key].colour;
    const last = runs[runs.length - 1];
    if (last && last.cls === cls) last.n += 1;
    else runs.push({ cls, colour, n: 1 });
  });
  return {
    history,
    runs,
    counts,
    rejects,
    // One flapping episode per run of U: the page prints that as "разрывов".
    breaks: runs.filter(run => run.cls === 's-degraded').length,
    // history_complete === false is the normal case right after the panel
    // restarts: the ring has not filled an hour yet. It is not an error.
    complete: inst.history_complete !== false,
  };
}

// fmtInstanceState answers "how is this channel now". The newest measured minute
// wins; when it has no data, systemd decides and the reason says so.
function fmtInstanceState(inst, agg) {
  const last = agg.history.length ? agg.history[agg.history.length - 1] : null;
  const code = last && typeof last.state === 'string' ? last.state : '';
  if (code && VL_STATE[code]) {
    const entry = VL_STATE[code];
    let why = '';
    if (code === 'U' && agg.counts.U > 0) why = '(разрывов за час: ' + agg.counts.U + ')';
    else if (code === 'P' && agg.rejects > 0) why = '(429 за час: ' + agg.rejects + ')';
    else if (code === 'P') why = '(у предела)';
    return { cls: entry.cls, word: entry.word, why };
  }
  const measured = agg.history.length > 0;
  const since = measured ? '(нет данных за последнюю минуту)' : '(истории пока нет)';
  if (inst.status === 'failed') return { cls: 's-down', word: 'мёртв', why: measured ? '' : since };
  if (inst.status === 'running' || inst.status === 'active') return { cls: 's-live', word: 'жив', why: since };
  return { cls: 's-idle', word: 'остановлен', why: '' };
}

// The rail is drawn the way the mockup draws it: one strip per row, painted as a
// linear-gradient of state segments, so the hour reads left to right without
// sixty elements. Minutes with no data are transparent and show the tick mask.
function fmtRailGradient(agg) {
  const total = agg.runs.reduce((sum, run) => sum + run.n, 0) || 1;
  let walked = 0;
  const stops = agg.runs.map(run => {
    const from = (walked / total) * 100;
    walked += run.n;
    const to = (walked / total) * 100;
    return run.colour + ' ' + from.toFixed(2) + '% ' + to.toFixed(2) + '%';
  });
  return 'linear-gradient(90deg, ' + stops.join(', ') + ')';
}

// The usage poll rewrites this node every ten seconds. It used to be a badge with
// its own colours; the mockup puts the number in row-metric, so the setter keeps
// the node in place and only changes the number and the wording.
function setUsageBadge(node, usage) {
  if (!usage.usage_known) {
    node.className = 'nok num';
    node.textContent = 'нет данных';
    node.title = 'Сервис ещё не опубликовал состояние подключений';
    return;
  }
  const peers = Number(usage.active_peers) || 0;
  node.className = 'num';
  node.textContent = String(peers);
  if (peers > 0) {
    node.title = usage.oldest_connected_at
      ? 'Самое раннее подключение: ' + new Date(usage.oldest_connected_at).toLocaleString()
      : 'Есть активные подключения';
  } else {
    node.title = 'Активных подключений нет';
  }
}

// Volume for the metric cell, in the mockup's units: one decimal, comma
// separator, and no unit switch that would make two rows incomparable.
function fmtByteVolume(bytes) {
  if (!bytes) return '0 КБ';
  const kb = bytes / 1024;
  if (kb < 1024) return kb.toFixed(kb < 10 ? 1 : 0).replace('.', ',') + ' КБ';
  const mb = kb / 1024;
  return mb.toFixed(mb < 10 ? 1 : 0).replace('.', ',') + ' МБ';
}

function peersWord(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'клиент';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'клиента';
  return 'клиентов';
}

// A channel row, structurally identical to the mockup:
// row > [ row-id + row-sub | chan ( state + rail + rail-label ) | row-metric | row-actions ]
// The create screen as a route, transplanted from ofx-design/admin-instance-new.html:
// the same head, the carrier tiles, the panels and the footer. The fields are the
// modal's own builder, so nothing can drift and the modal keeps working.
const CARRIER_TITLES = {
  jitsi: 'Jitsi',
  telemost: 'Telemost',
  wbstream: 'WB Stream',
  openflux: 'OpenFlux',
};

async function renderInstanceCreatePage(app) {
  const frame = renderShell('instances');
  const form = buildCreateInstanceForm();

  const head = el('div', 'head');
  const left = el('div', '');
  const backBtn = el('button', 'btn btn-ghost btn-sm');
  backBtn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg>Все инстансы';
  backBtn.style.marginBottom = 'var(--s-2)';
  backBtn.onclick = () => route('/instances');
  left.appendChild(backBtn);
  left.appendChild(el('h1', '', 'Новый инстанс'));
  left.appendChild(el('p', 'sub', 'Один инстанс, один канал через чужую инфраструктуру'));
  head.appendChild(left);
  frame.main.appendChild(head);

  const body = el('div', 'body');
  body.style.maxWidth = '760px';

  // Panel 1: the carriers as tiles, as the mockup draws them.
  const carrierPanel = el('section', 'panel');
  const carrierHead = el('div', 'panel-head');
  carrierHead.appendChild(el('h2', '', 'Носитель'));
  carrierHead.appendChild(el('span', 'hint', 'определяет, какой транспорт поднимется'));
  carrierPanel.appendChild(carrierHead);
  const pickWrap = el('div', '');
  pickWrap.style.padding = 'var(--s-4)';
  const pick = el('div', 'pick');
  pick.setAttribute('role', 'group');
  pick.setAttribute('aria-label', 'Носитель');
  const tiles = new Map();
  form.carrierOptions.forEach(carrier => {
    const tile = el('button');
    tile.type = 'button';
    tile.appendChild(el('b', '', CARRIER_TITLES[carrier] || carrier));
    tile.appendChild(el('span', '', carrier));
    tile.setAttribute('aria-pressed', 'false');
    tile.onclick = () => {
      form.setCarrier(carrier);
      syncTiles();
      syncFacts();
    };
    tiles.set(carrier, tile);
    pick.appendChild(tile);
  });
  function syncTiles() {
    const current = form.describe().carrier;
    tiles.forEach((tile, carrier) => {
      tile.setAttribute('aria-pressed', carrier === current ? 'true' : 'false');
    });
  }
  pickWrap.appendChild(pick);
  carrierPanel.appendChild(pickWrap);
  body.appendChild(carrierPanel);

  // Panel 2: the form itself. Same node the modal mounts.
  const formPanel = el('section', 'panel');
  const formHead = el('div', 'panel-head');
  formHead.appendChild(el('h2', '', 'Подключение'));
  formPanel.appendChild(formHead);
  const formWrap = el('div', '');
  formWrap.style.padding = 'var(--s-4)';
  formWrap.appendChild(form.node);
  formPanel.appendChild(formWrap);
  body.appendChild(formPanel);

  // Panel 3: what will appear, as far as it is knowable before the id exists.
  const summaryPanel = el('section', 'panel');
  const summaryHead = el('div', 'panel-head');
  summaryHead.appendChild(el('h2', '', 'Что появится'));
  summaryPanel.appendChild(summaryHead);
  const summaryFacts = el('div', 'facts');
  const carrierFact = el('div', '');
  carrierFact.appendChild(el('div', 'fact-k', 'Носитель'));
  const carrierValue = el('div', 'fact-v num');
  carrierFact.appendChild(carrierValue);
  const transportFact = el('div', '');
  transportFact.appendChild(el('div', 'fact-k', 'Транспорт'));
  const transportValue = el('div', 'fact-v num');
  transportFact.appendChild(transportValue);
  const nameFact = el('div', '');
  nameFact.appendChild(el('div', 'fact-k', 'Имя в панели'));
  const nameValue = el('div', 'fact-v num');
  nameFact.appendChild(nameValue);
  summaryFacts.appendChild(carrierFact);
  summaryFacts.appendChild(transportFact);
  summaryFacts.appendChild(nameFact);
  summaryPanel.appendChild(summaryFacts);

  function syncFacts() {
    const d = form.describe();
    carrierValue.textContent = CARRIER_TITLES[d.carrier] || d.carrier || '-';
    transportValue.textContent = d.transport || '-';
    nameValue.textContent = d.name || '-';
  }

  const footer = el('div', '');
  footer.style.display = 'flex';
  footer.style.justifyContent = 'flex-end';
  footer.style.gap = 'var(--s-2)';
  footer.style.padding = 'var(--s-4)';
  footer.style.borderTop = '1px solid var(--line)';
  const cancelBtn = el('button', 'btn btn-ghost', 'Отмена');
  cancelBtn.onclick = () => route('/instances');
  const createBtn = el('button', 'btn btn-primary', 'Создать инстанс');
  createBtn.onclick = async () => {
    if (await form.submit(createBtn)) route('/instances');
  };
  footer.appendChild(cancelBtn);
  footer.appendChild(createBtn);
  summaryPanel.appendChild(footer);

  body.appendChild(summaryPanel);
  frame.main.appendChild(body);

  // Carrier, transport and name change under the tiles and the facts, so the
  // summary follows the form without polling.
  form.node.addEventListener('change', () => { syncTiles(); syncFacts(); });
  form.node.addEventListener('input', () => { syncFacts(); });
  syncTiles();
  syncFacts();

  app.appendChild(frame.shell);
}

function renderInstanceCard(inst, context = {}) {
  const row = el('div', 'row');
  const displayName = (inst.carrier === 'openflux' && inst.name) ? inst.name : (context.displayName || inst.name || inst.label);
  const displayURI = withInstanceName(inst.uri, displayName);
  const agg = fmtInstanceHistory(inst);

  const idBox = el('div', '');
  idBox.appendChild(el('div', 'row-id', displayName));
  const groupTag = context.groupNumber ? String(context.groupNumber).padStart(2, '0') + ' · ' : '';
  // Mockup row-sub: the transport and the carrier, in the words the config uses.
  const transportLine = [inst.transport, inst.carrier].filter(Boolean).join(', ');
  const sub = el('div', 'row-sub', groupTag + '#' + inst.id + ' · ' + (transportLine || inst.label || ''));
  if (inst.name && inst.name !== displayName) sub.title = 'Имя в конфигурации: ' + inst.name;
  idBox.appendChild(sub);
  // Wbstream cannot come up without a room and cannot connect with an expired
  // token. The mockup has no badge slot, so the reason sits on the row itself.
  if (inst.carrier === 'wbstream' && (!inst.room_id || inst.room_id === 'any')) {
    const warn = el('div', 'row-sub nok', 'нужен Room ID');
    warn.title = 'wbstream больше не создаёт румы автоматически: задайте Room ID в настройках инстанса';
    idBox.appendChild(warn);
  }
  if (inst.carrier === 'wbstream' && inst.auth_token_expired) {
    const warn = el('div', 'row-sub nok', 'токен истёк');
    warn.title = inst.auth_token_expires_at
      ? 'Истёк ' + new Date(inst.auth_token_expires_at * 1000).toLocaleString()
      : 'Обновите общий WB-токен в Настройках';
    idBox.appendChild(warn);
  }
  row.appendChild(idBox);

  const chan = el('div', 'chan');
  const state = fmtInstanceState(inst, agg);
  const stateEl = el('div', 'state ' + state.cls);
  stateEl.appendChild(document.createTextNode(state.word + (state.why ? ' ' : '')));
  if (state.why) stateEl.appendChild(el('span', 'state-note', state.why));
  chan.appendChild(stateEl);
  if (agg.runs.length) {
    const rail = el('i', 'rail');
    rail.setAttribute('style', 'background-image: ' + fmtRailGradient(agg));
    rail.setAttribute('aria-label', 'история канала за час, минута на деление');
    chan.appendChild(rail);
    const labels = el('div', 'rail-label');
    labels.appendChild(el('span', '', '−60 мин'));
    if (!agg.complete) labels.appendChild(el('span', '', 'данных пока меньше часа'));
    labels.appendChild(el('span', '', 'сейчас'));
    chan.appendChild(labels);
  } else {
    chan.appendChild(el('div', 'rail-empty', 'истории пока нет, рейка начнётся с первой минуты'));
  }
  row.appendChild(chan);

  // Mockup metric cell: "<b class=num>3,1</b> МБ / <b class=num>1</b> клиент",
  // then uptime under a break. The hour's volume is the sum of the ring's
  // per-minute bytes; when no slot carries a number the cell says so instead of
  // showing a zero.
  const metric = el('div', 'row-metric');
  const hourBytes = agg.history.reduce((sum, slot) => {
    return sum + (slot && typeof slot.bytes === 'number' ? slot.bytes : 0);
  }, 0);
  const bytesKnown = agg.history.some(slot => slot && typeof slot.bytes === 'number');
  if (bytesKnown) {
    metric.appendChild(el('b', 'num', fmtByteVolume(hourBytes)));
  } else {
    metric.appendChild(el('span', 'nok', 'нет данных'));
  }
  metric.appendChild(document.createTextNode(' / '));
  const peersNode = el('b', 'num');
  peersNode.dataset.instanceUsage = String(inst.id);
  setUsageBadge(peersNode, inst);
  metric.appendChild(peersNode);
  metric.appendChild(document.createTextNode(' ' + peersWord(Number(inst.active_peers) || 0)));
  if (inst.uptime) {
    metric.appendChild(document.createElement('br'));
    metric.appendChild(el('span', 'nok num', inst.uptime));
  }
  row.appendChild(metric);

  const actions = el('div', 'row-actions');
  const uriBtn = el('button', 'btn btn-ghost btn-sm');
  uriBtn.setAttribute('aria-label', 'Копировать URI');
  uriBtn.textContent = 'URI';
  uriBtn.onclick = () => {
    navigator.clipboard.writeText(displayURI);
    showToast('URI скопирован');
  };
  const qrBtn = el('button', 'btn btn-ghost btn-sm');
  qrBtn.setAttribute('aria-label', 'Показать QR-код');
  qrBtn.textContent = 'QR';
  qrBtn.onclick = async () => {
    await withLoading(qrBtn, async () => {
      try {
        const res = await api('/instances/' + inst.id + '/qr');
        showQRModal(withInstanceName(res.uri || inst.uri, displayName), { ...inst, name: displayName });
      } catch (e) {
        showToast('Ошибка QR: ' + e.message, 'error');
      }
    });
  };
  const pingBtn = el('button', 'btn btn-ghost btn-sm');
  pingBtn.setAttribute('aria-label', 'Проверить соединение');
  pingBtn.textContent = 'Пинг';
  pingBtn.onclick = async () => {
    await withLoading(pingBtn, async () => {
      try {
        const res = await api('/instances/' + inst.id + '/ping', { method: 'POST' });
        const targetLabel = ({
          socks_proxy: 'SOCKS',
          warp_proxy: 'WARP',
          internet: 'интернет',
        })[res.target_kind] || res.target_kind || 'цель';
        if (res && res.ok) {
          const rtt = (res.rtt_ms != null) ? res.rtt_ms.toFixed(1) + ' мс' : '';
          const loss = (res.packet_loss != null && res.packet_loss > 0) ? ` · потери ${res.packet_loss}%` : '';
          showToast(`${targetLabel} ${res.target} · ${rtt}${loss}`, 'success');
        } else {
          showToast(res.message || `Не удалось пинговать ${targetLabel}`, 'error');
        }
      } catch (e) {
        showToast('Ошибка пинга: ' + e.message, 'error');
      }
    });
  };
  const cfgBtn = el('button', 'btn btn-ghost btn-sm');
  cfgBtn.setAttribute('aria-label', 'Настройки инстанса');
  cfgBtn.textContent = 'Конфиг';
  // The mockup names "Конфиг" the place where secondary things live, and the card
  // is that place now: the row links to it. The carrier's setup hint (which
  // cookies a carrier needs, what its room has to be) rides along as the tooltip.
  cfgBtn.title = fmtTransportInfo(inst).hint || 'Карточка инстанса';
  cfgBtn.onclick = () => route('/instances/' + inst.id);
  const isRunning = inst.status === 'running';
  const startStopBtn = el('button', isRunning ? 'btn btn-ghost btn-sm btn-icon' : 'btn btn-primary btn-sm btn-icon');
  startStopBtn.setAttribute('aria-label', isRunning ? 'Остановить' : 'Запустить');
  startStopBtn.title = isRunning ? 'Остановить' : 'Запустить';
  startStopBtn.innerHTML = isRunning ? icon('stop') : icon('play');
  startStopBtn.onclick = async () => {
    const action = isRunning ? 'stop' : 'start';
    if (action === 'stop' && !(await confirmBusyInstance(inst, 'Остановить'))) return;
    await withLoading(startStopBtn, async () => {
      try {
        await api('/instances/' + inst.id + '/' + action, { method: 'POST' });
        showToast(action === 'stop' ? 'Остановлено' : 'Запущено');
        render();
      } catch (e) { showToast('Ошибка: ' + e.message, 'error'); }
    });
  };
  const restartBtn = el('button', 'btn btn-ghost btn-sm btn-icon');
  restartBtn.setAttribute('aria-label', 'Перезапустить');
  restartBtn.title = 'Перезапустить';
  restartBtn.innerHTML = icon('refresh-cw');
  restartBtn.onclick = async () => {
    if (!(await confirmBusyInstance(inst, 'Перезапустить'))) return;
    await withLoading(restartBtn, async () => {
      try {
        await api('/instances/' + inst.id + '/restart', { method: 'POST' });
        showToast('Перезапущено');
        render();
      } catch (e) { showToast('Ошибка: ' + e.message, 'error'); }
    });
  };
  // The mockup's row carries two controls, and seven buttons made the row noisy
  // next to a two-line channel cell. The client link, the card and the power
  // switch stay visible; QR, ping, restart and delete sit behind one disclosure.
  // It is plain details/summary, so no JS state, and every handler, confirm
  // included, is the same object it was before.
  actions.appendChild(uriBtn);
  actions.appendChild(cfgBtn);
  actions.appendChild(startStopBtn);
  const menu = el('details', 'row-menu');
  const menuBtn = el('summary', 'btn btn-ghost btn-sm btn-icon');
  menuBtn.setAttribute('aria-label', 'Остальные действия');
  menuBtn.title = 'Остальные действия';
  menuBtn.innerHTML = icon('chevron-down');
  menu.appendChild(menuBtn);
  const menuBody = el('div', '');
  menuBody.appendChild(qrBtn);
  menuBody.appendChild(pingBtn);
  menuBody.appendChild(restartBtn);
  if (inst.id !== 0) {
    const delBtn = el('button', 'btn btn-danger btn-sm btn-icon');
    delBtn.setAttribute('aria-label', 'Удалить инстанс');
    delBtn.title = 'Удалить инстанс';
    delBtn.innerHTML = icon('trash-2');
    delBtn.onclick = async () => {
      const usage = await refreshInstanceUsage(inst);
      const busyWarning = usage.usage_known && usage.active_peers > 0
        ? 'Сейчас подключено пользователей: ' + usage.active_peers + '. Их соединения будут оборваны. '
        : '';
      const ok = await showConfirm({
        title: 'Удалить инстанс #' + inst.id + '?',
        message: busyWarning + 'Сервис и его systemd-артефакты будут удалены, env-файл будет стёрт, а инстанс будет убран из всех подписок. Обычная остановка других инстансов их файлы не затрагивает.',
        danger: true,
        confirmText: 'Удалить',
      });
      if (!ok) return;
      try {
        const result = await api('/instances/' + inst.id, { method: 'DELETE' });
        const removed = result.removed_subscription_entries || 0;
        showToast('Удалено' + (removed ? (', из подписок убрано записей: ' + removed) : ''));
        render();
      } catch (e) { showToast('Ошибка: ' + e.message, 'error'); }
    };
    menuBody.appendChild(delBtn);
  }
  menu.appendChild(menuBody);
  actions.appendChild(menu);
  row.appendChild(actions);
  return row;
}

// Shared by the row and the instance page: the same ping and the same QR, so the
// two places cannot drift apart.
async function pingInstance(inst, btn) {
  await withLoading(btn, async () => {
    try {
      const res = await api('/instances/' + inst.id + '/ping', { method: 'POST' });
      const targetLabel = ({
        socks_proxy: 'SOCKS',
        warp_proxy: 'WARP',
        internet: 'интернет',
      })[res.target_kind] || res.target_kind || 'цель';
      if (res && res.ok) {
        const rtt = (res.rtt_ms != null) ? res.rtt_ms.toFixed(1) + ' мс' : '';
        const loss = (res.packet_loss != null && res.packet_loss > 0) ? ` · потери ${res.packet_loss}%` : '';
        showToast(`${targetLabel} ${res.target} · ${rtt}${loss}`, 'success');
      } else {
        showToast(res.message || `Не удалось пинговать ${targetLabel}`, 'error');
      }
    } catch (e) {
      showToast('Ошибка пинга: ' + e.message, 'error');
    }
  });
}

async function openInstanceQR(inst, displayName, btn) {
  await withLoading(btn, async () => {
    try {
      const res = await api('/instances/' + inst.id + '/qr');
      showQRModal(withInstanceName(res.uri || inst.uri, displayName), { ...inst, name: displayName });
    } catch (e) {
      showToast('Ошибка QR: ' + e.message, 'error');
    }
  });
}

// The mockup's fact block: label above value, value in the number face.
function makeFact(label, value, opts = {}) {
  const cell = el('div', '');
  cell.appendChild(el('div', 'fact-k', label));
  const cls = 'fact-v' + (opts.mono === false ? '' : ' num') + (opts.copy ? ' copyable' : '');
  const val = el('div', cls, value);
  if (opts.id) val.id = opts.id;
  if (opts.title) val.title = opts.title;
  cell.appendChild(val);
  return cell;
}

function instanceDisplayName(inst) {
  return (inst.carrier === 'openflux' && inst.name) ? inst.name : (inst.name || inst.label || ('#' + inst.id));
}

// The instance page, transplanted from ofx-design/admin-instance.html: the same
// head, the same three panels, the same disclosure. showConfigModal stays the
// form behind "Изменить"; the page does not try to be the form.
async function renderInstancePage(app, id) {
  const frame = renderShell('instances');

  let sys = {};
  let instances = [];
  try { sys = await api('/system/status'); } catch (e) { console.error(e); }
  if (sys.version) panelVersion = sys.version;
  try { instances = await api('/instances'); } catch (e) { console.error(e); }
  instances.forEach(instance => latestInstanceUsage.set(String(instance.id), instance));

  const head = el('div', 'head');
  const left = el('div', '');
  const backBtn = el('button', 'btn btn-ghost btn-sm');
  backBtn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg>Все инстансы';
  backBtn.style.marginBottom = 'var(--s-2)';
  backBtn.onclick = () => route('/instances');
  left.appendChild(backBtn);

  const inst = instances.find(item => Number(item.id) === Number(id));
  if (!inst) {
    left.appendChild(el('h1', '', 'Инстанс не найден'));
    left.appendChild(el('p', 'sub', 'Возможно, он удалён или номер в ссылке неверный.'));
    head.appendChild(left);
    frame.main.appendChild(head);
    app.appendChild(frame.shell);
    return;
  }

  const displayName = instanceDisplayName(inst);
  const displayURI = withInstanceName(inst.uri, displayName);
  const agg = fmtInstanceHistory(inst);
  const state = fmtInstanceState(inst, agg);
  const isRunning = inst.status === 'running';
  const peers = Number(inst.active_peers) || 0;

  left.appendChild(el('h1', '', displayName));
  const subBits = [inst.transport, inst.carrier].filter(Boolean).join(', ');
  const subParts = [];
  if (subBits) subParts.push(subBits);
  if (inst.uptime) subParts.push('работает ' + inst.uptime);
  left.appendChild(el('p', 'sub', subParts.join(', ')));
  head.appendChild(left);

  const headActions = el('div', '');
  headActions.style.display = 'flex';
  headActions.style.gap = 'var(--s-2)';
  const pingBtn = el('button', 'btn btn-ghost', 'Проверить связь');
  pingBtn.onclick = () => pingInstance(inst, pingBtn);
  const qrBtn = el('button', 'btn btn-ghost', 'QR');
  qrBtn.onclick = () => openInstanceQR(inst, displayName, qrBtn);
  const powerBtn = el('button', isRunning ? 'btn btn-danger' : 'btn btn-primary', isRunning ? 'Остановить' : 'Запустить');
  powerBtn.onclick = async () => {
    const action = isRunning ? 'stop' : 'start';
    if (action === 'stop' && !(await confirmBusyInstance(inst, 'Остановить'))) return;
    await withLoading(powerBtn, async () => {
      try {
        await api('/instances/' + inst.id + '/' + action, { method: 'POST' });
        showToast(action === 'stop' ? 'Остановлено' : 'Запущено');
        render();
      } catch (e) { showToast('Ошибка: ' + e.message, 'error'); }
    });
  };
  headActions.appendChild(pingBtn);
  headActions.appendChild(qrBtn);
  headActions.appendChild(powerBtn);
  head.appendChild(headActions);
  frame.main.appendChild(head);

  const body = el('div', 'body');

  // Panel 1: the hour, drawn the mockup's way, with the page's own facts.
  const channelPanel = el('section', 'panel');
  const channelHead = el('div', 'panel-head');
  channelHead.appendChild(el('h2', '', 'Канал за час'));
  const stateEl = el('div', 'state ' + state.cls);
  stateEl.appendChild(document.createTextNode(state.word + (state.why ? ' ' : '')));
  if (state.why) stateEl.appendChild(el('span', 'state-note', state.why));
  channelHead.appendChild(stateEl);
  channelPanel.appendChild(channelHead);

  const channelBody = el('div', '');
  channelBody.style.padding = 'var(--s-4)';
  channelBody.style.display = 'flex';
  channelBody.style.flexDirection = 'column';
  channelBody.style.gap = 'var(--s-4)';
  if (agg.runs.length) {
    const rail = el('i', 'rail');
    rail.setAttribute('style', 'height: 26px; background-image: ' + fmtRailGradient(agg));
    rail.setAttribute('aria-label', 'история канала за час, минута на деление');
    channelBody.appendChild(rail);
    const labels = el('div', 'rail-label');
    labels.appendChild(el('span', '', '−60 мин'));
    labels.appendChild(el('span', '', '−30 мин'));
    labels.appendChild(el('span', '', 'сейчас'));
    channelBody.appendChild(labels);
  } else {
    channelBody.appendChild(el('div', 'rail-empty', 'истории пока нет, рейка начнётся с первой минуты'));
  }

  const bytesKnown = agg.history.some(slot => slot && typeof slot.bytes === 'number');
  const hourBytes = agg.history.reduce((sum, slot) => sum + (slot && typeof slot.bytes === 'number' ? slot.bytes : 0), 0);
  const channelFacts = el('div', 'facts');
  channelFacts.style.padding = '0';
  channelFacts.style.gridTemplateColumns = 'repeat(auto-fit, minmax(140px, 1fr))';
  channelFacts.appendChild(makeFact('Объём', bytesKnown ? fmtByteVolume(hourBytes) : 'нет данных'));
  channelFacts.appendChild(makeFact('Клиентов на канале', String(peers)));
  channelFacts.appendChild(makeFact('Uptime', inst.uptime || '-'));
  channelFacts.appendChild(makeFact('Разрывов за час', String(agg.breaks)));
  channelFacts.appendChild(makeFact('Минут в буфере', agg.history.length + ' из 60'));
  channelBody.appendChild(channelFacts);
  channelPanel.appendChild(channelBody);
  body.appendChild(channelPanel);

  // Panel 2: what a client needs, then the service facts and the log tail.
  const connPanel = el('section', 'panel');
  const connHead = el('div', 'panel-head');
  connHead.appendChild(el('h2', '', 'Подключение'));
  connHead.appendChild(el('span', 'hint', 'клиент видит инстанс по QR и ссылке'));
  connPanel.appendChild(connHead);
  const connFacts = el('div', 'facts');
  connFacts.appendChild(makeFact(inst.carrier === 'openflux' ? 'Ссылка на документ' : 'Комната', inst.room_id || '—'));
  const codecBits = [];
  if (inst.openflux_codec) codecBits.push(inst.openflux_codec);
  if (inst.vp8_fps) codecBits.push(inst.vp8_fps + ' fps');
  if (inst.vp8_batch) codecBits.push('пакет ' + inst.vp8_batch);
  connFacts.appendChild(makeFact('Кодек', codecBits.join(', ') || '-'));
  connFacts.appendChild(makeFact('Выход', sys.public_ip || '-'));
  connFacts.appendChild(makeFact('Клиентов на канале', String(peers)));
  connPanel.appendChild(connFacts);

  const more = el('details', 'more');
  more.appendChild(el('summary', '', 'Служебное: токен авторизации, лимиты, лог'));
  const moreFacts = el('div', 'facts');
  const tokenValue = inst.has_auth_token
    ? ('задан' + (inst.auth_token_expires_at ? ', истекает ' + new Date(inst.auth_token_expires_at * 1000).toLocaleDateString() : ''))
    : 'не задан';
  moreFacts.appendChild(makeFact('Токен авторизации', tokenValue));
  if (inst.carrier === 'openflux') {
    moreFacts.appendChild(makeFact('Шифрование', inst.has_openflux_key ? 'AES-256-GCM' : 'без шифрования'));
  }
  if (inst.client_id) moreFacts.appendChild(makeFact('Client ID', inst.client_id));
  if (inst.dns) moreFacts.appendChild(makeFact('DNS', inst.dns));
  if (inst.socks_proxy) moreFacts.appendChild(makeFact('SOCKS', inst.socks_proxy));
  if (inst.warp_proxy) moreFacts.appendChild(makeFact('WARP', inst.warp_proxy));
  more.appendChild(moreFacts);
  const logPre = el('pre', 'num');
  logPre.style.margin = 'var(--s-3) 0 0';
  logPre.style.padding = 'var(--s-3)';
  logPre.style.background = 'var(--bg-deep)';
  logPre.style.border = '1px solid var(--line)';
  logPre.style.borderRadius = 'var(--r-1)';
  logPre.style.fontSize = 'var(--fs-11)';
  logPre.style.color = 'var(--ink-muted)';
  logPre.style.overflowX = 'auto';
  logPre.textContent = 'Загрузка...';
  more.appendChild(logPre);
  // The log is only fetched when the disclosure is opened: the page should not
  // pay for 20 lines of journal on every visit.
  more.addEventListener('toggle', async () => {
    if (!more.open) return;
    try {
      const data = await api('/system/logs/olcrtc-server@' + inst.id + '?lines=20');
      logPre.textContent = data.logs || '(пусто)';
    } catch (e) {
      logPre.textContent = 'Ошибка: ' + e.message;
    }
  });
  connPanel.appendChild(more);
  body.appendChild(connPanel);

  // Panel 3: the actions the mockup groups here.
  const actPanel = el('section', 'panel');
  const actHead = el('div', 'panel-head');
  actHead.appendChild(el('h2', '', 'Действия'));
  actHead.appendChild(el('span', 'hint', 'второстепенное живёт в «Конфиге»'));
  actPanel.appendChild(actHead);
  const actFacts = el('div', 'facts');

  const linkCell = el('div', '');
  linkCell.appendChild(el('div', 'fact-k', 'Ссылка для клиента'));
  const linkRow = el('div', 'fact-v');
  const copyBtn = el('button', 'btn btn-ghost btn-sm', 'Скопировать');
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(displayURI);
    showToast('URI скопирован');
  };
  const openQrBtn = el('button', 'btn btn-ghost btn-sm', 'Открыть QR');
  openQrBtn.onclick = () => openInstanceQR(inst, displayName, openQrBtn);
  linkRow.appendChild(copyBtn);
  linkRow.appendChild(document.createTextNode(' '));
  linkRow.appendChild(openQrBtn);
  linkCell.appendChild(linkRow);
  actFacts.appendChild(linkCell);

  const cfgCell = el('div', '');
  cfgCell.appendChild(el('div', 'fact-k', 'Конфигурация'));
  const cfgRow = el('div', 'fact-v');
  const editBtn = el('button', 'btn btn-ghost btn-sm', 'Изменить');
  editBtn.onclick = () => showConfigModal(inst);
  cfgRow.appendChild(editBtn);
  cfgCell.appendChild(cfgRow);
  actFacts.appendChild(cfgCell);

  const svcCell = el('div', '');
  svcCell.appendChild(el('div', 'fact-k', 'Сервис'));
  const svcRow = el('div', 'fact-v');
  const restartBtn = el('button', 'btn btn-ghost btn-sm', 'Перезапустить');
  restartBtn.onclick = async () => {
    if (!(await confirmBusyInstance(inst, 'Перезапустить'))) return;
    await withLoading(restartBtn, async () => {
      try {
        await api('/instances/' + inst.id + '/restart', { method: 'POST' });
        showToast('Перезапущено');
        render();
      } catch (e) { showToast('Ошибка: ' + e.message, 'error'); }
    });
  };
  const logsBtn = el('button', 'btn btn-ghost btn-sm', 'Логи');
  logsBtn.onclick = () => showLogsModal('olcrtc-server@' + inst.id);
  svcRow.appendChild(restartBtn);
  svcRow.appendChild(document.createTextNode(' '));
  svcRow.appendChild(logsBtn);
  svcCell.appendChild(svcRow);
  actFacts.appendChild(svcCell);

  actPanel.appendChild(actFacts);
  body.appendChild(actPanel);

  frame.main.appendChild(body);
  app.appendChild(frame.shell);
  startUsagePolling();
}

function metaRow(label, value, copyValue) {
  const row = el('div', 'flex items-center justify-between gap-2');
  row.appendChild(el('span', 'text-gray-500', label));
  const right = el('div', 'flex items-center gap-1.5 min-w-0');
  const valEl = el('span', 'copyable text-gray-300 truncate');
  valEl.title = value;
  valEl.textContent = value;
  right.appendChild(valEl);
  if (copyValue) {
    const cb = el('button', 'btn btn-ghost btn-sm btn-icon');
    cb.setAttribute('aria-label', 'Копировать ' + label);
    cb.title = 'Копировать';
    cb.innerHTML = icon('copy', 14);
    cb.onclick = (e) => { e.stopPropagation(); navigator.clipboard.writeText(copyValue); showToast(label + ' скопирован'); };
    right.appendChild(cb);
  }
  row.appendChild(right);
  return row;
}

function renderSubRow(sub, instances, sys, allSubs) {
  const row = el('div', 'card p-3 flex flex-col md:flex-row md:items-center justify-between gap-2');
  const subBase = (sys.subscription_public_url || sys.admin_url || location.origin).replace(/\/+$/, '');
  const subURL = subBase + '/sub/' + sub.slug;
  const openURL = subURL + '/open';
  const left = el('div', 'flex-1 min-w-0');
  left.innerHTML = `
    <div class="font-medium">${sub.name} <span class="text-gray-500">[${sub.slug}]</span></div>
    <div class="text-gray-400 text-xs mt-1 copyable truncate" title="${subURL}">${subURL}</div>
    <div class="text-gray-500 text-xs mt-1 copyable truncate" title="${openURL}">Обычная ссылка: ${openURL}</div>
  `;
  const right = el('div', 'flex gap-1.5 flex-wrap');
  const viewBtn = el('button', 'btn btn-secondary btn-sm');
  viewBtn.innerHTML = icon('eye') + '<span>Просмотр</span>';
  viewBtn.onclick = () => window.open(subURL, '_blank');
  const compositionBtn = el('button', 'btn btn-secondary btn-sm');
  compositionBtn.innerHTML = icon('settings') + '<span>Состав</span>';
  compositionBtn.onclick = () => showManageSubInstancesModal(sub, instances, allSubs);
  const qrBtn = el('button', 'btn btn-secondary btn-sm');
  qrBtn.innerHTML = icon('qr-code') + '<span>QR</span>';
  qrBtn.title = 'QR подписки: URL + encrypted mirror';
  qrBtn.onclick = async () => {
    await withLoading(qrBtn, async () => {
      try {
        let mirror = null;
        if (sys.mirror_enabled) {
          try {
            mirror = await api('/subs/' + sub.slug + '/mirror', { method: 'POST', body: '{}' });
          } catch (e) {
            throw new Error('Yandex mirror включён, но синхронизация не удалась: ' + e.message);
          }
        }
        const bundle = buildSubscriptionBundle(sub, subURL, mirror);
        showQRModal(bundle, { subscriptionBundle: true, name: sub.name });
      } catch (e) {
        showToast('Ошибка QR подписки: ' + e.message, 'error');
      }
    });
  };
  const linkBtn = el('button', 'btn btn-secondary btn-sm');
  linkBtn.innerHTML = icon('link') + '<span>Ссылка</span>';
  linkBtn.title = 'Скопировать прямую bootstrap-ссылку с ключом Yandex mirror. Передавайте только получателю подписки.';
  linkBtn.onclick = async () => {
    await withLoading(linkBtn, async () => {
      try {
        if (!sys.mirror_enabled) throw new Error('сначала включите Yandex Disk mirror в настройках');
        const mirror = await api('/subs/' + sub.slug + '/mirror', { method: 'POST', body: '{}' });
        const bootstrapURL = buildSubscriptionBootstrapLink(sub, subURL, mirror);
        await navigator.clipboard.writeText(bootstrapURL);
        showToast('Прямая bootstrap-ссылка скопирована');
      } catch (e) {
        showToast('Ошибка bootstrap-ссылки: ' + e.message, 'error');
      }
    });
  };
  const delBtn = el('button', 'btn btn-danger btn-sm btn-icon');
  delBtn.setAttribute('aria-label', 'Удалить подписку');
  delBtn.title = 'Удалить';
  delBtn.innerHTML = icon('trash-2');
  delBtn.onclick = async () => {
    const ok = await showConfirm({
      title: 'Удалить подписку «' + sub.name + '»?',
      message: 'Все инстансы будут отвязаны, URL перестанет работать, а mirror JSON будет удалён с Yandex Disk.',
      danger: true,
    });
    if (!ok) return;
    try {
      await api('/subs/' + sub.slug, { method: 'DELETE' });
      showToast('Подписка удалена');
      render();
    } catch (e) { showToast('Ошибка: ' + e.message, 'error'); }
  };
  right.appendChild(viewBtn);
  right.appendChild(compositionBtn);
  right.appendChild(qrBtn);
  right.appendChild(linkBtn);
  right.appendChild(delBtn);
  row.appendChild(left);
  row.appendChild(right);
  return row;
}

function buildSubscriptionBundle(sub, subURL, mirror) {
  return JSON.stringify({
    type: 'olcrtc-sub',
    v: 2,
    n: sub.name || 'OlConnect subscription',
    s: sub.slug,
    u: subURL,
    m: mirror && mirror.url && mirror.key ? [{ t: mirror.type || 'yandex_disk', u: mirror.url, e: true, a: 'AES-256-GCM' }] : [],
    mk: mirror && mirror.key ? mirror.key : '',
    uc: false,
    d: true,
  });
}

function buildSubscriptionBootstrapLink(sub, subURL, mirror) {
  if (!mirror || !mirror.url || !mirror.key) throw new Error('Yandex mirror не содержит URL или ключ');
  const query = new URLSearchParams({
    url: subURL,
    name: sub.name || 'OlConnect subscription',
    mirror_type: mirror.type || 'yandex_disk',
    mirror_url: mirror.url,
    mirror_key: mirror.key,
  });
  return 'olconnect://subscription?' + query.toString();
}

async function gzipBytes(text) {
  if (window.pako && typeof window.pako.gzip === 'function') {
    return new Uint8Array(window.pako.gzip(text));
  }
  if (typeof CompressionStream !== 'undefined' && typeof TextEncoder !== 'undefined') {
    const stream = new Blob([new TextEncoder().encode(text)])
      .stream()
      .pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return null;
}

async function optimizeQRPayload(payload) {
  const original = String(payload || '');
  if (!original) {
    return { text: original, compressed: false, originalLength: original.length };
  }
  try {
    const compressed = await gzipBytes(original);
    if (!compressed) {
      return { text: original, compressed: false, originalLength: original.length };
    }
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < compressed.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, compressed.subarray(i, i + chunkSize));
    }
    const b64url = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const packed = 'olcrtc+gz:' + b64url;
    if (packed.length + 24 < original.length || original.length > 900) {
      return { text: packed, compressed: true, originalLength: original.length };
    }
  } catch (e) {
    console.warn('QR gzip optimization failed:', e);
  }
  return { text: original, compressed: false, originalLength: original.length };
}

async function splitSubscriptionQRPayload(payload) {
  if (payload.length <= 900) return [payload];
  if (!/^[\x20-\x7e]+$/.test(payload)) throw new Error('multipart QR требует gzip payload');
  if (typeof crypto === 'undefined' || !crypto.subtle || typeof TextEncoder === 'undefined') {
    throw new Error('браузер не поддерживает SHA-256 для multipart QR');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const bundleID = hash.slice(0, 16);
  const chunkSize = 900;
  const total = Math.ceil(payload.length / chunkSize);
  if (total > 128) throw new Error('подписка слишком большая для multipart QR');
  return Array.from({ length: total }, (_, index) =>
    `olcrtc+part:1:${bundleID}:${index + 1}/${total}:${hash}:${payload.slice(index * chunkSize, (index + 1) * chunkSize)}`
  );
}


function roomTailOrDefault(current) {
  const value = (current || '').trim();
  const m = value.match(/^https?:\/\/[^\/]+(\/.*)?$/);
  if (m) return m[1] || '/';
  if (value && !value.includes('/')) return '/' + value;
  const rnd = Math.random().toString(36).slice(2, 10);
  return '/olcrtc-' + rnd;
}

function applyJitsiPresetHost(roomInput, host) {
  const tail = roomTailOrDefault(roomInput.value);
  roomInput.value = 'https://' + host + tail;
  roomInput.focus();
}

function currentJitsiURL(roomInput) {
  const value = (roomInput.value || '').trim();
  if (value) return value;
  return 'https://meet.jit.si/' + roomTailOrDefault(value);
}

function createJitsiPresetPanel(roomInput, bridgeModeInput, transportInput) {
  const wrap = el('div', 'mb-3 text-xs text-gray-400 hidden');
  const head = el('div', 'flex items-center justify-between gap-2 mb-2 flex-wrap');
  const title = el('div', 'font-medium text-gray-300');
  title.innerHTML = 'Jitsi servers <span class="text-gray-500">(проверенные публичные хосты)</span>';
  const actions = el('div', 'flex items-center gap-2 flex-wrap');
  const checkBtn = el('button', 'btn btn-secondary btn-sm');
  checkBtn.type = 'button';
  checkBtn.innerHTML = icon('wifi', 12) + '<span>Проверить выбранный</span>';
  actions.appendChild(checkBtn);
  head.appendChild(title);
  head.appendChild(actions);
  wrap.appendChild(head);

  const info = el('div', 'text-gray-500 mb-2 leading-relaxed');
  info.innerHTML = 'Выбери host, потом оставь или измени имя комнаты после <code>/</code>. ' +
    '<b>⭐ preferred</b> — хорошие кандидаты для fallback-профилей. ' +
    'Colibri WS нельзя гарантировать по одному config.js: он подтверждается при запуске комнаты. Для скорости используй <b>datachannel + bridge=auto</b>, а для диагностики можно поставить <b>bridge=colibri-ws</b>.';
  wrap.appendChild(info);

  const btns = el('div', 'flex flex-wrap gap-1.5');
  JITSI_PRESETS.forEach((preset) => {
    const btn = el('button', 'px-2 py-1 rounded border text-xs');
    btn.type = 'button';
    btn.dataset.host = preset.host;
    btn.style.borderColor = preset.preferred ? 'rgba(34,197,94,.55)' : 'var(--color-hairline)';
    btn.style.color = preset.preferred ? '#86efac' : '';
    btn.title = preset.host + ' · ' + preset.note;
    btn.textContent = (preset.preferred ? '⭐ ' : '') + preset.label;
    btn.addEventListener('mouseenter', () => {
      btn.style.borderColor = 'var(--color-primary)';
      btn.style.color = 'var(--color-primary)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.borderColor = preset.preferred ? 'rgba(34,197,94,.55)' : 'var(--color-hairline)';
      btn.style.color = preset.preferred ? '#86efac' : '';
    });
    btn.addEventListener('click', () => applyJitsiPresetHost(roomInput, preset.host));
    btns.appendChild(btn);
  });
  wrap.appendChild(btns);

  const result = el('div', 'mt-2 text-xs text-gray-500');
  wrap.appendChild(result);
  checkBtn.onclick = async () => {
    const url = currentJitsiURL(roomInput);
    await withLoading(checkBtn, async () => {
      try {
        const res = await api('/jitsi/check?url=' + encodeURIComponent(url));
        const cls = res.ok ? 'text-emerald-300' : 'text-amber-300';
        result.className = 'mt-2 text-xs ' + cls;
        result.innerHTML = (res.ok ? 'OK' : 'WARN') + ': ' + (res.host || url) +
          ' · ' + (res.latency_ms || '-') + 'ms' +
          ' · BOSH=' + (!!res.has_bosh) +
          ' · WS=' + (!!res.has_websocket) +
          ' · Colibri hint=' + (!!res.colibri_ws_hint) +
          '<br>' + (res.message || '');
        if (bridgeModeInput && res.recommended_mode && bridgeModeInput.value === 'auto') {
          bridgeModeInput.value = res.recommended_mode === 'sctp' ? 'auto' : res.recommended_mode;
        }
        if (transportInput && res.ok && transportInput.value === 'datachannel') {
          // keep user choice, only hint in UI
        }
      } catch (e) {
        result.className = 'mt-2 text-xs text-red-300';
        result.textContent = 'Ошибка проверки: ' + e.message;
      }
    });
  };
  return wrap;
}

// ── Settings page ────────────────────────────────────────────────────────────
let activeSettingsTab = localStorage.getItem('olcrtc_settings_tab') || 'network';

async function renderSettings(app) {
  const frame = renderShell('settings');
  const main = frame.main;
  const wrap = el('div', 'max-w-3xl mx-auto');

  let sys = {};
  try { sys = await api('/system/status'); } catch (e) {}
  let wbAutomation = {};
  try { wbAutomation = await api('/wb-automation/components'); } catch (e) {}

  // Top Title
  const header = el('div', 'flex items-center justify-between mb-4');
  header.innerHTML = '<h2 class="text-xl font-bold" style="color:var(--color-ink);">Настройки сервера</h2>';
  wrap.appendChild(header);

  // Tabs Bar
  const tabBar = el('div', 'tab-bar');
  const tabs = [
    { id: 'network', label: 'Сеть и домены', icon: 'wifi' },
    { id: 'updates', label: 'Обновления и логи', icon: 'download' },
    { id: 'security', label: 'Безопасность', icon: 'key' },
    { id: 'integrations', label: 'Интеграции', icon: 'sliders-horizontal' },
  ];

  const panes = {};
  const tabButtons = {};

  function switchTab(targetId) {
    activeSettingsTab = targetId;
    localStorage.setItem('olcrtc_settings_tab', targetId);
    tabs.forEach(t => {
      const btn = tabButtons[t.id];
      const pane = panes[t.id];
      if (btn) {
        if (t.id === targetId) btn.classList.add('tab-btn-active');
        else btn.classList.remove('tab-btn-active');
      }
      if (pane) {
        pane.style.display = t.id === targetId ? 'flex' : 'none';
      }
    });
  }

  tabs.forEach(t => {
    const btn = el('button', 'tab-btn' + (t.id === activeSettingsTab ? ' tab-btn-active' : ''));
    btn.innerHTML = icon(t.icon, 16) + '<span>' + t.label + '</span>';
    btn.onclick = () => switchTab(t.id);
    tabButtons[t.id] = btn;
    tabBar.appendChild(btn);
  });
  wrap.appendChild(tabBar);

  // --- Pane 1: Network & Domains ---
  const paneNetwork = el('div', 'flex flex-col gap-4');
  paneNetwork.style.display = activeSettingsTab === 'network' ? 'flex' : 'none';
  panes['network'] = paneNetwork;

  // Domain Card
  const domCard = el('div', 'card p-5 flex flex-col gap-3');
  domCard.innerHTML = `
    <div class="flex items-center gap-2">
      ${icon('shield', 18)}
      <h3 class="font-bold text-base" style="color:var(--color-ink);">Основной домен сервера (TLS)</h3>
    </div>
    <div class="text-xs" style="color:var(--color-ink-subtle);">
      Привязка домена для автоматического получения и продления SSL-сертификата Let's Encrypt (порты 80/443).
    </div>
  `;
  const domCurrent = el('div', 'text-sm mb-1', sys.domain ? 'Текущий домен: ' + sys.domain : 'Текущий домен: (не привязан, self-signed)');
  domCurrent.style.color = sys.domain ? 'var(--color-primary)' : 'var(--color-ink-muted)';
  domCurrent.style.fontWeight = '500';
  const domInp = el('input', '');
  domInp.placeholder = 'sub.example.com';
  domInp.setAttribute('aria-label', 'Домен');
  const domRow = el('div', 'flex gap-2 flex-wrap items-center mt-1');
  const domBtn = el('button', 'btn btn-primary');
  domBtn.textContent = 'Привязать домен';
  domBtn.onclick = async () => {
    await withLoading(domBtn, async () => {
      try {
        const res = await api('/system/domain', { method: 'POST', body: JSON.stringify({ domain: domInp.value }) });
        showToast(res.message || 'Домен привязан');
        render();
      } catch (e) {
        try { const err = JSON.parse(e.message); showToast(err.message || e.message, 'error'); }
        catch { showToast(e.message, 'error'); }
      }
    });
  };
  domRow.appendChild(domBtn);
  if (sys.domain) {
    const unbindBtn = el('button', 'btn btn-danger');
    unbindBtn.textContent = 'Отвязать домен';
    unbindBtn.onclick = async () => {
      const ok = await showConfirm({ title: 'Отвязать домен?', message: 'Сервер вернётся к self-signed сертификату после перезапуска.', danger: true });
      if (!ok) return;
      await api('/system/domain', { method: 'DELETE' });
      render();
    };
    domRow.appendChild(unbindBtn);
  }
  domCard.appendChild(domCurrent);
  domCard.appendChild(domInp);
  domCard.appendChild(domRow);
  paneNetwork.appendChild(domCard);

  // Subscription URL Card
  const subUrlCard = el('div', 'card p-5 flex flex-col gap-3');
  subUrlCard.innerHTML = `
    <div class="flex items-center gap-2">
      ${icon('tag', 18)}
      <h3 class="font-bold text-base" style="color:var(--color-ink);">Публичный URL подписок</h3>
    </div>
    <div class="text-xs" style="color:var(--color-ink-subtle);">
      Укажите FreeDNS или внешний домен (например, https://your-domain.mooo.com). Ссылки подписок для клиентов будут формироваться с этим адресом.
    </div>
  `;
  const subUrlCurrent = el('div', 'text-sm mb-1', sys.subscription_public_url ? 'Текущий URL: ' + sys.subscription_public_url : 'Текущий: используется базовый URL админки');
  subUrlCurrent.style.color = sys.subscription_public_url ? 'var(--color-primary)' : 'var(--color-ink-muted)';
  subUrlCurrent.style.fontWeight = '500';
  const subUrlInp = el('input', '');
  subUrlInp.placeholder = 'https://your-domain.mooo.com';
  subUrlInp.value = sys.subscription_public_url || '';
  subUrlInp.setAttribute('aria-label', 'Публичный URL подписок');
  const subUrlRow = el('div', 'flex gap-2 flex-wrap items-center mt-1');
  const subUrlBtn = el('button', 'btn btn-primary');
  subUrlBtn.textContent = 'Сохранить URL подписок';
  subUrlBtn.onclick = async () => {
    await withLoading(subUrlBtn, async () => {
      try {
        const res = await api('/system/subscription-url', { method: 'POST', body: JSON.stringify({ public_url: subUrlInp.value }) });
        showToast(res.message || 'URL подписок сохранён');
        render();
      } catch (e) {
        try { const err = JSON.parse(e.message); showToast(err.message || e.message, 'error'); }
        catch { showToast(e.message, 'error'); }
      }
    });
  };
  subUrlRow.appendChild(subUrlBtn);
  if (sys.subscription_public_url) {
    const resetSubUrlBtn = el('button', 'btn btn-secondary');
    resetSubUrlBtn.textContent = 'Сбросить';
    resetSubUrlBtn.onclick = async () => {
      await api('/system/subscription-url', { method: 'DELETE' });
      render();
    };
    subUrlRow.appendChild(resetSubUrlBtn);
  }
  subUrlCard.appendChild(subUrlCurrent);
  subUrlCard.appendChild(subUrlInp);
  subUrlCard.appendChild(subUrlRow);
  paneNetwork.appendChild(subUrlCard);

  // Ports Card
  const portCard = el('div', 'card p-5 flex flex-col gap-3');
  portCard.innerHTML = `
    <div class="flex items-center gap-2">
      ${icon('wifi', 18)}
      <h3 class="font-bold text-base" style="color:var(--color-ink);">Порты и маршрутизация</h3>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-1">
      <div class="metric-card">
        <div class="text-xs uppercase font-semibold tracking-wider" style="color:var(--color-ink-subtle);">Admin UI</div>
        <div class="text-sm font-semibold copyable mt-1" style="color:var(--color-ink);">${sys.admin_port || '-'}</div>
      </div>
      <div class="metric-card">
        <div class="text-xs uppercase font-semibold tracking-wider" style="color:var(--color-ink-subtle);">Подписки</div>
        <div class="text-sm font-semibold copyable mt-1" style="color:var(--color-ink);">/sub/&lt;slug&gt;</div>
      </div>
      <div class="metric-card">
        <div class="text-xs uppercase font-semibold tracking-wider" style="color:var(--color-ink-subtle);">Legacy sub port</div>
        <div class="text-sm font-semibold copyable mt-1" style="color:var(--color-ink);">${sys.sub_port || '-'}</div>
      </div>
    </div>
  `;
  paneNetwork.appendChild(portCard);
  wrap.appendChild(paneNetwork);

  // --- Pane 2: Updates & Logs ---
  const paneUpdates = el('div', 'flex flex-col gap-4');
  paneUpdates.style.display = activeSettingsTab === 'updates' ? 'flex' : 'none';
  panes['updates'] = paneUpdates;

  // Server Updates Card
  const updateCard = el('div', 'card p-5 flex flex-col gap-3');
  updateCard.innerHTML = `
    <div class="flex items-center gap-2">
      ${icon('download', 18)}
      <h3 class="font-bold text-base" style="color:var(--color-ink);">Обновления сервера</h3>
    </div>
  `;
  const currentSysVersion = (sys.version || '').toString();
  const currentSysBranch = (sys.release_branch || 'master').toString();
  const versionInfo = el('div', 'flex items-center gap-4 text-sm');
  versionInfo.innerHTML = `
    <div>Версия: <span class="font-mono font-semibold" style="color:var(--color-primary);">${currentSysVersion || '-'}</span></div>
    <div>Ветка: <span class="font-mono font-semibold" style="color:var(--color-ink);">${currentSysBranch}</span></div>
  `;
  updateCard.appendChild(versionInfo);

  const updateRow = el('div', 'flex gap-2 flex-wrap items-center mt-1');
  const checkBtn = el('button', 'btn btn-secondary');
  checkBtn.innerHTML = icon('refresh-cw') + '<span>Проверить обновления</span>';
  updateRow.appendChild(checkBtn);
  updateCard.appendChild(updateRow);

  const branchRow = el('div', 'flex gap-2 flex-wrap items-center mt-2');
  const branchLabel = el('span', 'text-sm font-medium', 'Ветка бинарников:');
  branchLabel.style.color = 'var(--color-ink-muted)';
  const branchSelect = el('select', '');
  branchSelect.style.cssText = 'max-width:240px;';
  branchSelect.setAttribute('aria-label', 'Ветка бинарников');
  const releaseBranchStorageKey = 'olcrtc-release-branch';
  let preferredBranch = 'master';
  try { preferredBranch = localStorage.getItem(releaseBranchStorageKey) || 'master'; } catch (e) {}
  ['master'].concat(preferredBranch === 'master' ? [] : [preferredBranch]).forEach((branch) => {
    const opt = el('option', '', branch);
    opt.textContent = branch === 'master' ? 'master (стабильная)' : branch;
    branchSelect.appendChild(opt);
  });
  branchSelect.value = preferredBranch;
  branchRow.appendChild(branchLabel);
  branchRow.appendChild(branchSelect);
  updateCard.appendChild(branchRow);

  // Version selector + install button row
  const selectorRow = el('div', 'flex gap-2 flex-wrap items-center mt-2');
  selectorRow.style.display = 'none';
  const selectorLabel = el('span', 'text-sm font-medium', 'Установить версию:');
  selectorLabel.style.color = 'var(--color-ink-muted)';
  const versionSelect = el('select', '');
  versionSelect.style.cssText = 'max-width:240px;';
  const installBtn = el('button', 'btn btn-primary');
  let availableReleases = [];

  function normVer(v) { return ('' + (v || '')).replace(/^v/, ''); }
  function selectedRelease() { return availableReleases.find((release) => release.tag === versionSelect.value); }
  function refreshInstallBtn() {
    const target = selectedRelease();
    const isCurrent = !!target && target.branch === currentSysBranch && normVer(target.version) === normVer(currentSysVersion);
    installBtn.disabled = !target || isCurrent;
    installBtn.style.opacity = installBtn.disabled ? '0.5' : '1';
    installBtn.style.cursor = installBtn.disabled ? 'not-allowed' : 'pointer';
    if (!target) {
      installBtn.innerHTML = icon('download') + '<span>Установить</span>';
    } else if (isCurrent) {
      installBtn.innerHTML = icon('check-circle') + '<span>Версия установлена</span>';
    } else {
      installBtn.innerHTML = icon('download') + '<span>Установить ' + target.version + '</span>';
    }
  }
  versionSelect.onchange = refreshInstallBtn;
  installBtn.onclick = async () => {
    const target = selectedRelease();
    if (!target || (target.branch === currentSysBranch && normVer(target.version) === normVer(currentSysVersion))) return;
    const isDowngrade = compareSemverJS(normVer(target.version), normVer(currentSysVersion)) < 0;
    let activePeers = 0;
    try {
      const usage = await api('/instances/usage');
      activePeers = Number(usage.active_peers) || 0;
    } catch (e) {
      console.error('Не удалось проверить активные подключения перед обновлением', e);
    }
    const busyWarning = activePeers > 0 ? 'Сейчас активно подключений: ' + activePeers + '. Они будут оборваны. ' : '';
    const ok = await showConfirm({
      title: isDowngrade ? 'Откатить версию?' : 'Обновить сервер?',
      message: busyWarning + (isDowngrade ? 'Будет установлена более старая версия ' : 'Будет установлена версия ') + target.version +
        ' из ветки ' + target.branch + '. Сервер и админка будут остановлены, заменены и перезапущены. Это займёт 1-2 минуты.',
      danger: activePeers > 0,
      confirmText: isDowngrade ? 'Откатить' : 'Установить',
    });
    if (!ok) return;
    showUpdateOverlay(target.version, target.branch, () =>
      api('/system/update', { method: 'POST', body: JSON.stringify({ tag: target.tag, branch: target.branch, version: target.version }) }));
  };

  selectorRow.appendChild(selectorLabel);
  selectorRow.appendChild(versionSelect);
  selectorRow.appendChild(installBtn);
  updateCard.appendChild(selectorRow);

  function renderVersionsForBranch() {
    const branch = branchSelect.value;
    const list = availableReleases.filter((release) => release.branch === branch);
    list.sort((a, b) => compareSemverJS(normVer(b.version), normVer(a.version)));
    versionSelect.innerHTML = '';
    if (!list.length) {
      const opt = el('option', '');
      opt.value = '';
      opt.textContent = 'Нет доступных версий';
      versionSelect.appendChild(opt);
      refreshInstallBtn();
      return;
    }
    list.forEach((release, index) => {
      const opt = el('option', '');
      opt.value = release.tag;
      let label = release.version;
      if (release.branch === currentSysBranch && normVer(release.version) === normVer(currentSysVersion)) label += ' (текущая)';
      else if (index === 0) label += ' (последняя)';
      opt.textContent = label;
      versionSelect.appendChild(opt);
    });
    const current = list.find((release) => release.branch === currentSysBranch && normVer(release.version) === normVer(currentSysVersion));
    const newest = list[0];
    versionSelect.value = current && compareSemverJS(normVer(newest.version), normVer(currentSysVersion)) <= 0 ? current.tag : newest.tag;
    refreshInstallBtn();
  }

  branchSelect.onchange = () => {
    try { localStorage.setItem(releaseBranchStorageKey, branchSelect.value); } catch (e) {}
    renderVersionsForBranch();
  };

  async function loadReleasesIntoSelect() {
    try {
      const rel = await api('/system/releases');
      availableReleases = (rel && rel.releases) || [];
      const requestedBranch = branchSelect.value || preferredBranch;
      const branches = Array.from(new Set(['master'].concat(availableReleases.map((release) => release.branch))));
      branches.sort((a, b) => a === b ? 0 : (a === 'master' ? -1 : (b === 'master' ? 1 : a.localeCompare(b))));
      branchSelect.innerHTML = '';
      branches.forEach((branch) => {
        const opt = el('option', '');
        opt.value = branch;
        opt.textContent = branch === 'master' ? 'master (стабильная)' : branch;
        branchSelect.appendChild(opt);
      });
      branchSelect.value = branches.includes(requestedBranch) ? requestedBranch : 'master';
      renderVersionsForBranch();
      selectorRow.style.display = '';
      return true;
    } catch (e) {
      availableReleases = [];
      versionSelect.innerHTML = '';
      const opt = el('option', '');
      opt.value = '';
      opt.textContent = 'Не удалось загрузить список версий';
      versionSelect.appendChild(opt);
      refreshInstallBtn();
      return false;
    }
  }

  checkBtn.onclick = async () => {
    await withLoading(checkBtn, async () => {
      try {
        const res = await api('/system/check-updates');
        await loadReleasesIntoSelect();
        const selectedBranch = branchSelect.value;
        const selectedLatest = availableReleases
          .filter((release) => release.branch === selectedBranch)
          .sort((a, b) => compareSemverJS(normVer(b.version), normVer(a.version)))[0];
        if (selectedBranch !== 'master' && selectedLatest) {
          const isCurrent = selectedBranch === currentSysBranch && normVer(selectedLatest.version) === normVer(currentSysVersion);
          showToast(isCurrent
            ? 'У вас установлена последняя версия ветки ' + selectedBranch
            : 'В ветке ' + selectedBranch + ' доступна версия ' + selectedLatest.version,
          isCurrent ? 'success' : 'info');
        } else if (res.update_available) {
          let toastMsg = 'Доступна новая версия: ' + res.latest_version;
          if (res.stale) toastMsg = 'GitHub недоступен. Последние известные данные: ' + res.latest_version;
          showToast(toastMsg, 'info');
        } else {
          let msg = 'У вас установлена последняя версия';
          if (res.stale) msg = 'GitHub недоступен, проверка по последним известным данным: версия актуальна';
          showToast(msg, 'success');
        }
      } catch (e) {
        let errMsg = e.message;
        try {
          const parsed = JSON.parse(e.message);
          if (parsed.message) errMsg = parsed.message;
        } catch {}
        showToast('Ошибка проверки: ' + errMsg, 'error');
      }
    });
  };

  paneUpdates.appendChild(updateCard);
  loadReleasesIntoSelect();

  // OpenFlux Binary Card
  const openfluxCard = el('div', 'card p-5 flex flex-col gap-3');
  openfluxCard.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        ${icon('layers', 18)}
        <h3 class="font-bold text-base" style="color:var(--color-ink);">Бинарник OpenFlux (Exit-Node)</h3>
      </div>
      <span id="openfluxBadge" class="badge" style="background:var(--color-surface-hover); color:var(--color-ink);">Проверка...</span>
    </div>
    <div class="text-xs" style="color:var(--color-ink-subtle);">
      Исполняемый файл exit-ноды OpenFlux (/usr/local/bin/openflux) для туннелирования трафика через Яндекс и Mail.ru Документы.
    </div>
    <div id="openfluxInfoRow" class="text-xs" style="color:var(--color-ink-muted); display:none;">
      Установлена: <strong id="openfluxInstalledVer">—</strong> &bull; Доступна: <strong id="openfluxLatestVer">—</strong>
    </div>
    <div class="flex gap-2 flex-wrap items-center mt-1">
      <button id="openfluxCheckBtn" class="btn btn-secondary btn-sm">${icon('refresh-cw', 14)}<span>Проверить</span></button>
      <button id="openfluxUpdateBtn" class="btn btn-primary btn-sm" style="display:none;">${icon('download', 14)}<span>Обновить OpenFlux</span></button>
    </div>
  `;

  const ofBadge = openfluxCard.querySelector('#openfluxBadge');
  const ofInfoRow = openfluxCard.querySelector('#openfluxInfoRow');
  const ofInstalledVer = openfluxCard.querySelector('#openfluxInstalledVer');
  const ofLatestVer = openfluxCard.querySelector('#openfluxLatestVer');
  const ofCheckBtn = openfluxCard.querySelector('#openfluxCheckBtn');
  const ofUpdateBtn = openfluxCard.querySelector('#openfluxUpdateBtn');

  async function loadOpenFluxStatus() {
    try {
      const res = await api('/system/openflux/status');
      ofInfoRow.style.display = '';
      ofInstalledVer.textContent = res.installed_version || (res.installed ? 'установлен' : 'не установлен');
      ofLatestVer.textContent = res.latest_version || 'неизвестно';
      if (!res.installed) {
        ofBadge.className = 'badge badge-warning';
        ofBadge.textContent = 'Не установлен';
        ofUpdateBtn.style.display = '';
        ofUpdateBtn.querySelector('span').textContent = 'Установить OpenFlux';
      } else if (res.update_available) {
        ofBadge.className = 'badge badge-info';
        ofBadge.textContent = 'Доступно: ' + res.latest_version;
        ofUpdateBtn.style.display = '';
        ofUpdateBtn.querySelector('span').textContent = 'Обновить до ' + res.latest_version;
      } else {
        ofBadge.className = 'badge badge-success';
        ofBadge.textContent = res.installed_version || 'Актуальная версия';
        ofUpdateBtn.style.display = 'none';
      }
    } catch (e) {
      ofBadge.className = 'badge';
      ofBadge.textContent = 'Ошибка проверки';
    }
  }

  ofCheckBtn.onclick = async () => {
    await withLoading(ofCheckBtn, async () => {
      await loadOpenFluxStatus();
      showToast('Статус OpenFlux проверен', 'info');
    });
  };

  ofUpdateBtn.onclick = async () => {
    const ok = await showConfirm({
      title: 'Обновить OpenFlux?',
      message: 'Бинарник /usr/local/bin/openflux будет обновлен до актуальной версии с GitHub Releases. Все запущенные инстансы OpenFlux будут перезапущены.',
      confirmText: 'Обновить',
    });
    if (!ok) return;
    await withLoading(ofUpdateBtn, async () => {
      try {
        const res = await api('/system/openflux/update', { method: 'POST' });
        showToast(res.message || 'OpenFlux успешно обновлен', 'success');
        await loadOpenFluxStatus();
      } catch (e) {
        showToast('Ошибка обновления: ' + e.message, 'error');
      }
    });
  };

  paneUpdates.appendChild(openfluxCard);
  loadOpenFluxStatus();

  // Logs Card
  const logsCard = el('div', 'card p-5 flex flex-col gap-3');
  logsCard.innerHTML = `
    <div class="flex items-center gap-2">
      ${icon('sliders-horizontal', 18)}
      <h3 class="font-bold text-base" style="color:var(--color-ink);">Системные логи</h3>
    </div>
    <div class="text-xs" style="color:var(--color-ink-subtle);">
      Просмотр журналов journalctl systemd для отладки туннелей и веб-сервера.
    </div>
  `;
  const logsWrap = el('div', 'flex gap-2 flex-wrap mt-1');
  ['olcrtc-server', 'olcrtc-admin'].forEach(svc => {
    const btn = el('button', 'btn btn-secondary btn-sm');
    btn.innerHTML = icon('eye', 14) + '<span>' + svc + '</span>';
    btn.onclick = () => showLogsModal(svc);
    logsWrap.appendChild(btn);
  });
  logsCard.appendChild(logsWrap);
  paneUpdates.appendChild(logsCard);
  wrap.appendChild(paneUpdates);

  // --- Pane 3: Security ---
  const paneSecurity = el('div', 'flex flex-col gap-4');
  paneSecurity.style.display = activeSettingsTab === 'security' ? 'flex' : 'none';
  panes['security'] = paneSecurity;

  const secCard = el('div', 'card p-5 flex flex-col gap-3');
  secCard.innerHTML = `
    <div class="flex items-center gap-2">
      ${icon('key', 18)}
      <h3 class="font-bold text-base" style="color:var(--color-ink);">Учётная запись администратора</h3>
    </div>
    <div class="text-xs" style="color:var(--color-ink-subtle);">
      Смена логина и пароля для входа в панель управления OlConnect Manager.
    </div>
  `;
  const secGrid = el('div', 'grid grid-cols-1 md:grid-cols-2 gap-3 mt-1');
  const userField = makeInputField('Логин', icon('tag', 14), creds ? creds.username : 'admin', {});
  const passField = makeInputField('Пароль', icon('lock', 14), creds ? creds.password : '', { placeholder: 'Новый пароль' });
  passField.input.type = 'password';
  secGrid.appendChild(userField.field);
  secGrid.appendChild(passField.field);
  secCard.appendChild(secGrid);

  const secRow = el('div', 'flex gap-2 mt-1');
  const changeCredsBtn = el('button', 'btn btn-primary');
  changeCredsBtn.textContent = 'Сохранить новый пароль';
  changeCredsBtn.onclick = async () => {
    const u = userField.input.value.trim();
    const p = passField.input.value.trim();
    if (!u || !p) { showToast('Логин и пароль обязательны', 'error'); return; }
    await withLoading(changeCredsBtn, async () => {
      try {
        await api('/auth/change-credentials', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
        creds = { username: u, password: p };
        localStorage.setItem('olcrtc_creds', JSON.stringify(creds));
        showToast('Логин/пароль успешно обновлены');
      } catch (e) { showToast('Ошибка: ' + e.message, 'error'); }
    });
  };
  secRow.appendChild(changeCredsBtn);
  secCard.appendChild(secRow);
  paneSecurity.appendChild(secCard);
  wrap.appendChild(paneSecurity);

  // --- Pane 4: Integrations ---
  const paneIntegrations = el('div', 'flex flex-col gap-4');
  paneIntegrations.style.display = activeSettingsTab === 'integrations' ? 'flex' : 'none';
  panes['integrations'] = paneIntegrations;

  // WB Stream Card
  const wbCard = el('div', 'card p-5 flex flex-col gap-3');
  wbCard.innerHTML = `
    <div class="flex items-center gap-2">
      ${icon('video', 18)}
      <h3 class="font-bold text-base" style="color:var(--color-ink);">WB Stream · Автоматизация браузера</h3>
    </div>
    <div class="text-xs" style="color:var(--color-ink-subtle);">
      Удалённый Chromium на VPS (Playwright, noVNC) запускается только на время входа для автоматического получения токенов.
    </div>
  `;
  const wbStatus = el('div', 'text-sm font-medium mt-1');
  wbStatus.textContent = !wbAutomation.supported
    ? 'Платформа не поддерживается'
    : (wbAutomation.installed ? 'Компоненты установлены' : 'Компоненты не установлены');
  wbStatus.style.color = wbAutomation.installed ? 'var(--color-success)' : 'var(--color-ink-subtle)';
  wbCard.appendChild(wbStatus);

  if (wbAutomation.token_expires_at) {
    const expiry = new Date(wbAutomation.token_expires_at * 1000);
    const tokenLine = el('div', 'text-xs font-semibold');
    tokenLine.style.color = wbAutomation.token_expired ? 'var(--color-error)' : 'var(--color-success)';
    tokenLine.textContent = wbAutomation.token_expired
      ? 'Общий WB-токен истёк: ' + expiry.toLocaleString()
      : 'Общий WB-токен действует до: ' + expiry.toLocaleString();
    wbCard.appendChild(tokenLine);
  }

  const wbButtons = el('div', 'flex gap-2 flex-wrap mt-1');
  if (!wbAutomation.installed && wbAutomation.supported) {
    const installWBBtn = el('button', 'btn btn-primary');
    installWBBtn.textContent = 'Установить компоненты';
    installWBBtn.onclick = async () => {
      const ok = await showConfirm({
        title: 'Установить автоматизацию WB?',
        message: 'Будут установлены Playwright, Chromium, Xvfb и noVNC. Потребуется около 1–1.5 ГБ диска.',
        confirmText: 'Установить',
      });
      if (!ok) return;
      try {
        await api('/wb-automation/components', { method: 'POST', body: JSON.stringify({ action: 'install' }) });
        showWBComponentsProgress('install');
      } catch (e) { showToast('Ошибка запуска установки: ' + e.message, 'error'); }
    };
    wbButtons.appendChild(installWBBtn);
  } else if (!wbAutomation.installed) {
    wbButtons.appendChild(el('div', 'text-xs text-amber-400', 'Нужна Ubuntu/Debian x86_64.'));
  } else {
    if (wbAutomation.supported) {
      const refreshWBBtn = el('button', 'btn btn-primary');
      refreshWBBtn.textContent = wbAutomation.token_expired ? 'Получить новый токен' : 'Обновить общий токен';
      refreshWBBtn.onclick = () => showWBAutomationSession('refresh');
      wbButtons.appendChild(refreshWBBtn);
    }
    const removeWBBtn = el('button', 'btn btn-danger');
    removeWBBtn.textContent = 'Удалить компоненты';
    removeWBBtn.onclick = async () => {
      const ok = await showConfirm({
        title: 'Удалить автоматизацию WB?',
        message: 'Chrome-профиль, cookies WB, прокси и служебные метаданные будут удалены. Рабочие конфигурации инстансов останутся.',
        danger: true,
        confirmText: 'Удалить',
      });
      if (!ok) return;
      try {
        await api('/wb-automation/components', { method: 'POST', body: JSON.stringify({ action: 'remove' }) });
        showWBComponentsProgress('remove');
      } catch (e) { showToast('Ошибка запуска удаления: ' + e.message, 'error'); }
    };
    wbButtons.appendChild(removeWBBtn);
  }
  wbCard.appendChild(wbButtons);

  // Proxy Block
  const proxyHeader = el('div', 'text-xs font-semibold uppercase tracking-wider mt-3', 'Прокси для сессий WB');
  proxyHeader.style.color = 'var(--color-ink-subtle)';
  wbCard.appendChild(proxyHeader);
  const proxyGrid = el('div', 'grid grid-cols-1 md:grid-cols-3 gap-2');
  const proxyServer = el('input', '');
  proxyServer.placeholder = 'socks5://host:port';
  proxyServer.value = wbAutomation.proxy_server || '';
  proxyServer.setAttribute('aria-label', 'WB browser proxy');
  const proxyUser = el('input', '');
  proxyUser.placeholder = 'Логин прокси';
  proxyUser.value = wbAutomation.proxy_username || '';
  const proxyPass = el('input', '');
  proxyPass.type = 'password';
  proxyPass.placeholder = wbAutomation.proxy_has_password ? '•••• (сохранён)' : 'Пароль прокси';
  proxyGrid.appendChild(proxyServer);
  proxyGrid.appendChild(proxyUser);
  proxyGrid.appendChild(proxyPass);
  wbCard.appendChild(proxyGrid);

  const proxyBtns = el('div', 'flex gap-2 flex-wrap mt-1');
  const saveProxyBtn = el('button', 'btn btn-secondary');
  saveProxyBtn.textContent = 'Сохранить прокси WB';
  saveProxyBtn.onclick = async () => {
    await withLoading(saveProxyBtn, async () => {
      try {
        await api('/wb-automation/config', {
          method: 'POST',
          body: JSON.stringify({ server: proxyServer.value.trim(), username: proxyUser.value.trim(), password: proxyPass.value }),
        });
        showToast('Настройки прокси WB сохранены');
        render();
      } catch (e) { showToast('Ошибка: ' + e.message, 'error'); }
    });
  };
  proxyBtns.appendChild(saveProxyBtn);
  if (wbAutomation.proxy_server) {
    const clearProxyBtn = el('button', 'btn btn-ghost');
    clearProxyBtn.textContent = 'Сбросить прокси';
    clearProxyBtn.onclick = async () => {
      await withLoading(clearProxyBtn, async () => {
        try {
          await api('/wb-automation/config', {
            method: 'POST',
            body: JSON.stringify({ server: '', username: '', clear_password: true }),
          });
          showToast('Прокси WB сброшен');
          render();
        } catch (e) { showToast('Ошибка: ' + e.message, 'error'); }
      });
    };
    proxyBtns.appendChild(clearProxyBtn);
  }
  wbCard.appendChild(proxyBtns);
  paneIntegrations.appendChild(wbCard);

  // Yandex Disk Mirror Card
  const mirrorCard = el('div', 'card p-5 flex flex-col gap-3');
  mirrorCard.innerHTML = `
    <div class="flex items-center gap-2">
      ${icon('cloud', 18)}
      <h3 class="font-bold text-base" style="color:var(--color-ink);">Яндекс.Диск Mirror (зашифрованный резерв)</h3>
    </div>
    <div class="text-xs" style="color:var(--color-ink-subtle);">
      Сервер шифрует подписку по AES-256-GCM и загружает на Яндекс.Диск. Клиент с выключенным туннелем скачивает зеркало и безопасно расшифровывает.
    </div>
  `;
  const enabledLabel = el('label', 'inline-flex items-center gap-2 text-sm font-medium mt-1 cursor-pointer');
  const enabledInp = el('input', '');
  enabledInp.type = 'checkbox';
  enabledInp.checked = !!sys.mirror_enabled;
  enabledLabel.appendChild(enabledInp);
  enabledLabel.appendChild(el('span', '', 'Включить автоматическую синхронизацию mirror'));
  mirrorCard.appendChild(enabledLabel);

  const tokenInp = el('input', 'mt-1');
  tokenInp.type = 'password';
  tokenInp.setAttribute('aria-label', 'Yandex OAuth токен');
  tokenInp.placeholder = sys.mirror_token_present ? (sys.mirror_token_masked || '••••') : 'OAuth токен приложения Яндекс.Диск';
  if (sys.mirror_token_present) tokenInp.value = sys.mirror_token_masked || '••••';
  mirrorCard.appendChild(tokenInp);

  const baseInp = el('input', '');
  baseInp.placeholder = '/olcrtc/subscriptions';
  baseInp.value = sys.mirror_base_path || '';
  baseInp.setAttribute('aria-label', 'Base path на Yandex Disk');
  mirrorCard.appendChild(baseInp);

  const mirrorBtns = el('div', 'flex gap-2 flex-wrap items-center mt-2');
  const testBtn = el('button', 'btn btn-secondary');
  testBtn.textContent = 'Тест загрузки';
  testBtn.onclick = async () => {
    await withLoading(testBtn, async () => {
      try {
        const res = await api('/system/mirror-config/test', {
          method: 'POST',
          body: JSON.stringify({ provider: 'yandex_disk', base_path: baseInp.value, oauth_token: tokenInp.value }),
        });
        showToast(res.ok ? (res.message + ' (' + res.latency_ms + 'ms)') : ('Ошибка: ' + (res.message || res.error)), res.ok ? 'success' : 'error');
      } catch (e) {
        try { const err = JSON.parse(e.message); showToast(err.message || e.message, 'error'); }
        catch { showToast(e.message, 'error'); }
      }
    });
  };
  const saveMirrorBtn = el('button', 'btn btn-primary');
  saveMirrorBtn.textContent = 'Сохранить mirror';
  saveMirrorBtn.onclick = async () => {
    await withLoading(saveMirrorBtn, async () => {
      try {
        const res = await api('/system/mirror-config', {
          method: 'POST',
          body: JSON.stringify({
            enabled: enabledInp.checked,
            provider: 'yandex_disk',
            base_path: baseInp.value,
            oauth_token: tokenInp.value,
          }),
        });
        showToast(res.message || 'Настройки зеркала сохранены', 'success');
        if (res.restarting) {
          showToast('olcrtc-server перезапускается (~10 сек)', 'success');
        }
        render();
      } catch (e) {
        try { const err = JSON.parse(e.message); showToast(err.message || e.message, 'error'); }
        catch { showToast(e.message, 'error'); }
      }
    });
  };
  mirrorBtns.appendChild(testBtn);
  mirrorBtns.appendChild(saveMirrorBtn);
  mirrorCard.appendChild(mirrorBtns);
  paneIntegrations.appendChild(mirrorCard);
  wrap.appendChild(paneIntegrations);

  main.appendChild(wrap);
  app.appendChild(frame.shell);
}

function showTokenModal(tok) {
  const div = el('div', '');
  div.innerHTML = '<h3 class="text-lg font-semibold mb-3">Новый токен</h3><p class="text-sm text-gray-400 mb-3">Сохраните токен — он не будет показан снова.</p>';
  const inp = el('input', 'mb-3');
  inp.value = tok;
  inp.readOnly = true;
  div.appendChild(inp);
  const row = el('div', 'flex gap-2 justify-end');
  const copyBtn = el('button', 'btn btn-secondary');
  copyBtn.textContent = 'Копировать';
  copyBtn.onclick = () => { navigator.clipboard.writeText(tok); showToast('Токен скопирован'); };
  const closeBtn = el('button', 'btn btn-primary');
  closeBtn.textContent = 'Закрыть';
  row.appendChild(copyBtn);
  row.appendChild(closeBtn);
  div.appendChild(row);
  const overlay = showModal(div, { small: true });
  closeBtn.onclick = () => closeModal(overlay);
}

function showWBComponentsProgress(action) {
  const div = el('div', '');
  div.innerHTML = '<h3 class="text-lg font-semibold mb-3">' + (action === 'remove' ? 'Удаление' : 'Установка') + ' автоматизации WB</h3>';
  const message = el('div', 'text-sm text-gray-300 mb-3', 'Запуск операции...');
  const progress = el('div', 'w-full bg-gray-800 rounded overflow-hidden mb-3');
  const bar = el('div', 'h-2 bg-violet-500');
  bar.style.width = '1%';
  progress.appendChild(bar);
  const closeBtn = el('button', 'btn btn-secondary hidden');
  closeBtn.textContent = 'Закрыть';
  div.appendChild(message);
  div.appendChild(progress);
  div.appendChild(closeBtn);
  const overlay = showModal(div, { small: true });
  overlay.dataset.onOutsideClose = 'cancel';
  closeBtn.onclick = () => { closeModal(overlay); render(); };

  const timer = setInterval(async () => {
    try {
      const state = await api('/wb-automation/components/progress');
      message.textContent = state.message || state.phase || 'Выполняется...';
      bar.style.width = Math.max(1, Math.min(100, state.percent || 0)) + '%';
      if (state.phase === 'completed' || state.phase === 'error') {
        clearInterval(timer);
        closeBtn.classList.remove('hidden');
        if (state.phase === 'completed') showToast(state.message || 'Операция завершена');
        else showToast(state.message || 'Ошибка установки', 'error');
      }
    } catch (e) {
      // The admin remains available; transient package-manager stalls are retried.
    }
  }, 1500);
}

async function showWBAutomationSession(action, onCreateResult) {
  let started;
  try {
    started = await api('/wb-automation/session', { method: 'POST', body: JSON.stringify({ action }) });
  } catch (e) {
    showToast('Не удалось запустить WB-браузер: ' + e.message, 'error');
    return;
  }

  const div = el('div', '');
  div.innerHTML = '<h3 class="text-lg font-semibold mb-2">WB Stream · удалённый Chrome</h3>';
  div.appendChild(el('div', 'text-xs text-gray-400 mb-2', 'Войдите вручную и пройдите CAPTCHA. После входа автоматизация продолжит работу сама.'));
  const status = el('div', 'text-sm text-gray-300 mb-2', started.message || 'Запуск Chrome...');
  const frame = el('iframe', 'w-full rounded border border-gray-700 bg-black');
  frame.style.height = 'min(70vh, 800px)';
  frame.setAttribute('allow', 'clipboard-read; clipboard-write');
  frame.src = started.viewer_url;
  const row = el('div', 'flex gap-2 justify-end mt-3');
  const extendBtn = el('button', 'btn btn-secondary');
  extendBtn.textContent = 'Продлить на 15 минут';
  const cancelBtn = el('button', 'btn btn-danger');
  cancelBtn.textContent = 'Отмена';
  row.appendChild(extendBtn);
  row.appendChild(cancelBtn);
  div.appendChild(status);
  div.appendChild(frame);
  div.appendChild(row);
  const overlay = showModal(div);
  overlay.dataset.onOutsideClose = 'cancel';
  const modal = overlay.querySelector('.modal');
  if (modal) { modal.style.width = '96vw'; modal.style.maxWidth = '1280px'; }

  extendBtn.onclick = async () => {
    try {
      await api('/wb-automation/session/extend', { method: 'POST', body: '{}' });
      extendBtn.disabled = true;
      extendBtn.textContent = 'Продлено';
    } catch (e) { showToast(e.message, 'error'); }
  };
  cancelBtn.onclick = async () => {
    try { await api('/wb-automation/session/cancel', { method: 'POST', body: '{}' }); }
    catch (e) { showToast(e.message, 'error'); return; }
    clearInterval(timer);
    closeModal(overlay);
  };

  const timer = setInterval(async () => {
    try {
      const state = await api('/wb-automation/session');
      status.textContent = state.message || state.phase;
      if (state.phase === 'applying') {
        frame.classList.add('hidden');
        extendBtn.classList.add('hidden');
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Применение...';
      }
      if (state.phase === 'success') {
        clearInterval(timer);
        if (action === 'create' && onCreateResult) onCreateResult(state);
        if (action === 'refresh') {
          const count = state.apply && state.apply.updated_instances ? state.apply.updated_instances.length : 0;
          showToast('Общий WB-токен обновлён для ' + count + ' инстансов');
        }
        try { await api('/wb-automation/session', { method: 'DELETE' }); } catch (e) {}
        closeModal(overlay);
        if (action === 'refresh') render();
      } else if (state.phase === 'error' || state.phase === 'cancelled') {
        clearInterval(timer);
        frame.classList.add('hidden');
        extendBtn.classList.add('hidden');
        cancelBtn.disabled = false;
        cancelBtn.textContent = 'Закрыть';
        cancelBtn.className = 'btn btn-secondary';
        showToast(state.message || 'Ошибка WB-автоматизации', 'error');
      }
    } catch (e) {
      status.textContent = 'Ожидание ответа worker...';
    }
  }, 1000);
}

// ── Modals ───────────────────────────────────────────────────────────────────
function showModal(content, opts) {
  opts = opts || {};
  const overlay = el('div', 'modal-overlay');
  const modal = el('div', 'modal' + (opts.small ? ' modal-sm' : ''));
  modal.appendChild(content);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      const evt = new Event('outside-click');
      overlay.dispatchEvent(evt);
      if (!overlay.dataset.onOutsideClose || overlay.dataset.onOutsideClose !== 'cancel') {
        overlay.remove();
      }
    }
  };
  return overlay;
}

function closeModal(overlay) { if (overlay && overlay.parentNode) overlay.remove(); }

function showQRModal(uri, inst) {
  const isBundle = inst && inst.subscriptionBundle;
  const div = el('div', '');
  div.innerHTML = '<h3 class="text-lg font-semibold mb-3 inline-flex items-center gap-2">' + icon('qr-code', 18) + '<span>' + (isBundle ? 'QR подписки' : 'QR-код') + '</span></h3>';
  if (inst && inst.carrier === 'wbstream' && (!inst.room_id || inst.room_id === 'any')) {
    const notice = el('div', 'p-2 mb-3 text-xs rounded border border-amber-500/50 bg-amber-500/10 text-amber-200');
    notice.innerHTML =
      '<strong>Внимание:</strong> Room ID для wbstream не задан. ' +
      'WB Stream больше не создаёт румы автоматически — задайте Room ID в «Настройках» инстанса перед тем, как делиться QR.';
    div.appendChild(notice);
  }
  if (inst && inst.transport === 'datachannel' && (inst.carrier === 'telemost' || inst.carrier === 'wbstream')) {
    const dcWarn = el('div', 'p-2 mb-3 text-xs rounded border border-red-500/50 bg-red-500/10 text-red-200');
    dcWarn.innerHTML =
      '<strong>Несовместимый транспорт:</strong> DataChannel не работает с ' + inst.carrier + '. ' +
      'Goolom SFU не маршрутизирует стандартный DC (dataChannelSharing=TO_RTP). ' +
      (inst.carrier === 'wbstream' ? 'WB Stream DC требует canPublishData=true (модератор).' : '') +
      ' Смените транспорт на <b>vp8channel</b> в настройках инстанса.';
    div.appendChild(dcWarn);
  }

  const qrWrap = el('div', 'qr-wrap flex justify-center mb-3 mx-auto overflow-auto');
  const qrDiv = el('div', '');
  qrWrap.appendChild(qrDiv);
  div.appendChild(qrWrap);
  const uriText = el('div', 'text-xs text-gray-400 break-all mb-3 copyable', uri);
  div.appendChild(uriText);
  const btnRow = el('div', 'flex gap-2 justify-end flex-wrap');
  const copyBtn = el('button', 'btn btn-secondary btn-sm');
  copyBtn.innerHTML = icon('copy') + '<span>' + (isBundle ? 'Копировать JSON' : 'Копировать URI') + '</span>';
  copyBtn.onclick = () => { navigator.clipboard.writeText(uri); showToast('Скопировано'); };
  const downloadBtn = el('button', 'btn btn-secondary btn-sm');
  downloadBtn.innerHTML = icon('download') + '<span>Скачать PNG</span>';
  const closeBtn = el('button', 'btn btn-primary btn-sm');
  closeBtn.textContent = 'Закрыть';
  btnRow.appendChild(downloadBtn);
  btnRow.appendChild(copyBtn);
  btnRow.appendChild(closeBtn);
  div.appendChild(btnRow);

  const overlay = showModal(div);
  closeBtn.onclick = () => closeModal(overlay);

  setTimeout(async () => {
    const optimized = await optimizeQRPayload(uri);
    const qrText = optimized.text;
    if (optimized.compressed) {
      const note = el('div', 'text-xs text-emerald-300 mb-2');
      note.textContent = 'QR оптимизирован: ' + optimized.originalLength + ' → ' + qrText.length + ' символов. Требуется клиент с поддержкой olcrtc+gz.';
      div.insertBefore(note, qrWrap.nextSibling);
    }
    let frames;
    try {
      frames = isBundle ? await splitSubscriptionQRPayload(qrText) : [qrText];
    } catch (e) {
      qrDiv.innerHTML = '<div class="text-red-400 text-xs p-2">Ошибка генерации QR: ' + e.message + '</div>';
      return;
    }
    if (!frames[0] || frames.some(frame => frame.length > 1200)) {
      qrDiv.innerHTML = '<div class="text-red-400 text-xs p-2">Данные слишком длинные для QR-кода</div>';
      return;
    }

    let frameIndex = 0;
    let frameLabel = null;
    const renderFrame = () => {
      qrDiv.innerHTML = '';
      const frame = frames[frameIndex];
      const qrSize = frame.length > 650 ? 560 : 360;
      try {
        new QRCode(qrDiv, { text: frame, width: qrSize, height: qrSize, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.L });
      } catch (e) {
        qrDiv.innerHTML = '<div class="text-red-400 text-xs p-2">Ошибка генерации QR: ' + e.message + '</div>';
      }
      if (frameLabel) frameLabel.textContent = `Часть ${frameIndex + 1} из ${frames.length}`;
    };

    if (frames.length > 1) {
      const nav = el('div', 'flex items-center justify-center gap-2 mb-2');
      const prev = el('button', 'btn btn-secondary btn-sm');
      prev.textContent = 'Назад';
      frameLabel = el('span', 'text-sm text-gray-300');
      const next = el('button', 'btn btn-secondary btn-sm');
      next.textContent = 'Далее';
      prev.onclick = () => { frameIndex = (frameIndex + frames.length - 1) % frames.length; renderFrame(); };
      next.onclick = () => { frameIndex = (frameIndex + 1) % frames.length; renderFrame(); };
      nav.appendChild(prev);
      nav.appendChild(frameLabel);
      nav.appendChild(next);
      div.insertBefore(nav, qrWrap.nextSibling);
    }

    renderFrame();
    downloadBtn.onclick = () => {
      const canvas = qrDiv.querySelector('canvas');
      const img = qrDiv.querySelector('img');
      const suffix = frames.length > 1 ? `-${frameIndex + 1}-of-${frames.length}` : '';
      if (canvas) {
        canvas.toBlob((blob) => {
          if (!blob) { showToast('Не удалось сгенерировать PNG', 'error'); return; }
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = isBundle ? `olcrtc-subscription-qr${suffix}.png` : 'olcrtc-qr.png'; a.click();
          URL.revokeObjectURL(url);
          showToast('PNG сохранён');
        }, 'image/png');
      } else if (img) {
        const a = document.createElement('a');
        a.href = img.src; a.download = isBundle ? `olcrtc-subscription-qr${suffix}.png` : 'olcrtc-qr.png'; a.click();
        showToast('PNG сохранён');
      } else {
        showToast('Не удалось получить QR', 'error');
      }
    };
  }, 50);
}

// The form itself, without a shell: the modal and /instances/new mount the same
// node, so fields, handlers and the request body cannot drift apart. The caller
// supplies the frame, the buttons and what to do after success.
function buildCreateInstanceForm() {
  const div = el('div', '');

  const connectionSec = el('div', 'section mb-3');
  const connTitle = el('div', 'section-title flex items-center gap-1.5');
  connTitle.innerHTML = icon('wifi', 12) + '<span>Connection</span>';
  connectionSec.appendChild(connTitle);
  const connGrid = el('div', 'grid grid-cols-1 md:grid-cols-2 gap-3');

  const carrierField = makeSelectField('Провайдер', icon('tag', 14), 'jitsi', ['jitsi', 'telemost', 'wbstream', 'openflux']);
  // Issue #52: seichannel/videochannel are dead on this project; datachannel
  // works only with jitsi. Compatible options per carrier:
  // telemost/wbstream -> vp8channel, jitsi -> datachannel.
  const transportField = makeSelectField('Транспорт', icon('wifi', 14), 'datachannel', compatibleTransports('jitsi'));
  const nameField = makeInputField('Имя', icon('tag', 14), 'jitsi_olcrtc', { placeholder: 'имя инстанса' });
  const roomIDField = makeInputField('Room ID', icon('tag', 14), '', { placeholder: 'jitsi: https://meet.small-dm.ru/yourroom · wbstream: создать на stream.wb.ru' });
  const authTokenField = makeInputField('Auth token', icon('shield', 14), '', { placeholder: 'wbstream account/moderator token, optional' });
  authTokenField.input.type = 'password';

  connGrid.appendChild(carrierField.field);
  connGrid.appendChild(transportField.field);
  connGrid.appendChild(nameField.field);
  connGrid.appendChild(roomIDField.field);
  connGrid.appendChild(authTokenField.field);
  connectionSec.appendChild(connGrid);

  const openfluxKeySec = el('div', 'p-3 mt-3 rounded-lg border border-gray-700 bg-gray-800/30 hidden');
  openfluxKeySec.innerHTML = '<div class="text-xs text-gray-400 mb-2 flex items-center gap-1.5">' + icon('lock', 12) + '<span>Шифрование OpenFlux (AES-256-GCM)</span></div>';
  const openfluxKeyRow = el('div', 'flex gap-2 items-center');
  const openfluxKeyInput = el('input', 'input flex-1 font-mono text-xs');
  openfluxKeyInput.type = 'password';
  openfluxKeyInput.placeholder = 'Секретный ключ (опционально, от 16 символов)';
  const toggleKeyVisBtn = el('button', 'btn btn-secondary btn-sm p-2 shrink-0');
  toggleKeyVisBtn.type = 'button';
  toggleKeyVisBtn.title = 'Показать / скрыть ключ';
  toggleKeyVisBtn.innerHTML = icon('eye', 14);
  toggleKeyVisBtn.onclick = () => {
    if (openfluxKeyInput.type === 'password') {
      openfluxKeyInput.type = 'text';
      toggleKeyVisBtn.innerHTML = icon('eye-off', 14);
    } else {
      openfluxKeyInput.type = 'password';
      toggleKeyVisBtn.innerHTML = icon('eye', 14);
    }
  };
  const genKeyBtn = el('button', 'btn btn-secondary btn-sm flex items-center gap-1 shrink-0');
  genKeyBtn.type = 'button';
  genKeyBtn.title = 'Сгенерировать случайный 256-битный ключ';
  genKeyBtn.innerHTML = icon('refresh-cw', 12) + '<span>Сгенерировать</span>';
  genKeyBtn.onclick = () => {
    openfluxKeyInput.value = randHex(32);
    openfluxKeyInput.type = 'text';
    toggleKeyVisBtn.innerHTML = icon('eye-off', 14);
  };
  const clearKeyBtn = el('button', 'btn btn-secondary btn-sm p-2 shrink-0');
  clearKeyBtn.type = 'button';
  clearKeyBtn.title = 'Очистить ключ';
  clearKeyBtn.innerHTML = icon('trash-2', 14);
  clearKeyBtn.onclick = () => {
    openfluxKeyInput.value = '';
  };
  openfluxKeyRow.appendChild(openfluxKeyInput);
  openfluxKeyRow.appendChild(toggleKeyVisBtn);
  openfluxKeyRow.appendChild(genKeyBtn);
  openfluxKeyRow.appendChild(clearKeyBtn);
  openfluxKeySec.appendChild(openfluxKeyRow);
  const openfluxKeyHint = el('div', 'mt-1.5 text-xs text-gray-500 mb-3');
  openfluxKeyHint.textContent = 'Если ключ указан, exit-node и клиенты шифруют весь трафик по AES-256-GCM. Ключ автоматически добавится в QR-код и ссылку (&k=...).';
  openfluxKeySec.appendChild(openfluxKeyHint);
  const openfluxCodecField = makeSelectField('Кодек / формат кадров', icon('sliders-horizontal', 14), 'batched', [
    { value: 'batched', label: 'Batched (ZSTD + пачки, рекомендуется)' },
    { value: 'legacy', label: 'Legacy (LZ4 per-packet)' },
  ]);
  openfluxKeySec.appendChild(openfluxCodecField.field);
  // ponytail: B24 auth only, visible for bitrix24 transport.
  const b24Block = el('div', 'mt-3 hidden');
  b24Block.innerHTML = '<div class="text-xs text-gray-400 mb-2">Битрикс24 (портал, куки + sessid + chat)</div>';
  const b24Grid = el('div', 'grid grid-cols-1 gap-2');
  const b24CookiesField = makeInputField('B24 куки', icon('lock', 14), '', { placeholder: 'PHPSESSID=...; BITRIX_SM_...=...' });
  const b24SessidField = makeInputField('B24 sessid', icon('key', 14), '', { placeholder: 'sessid из портала' });
  const b24ChatField = makeInputField('B24 chat ID', icon('hash', 14), '', { placeholder: 'пусто = создать новый, chat123 = переиспользовать' });
  b24Grid.appendChild(b24CookiesField.field);
  b24Grid.appendChild(b24SessidField.field);
  b24Grid.appendChild(b24ChatField.field);
  b24Block.appendChild(b24Grid);
  openfluxKeySec.appendChild(b24Block);
  connectionSec.appendChild(openfluxKeySec);

  const dcWarn = el('div', 'p-2 mb-3 text-xs rounded border border-red-500/50 bg-red-500/10 text-red-200 hidden');
  dcWarn.innerHTML = '<strong>Внимание:</strong> DataChannel может не работать с данным carrier. Рекомендуется <b>vp8channel</b>.';
  connectionSec.appendChild(dcWarn);

  const wbHint = el('div', 'mb-3 text-xs text-amber-300 bg-amber-900/30 border border-amber-700/40 p-3 rounded-lg hidden');
  wbHint.innerHTML = '<b>WB Stream.</b> Комнату и account token можно получить через удалённый Chrome на VPS либо ввести вручную.';
  connectionSec.appendChild(wbHint);
  const wbAcquireBtn = el('button', 'btn btn-primary mb-3 hidden');
  wbAcquireBtn.textContent = 'Получить токен и создать комнату';
  wbAcquireBtn.onclick = async () => {
    let components;
    try { components = await api('/wb-automation/components'); } catch (e) {}
    if (!components || !components.installed) {
      showToast('Сначала установите компоненты автоматизации в Настройках', 'error');
      return;
    }
    showWBAutomationSession('create', state => {
      roomIDField.input.value = state.room_id || '';
      authTokenField.input.value = state.token || '';
      showToast('Room ID и WB-токен заполнены');
    });
  };
  connectionSec.appendChild(wbAcquireBtn);

  const jitsiPresets = createJitsiPresetPanel(roomIDField.input, null, transportField.input);
  connectionSec.appendChild(jitsiPresets);

  const jitsiBlock = el('div', 'border border-gray-700 rounded-lg p-3 mb-3 hidden');
  jitsiBlock.innerHTML = '<div class="text-xs text-gray-400 mb-2">Jitsi DataChannel / SCTP</div>';
  const jitsiGrid = el('div', 'grid grid-cols-1 md:grid-cols-2 gap-2');
  const bridgeModeField = makeSelectField('Bridge mode', icon('sliders-horizontal', 14), 'auto', ['auto', 'sctp', 'colibri-ws']);
  const jitsiSCTPMaxMessageField = makeInputField('SCTP max message', icon('sliders-horizontal', 14), '', { placeholder: 'empty = legacy 12288' });
  const trafficPayloadField = makeInputField('Transport payload cap', icon('sliders-horizontal', 14), '', { placeholder: 'empty, 1188, 4096, 8192' });
  const trafficMinDelayField = makeInputField('Min delay', icon('clock', 14), '', { placeholder: 'empty или 1ms' });
  const trafficMaxDelayField = makeInputField('Max delay', icon('clock', 14), '', { placeholder: 'empty или 3ms' });
  jitsiGrid.appendChild(bridgeModeField.field);
  jitsiGrid.appendChild(jitsiSCTPMaxMessageField.field);
  jitsiGrid.appendChild(trafficPayloadField.field);
  jitsiGrid.appendChild(trafficMinDelayField.field);
  jitsiGrid.appendChild(trafficMaxDelayField.field);
  jitsiBlock.appendChild(jitsiGrid);
  const jitsiHint = el('div', 'mt-2 text-xs text-gray-500 leading-relaxed');
  jitsiHint.innerHTML = 'Для публичных Jitsi обычно надёжнее <b>SCTP</b>. ' +
    '<b>auto</b> выбирает Colibri WS только если он advertised, иначе SCTP. ' +
    '<b>colibri-ws</b> нужен для диагностики и завершит запуск, если WS не advertised. ' +
    'Пусто сохраняет legacy SCTP frame для совместимости. Для диагностики скорости можно явно поставить SCTP max message <b>1200</b> и payload cap <b>1188</b>, но только когда обе стороны обновлены.';
  jitsiBlock.appendChild(jitsiHint);
  connectionSec.appendChild(jitsiBlock);

  div.appendChild(connectionSec);

  // VP8 params
  const vp8Block = el('div', 'border border-gray-700 rounded-lg p-3 mb-3');
  vp8Block.innerHTML = '<div class="text-xs text-gray-400 mb-2">VP8 параметры</div>';
  const vp8Grid = el('div', 'grid grid-cols-2 gap-2');
  const vp8FpsInp = el('input', ''); vp8FpsInp.type = 'number'; vp8FpsInp.min = '0'; vp8FpsInp.step = '1'; vp8FpsInp.placeholder = 'FPS (empty=120, 0=core default)'; vp8FpsInp.value = '120';
  const vp8BatchInp = el('input', ''); vp8BatchInp.type = 'number'; vp8BatchInp.min = '0'; vp8BatchInp.step = '1'; vp8BatchInp.placeholder = 'Batch (empty=64, 0=core default)'; vp8BatchInp.value = '64';
  vp8Grid.appendChild(vp8FpsInp);
  vp8Grid.appendChild(vp8BatchInp);
  vp8Block.appendChild(vp8Grid);
  div.appendChild(vp8Block);

  // Network section: DNS / SOCKS / WARP
  const netSec = el('div', 'section mb-3');
  const netTitle = el('div', 'section-title flex items-center gap-1.5');
  netTitle.innerHTML = icon('shield', 12) + '<span>Сеть</span>';
  netSec.appendChild(netTitle);
  const netGrid = el('div', 'grid grid-cols-1 md:grid-cols-3 gap-3');
  const dnsField = makeInputField('DNS', icon('wifi', 14), '', { placeholder: '8.8.8.8:53' });
  const socksField = makeInputField('SOCKS proxy', icon('shield', 14), '', { placeholder: 'socks5://user:pass@host:port' });
  const warpField = makeInputField('WARP proxy', icon('shield', 14), '', { placeholder: '127.0.0.1:40000' });
  netGrid.appendChild(dnsField.field);
  netGrid.appendChild(socksField.field);
  netGrid.appendChild(warpField.field);
  netSec.appendChild(netGrid);
  div.appendChild(netSec);

  // Debug verbose logging (OLCRTC_DEBUG=1 -> openflux --debug)
  const debugLabel = el('label', 'inline-flex items-center gap-2 text-sm font-medium mb-3 cursor-pointer');
  const debugCreateInp = el('input', '');
  debugCreateInp.type = 'checkbox';
  debugCreateInp.checked = false;
  debugCreateInp.style.width = 'auto';
  debugCreateInp.style.minHeight = 'auto';
  debugLabel.appendChild(debugCreateInp);
  debugLabel.appendChild(el('span', '', 'Debug (verbose openflux log)'));
  div.appendChild(debugLabel);

  function getTransportOptionsForCreate(carrier) {
    // Issue #52: only supported combinations are selectable.
    return compatibleTransports(carrier);
  }

  function isTransportCompatibleForCreate(carrier, transport) {
    return compatibleTransports(carrier).includes(transport);
  }

  function updateVisibility() {
    const t = transportField.input.value;
    const c = carrierField.input.value;

    // Keep the transport select in sync with the carrier matrix.
    const allowed = compatibleTransports(c);
    const currentTransport = transportField.input.value;

    // Rebuild transport select with the carrier's options only.
    transportField.input.innerHTML = '';
    allowed.forEach(tr => {
      const opt = el('option', '', tr);
      opt.value = tr;
      transportField.input.appendChild(opt);
    });

    // Restore selection when still compatible, else default to the first option.
    if (allowed.includes(currentTransport)) {
      transportField.input.value = currentTransport;
    } else {
      transportField.input.value = allowed[0] || '';
      showToast('Транспорт переключён на ' + (allowed[0] || '-') + ' — единственный совместимый с ' + c, 'error');
    }

    const finalTransport = transportField.input.value;
    const isCompatible = isTransportCompatibleForCreate(c, finalTransport);

    vp8Block.classList.toggle('hidden', finalTransport !== 'vp8channel');
    jitsiBlock.classList.toggle('hidden', !(c === 'jitsi' && finalTransport === 'datachannel'));
    dcWarn.classList.toggle('hidden', isCompatible || finalTransport !== 'datachannel');
    authTokenField.field.classList.toggle('hidden', c !== 'wbstream');
    wbHint.classList.toggle('hidden', c !== 'wbstream');
    wbAcquireBtn.classList.toggle('hidden', c !== 'wbstream');
    jitsiPresets.classList.toggle('hidden', c !== 'jitsi');
    openfluxKeySec.classList.toggle('hidden', c !== 'openflux');
    b24Block.classList.toggle('hidden', !(c === 'openflux' && finalTransport === 'bitrix24'));

    if (c === 'openflux') {
      const lbl = roomIDField.field.querySelector('label');
      if (lbl && lbl.lastChild) lbl.lastChild.textContent = ' Ссылка на документ (Yandex / Mail.ru Docs)';
      roomIDField.input.placeholder = 'https://disk.yandex.ru/i/... или https://docs.mail.ru/...';
    } else {
      const lbl = roomIDField.field.querySelector('label');
      if (lbl && lbl.lastChild) lbl.lastChild.textContent = ' Room ID';
      roomIDField.input.placeholder = 'jitsi: https://meet.small-dm.ru/yourroom · wbstream: создать на stream.wb.ru';
    }

    // Auto-rename
    if (c === 'openflux') {
      const room = roomIDField.input.value.trim();
      if (finalTransport === 'mailru' || room.includes('mail.ru')) {
        nameField.input.value = 'OpenFlux Mail.ru';
      } else if (finalTransport === 'avito' || room.includes('avito.ru')) {
        nameField.input.value = 'OpenFlux Avito';
      } else if (finalTransport === 'cups' || finalTransport === 'cupsonline' || room.includes('cups.online')) {
        nameField.input.value = 'OpenFlux Cups';
      } else if (finalTransport === 'telemost' || room.includes('telemost.yandex.ru')) {
        nameField.input.value = 'OpenFlux Telemost';
      } else if (finalTransport === 'bitrix24' || finalTransport === 'bitrix' || room.includes('bitrix24')) {
        nameField.input.value = 'OpenFlux Bitrix24';
      } else if (finalTransport === 'boards' || finalTransport === 'board' || room.includes('boards.yandex.ru')) {
        nameField.input.value = 'OpenFlux Boards';
      } else if (finalTransport === 'vyandex' || room.includes('/edit/d/')) {
        nameField.input.value = 'OpenFlux Volga';
      } else {
        nameField.input.value = 'OpenFlux Yandex';
      }
    } else {
      const carriers = { jitsi: 'jitsi', telemost: 'telemost', wbstream: 'wbstream' };
      const cp = carriers[c] || c;
      nameField.input.value = cp + '_olcrtc' + (finalTransport && finalTransport !== 'vp8channel' ? '_' + finalTransport : '');
    }
  }
  carrierField.input.addEventListener('change', updateVisibility);
  transportField.input.addEventListener('change', updateVisibility);
  roomIDField.input.addEventListener('input', () => {
    if (carrierField.input.value === 'openflux') updateVisibility();
  });

  // No footer and no overlay here: the modal puts its own buttons under this
  // node, the page puts the mockup's footer, and both call submit().
  async function submit(triggerBtn) {
    const carrier = carrierField.input.value;
    const room = roomIDField.input.value.trim();
    const t = transportField.input.value;
    if (carrier === 'wbstream' && !room) {
      showToast('Для wbstream нужно указать Room ID', 'error');
      return false;
    }
    const autoOk = (t === 'cups' || t === 'cupsonline' || t === 'avito') && (!room || room === 'auto');
    if (carrier === 'openflux' && !autoOk && (!room || (!room.startsWith('http://') && !room.startsWith('https://')))) {
      showToast('Для OpenFlux укажите полную ссылку на документ (https://...)', 'error');
      return false;
    }
    const body = {
      carrier,
      transport: transportField.input.value,
      name: nameField.input.value,
      room_id: room,
      auth_token: authTokenField.input.value.trim(),
      vp8_fps: vp8FpsInp.value.trim(),
      vp8_batch: vp8BatchInp.value.trim(),
      dns: dnsField.input.value.trim(),
      socks_proxy: socksField.input.value.trim(),
      warp_proxy: warpField.input.value.trim(),
      debug: debugCreateInp.checked,
      jitsi_bridge_mode: bridgeModeField.input.value,
      jitsi_sctp_max_message_size: jitsiSCTPMaxMessageField.input.value.trim(),
      traffic_max_payload_size: trafficPayloadField.input.value.trim(),
      traffic_min_delay: trafficMinDelayField.input.value.trim(),
      traffic_max_delay: trafficMaxDelayField.input.value.trim(),
    };
    if (carrier === 'openflux') {
      if (openfluxKeyInput.value.trim()) {
        body.openflux_key = openfluxKeyInput.value.trim();
      }
      body.openflux_codec = openfluxCodecField.input.value;
      if (t === 'bitrix24') {
        if (b24CookiesField.input.value.trim()) body.b24_cookies = b24CookiesField.input.value.trim();
        if (b24SessidField.input.value.trim()) body.b24_sessid = b24SessidField.input.value.trim();
        if (b24ChatField.input.value.trim()) body.b24_chat_id = b24ChatField.input.value.trim();
      }
    }
    let created = false;
    await withLoading(triggerBtn, async () => {
      try {
        await api('/instances', { method: 'POST', body: JSON.stringify(body) });
        showToast('Инстанс создан');
        created = true;
      } catch (e) { showToast('Не удалось создать инстанс: ' + e.message, 'error'); }
    });
    return created;
  }

  // What the chosen combination will produce, as far as it is knowable before the
  // server assigns an id: carrier, transport and the name that will be stored.
  function describe() {
    return {
      carrier: carrierField.input.value,
      transport: transportField.input.value,
      name: nameField.input.value,
    };
  }

  // The page shows the carriers as tiles, the modal as a select. Both drive the
  // same field, so there is one source of truth for the choice.
  function setCarrier(value) {
    carrierField.input.value = value;
    carrierField.input.dispatchEvent(new Event('change'));
  }

  return { node: div, submit, describe, setCarrier, carrierOptions: ['jitsi', 'telemost', 'wbstream', 'openflux'] };
}

function showCreateInstanceModal() {
  const form = buildCreateInstanceForm();
  const div = el('div', '');
  const titleRow = el('div', 'flex items-center gap-2 mb-4');
  titleRow.innerHTML = '<span style="color: var(--color-primary)">' + icon('plus', 18) + '</span><h3 class="text-lg font-semibold">Создать инстанс</h3>';
  div.appendChild(titleRow);
  div.appendChild(form.node);

  const btnRow = el('div', 'flex gap-2 justify-end mt-2');
  const cancelBtn = el('button', 'btn btn-secondary', 'Отмена');
  const createBtn = el('button', 'btn btn-primary', 'Создать инстанс');
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(createBtn);
  div.appendChild(btnRow);

  const overlay = showModal(div);
  cancelBtn.onclick = () => closeModal(overlay);
  createBtn.onclick = async () => {
    if (await form.submit(createBtn)) {
      closeModal(overlay);
      render();
    }
  };
}

// ── Instance config modal ────────────────────────────────────────────────────
function showConfigModal(inst) {
  const div = el('div', '');
  const titleRow = el('div', 'flex items-center gap-2 mb-4');
  titleRow.innerHTML = '<span style="color: var(--color-primary)">' + icon('sliders', 18) + '</span><h3 class="text-lg font-semibold">Настройка инстанса #' + inst.id + '</h3>';
  div.appendChild(titleRow);

  // ── Connection section ──
  const connectionSec = el('div', 'section mb-3');
  const connTitle = el('div', 'section-title flex items-center gap-1.5');
  connTitle.innerHTML = icon('wifi', 12) + '<span>Connection</span>';
  connectionSec.appendChild(connTitle);
  const connGrid = el('div', 'grid grid-cols-1 md:grid-cols-2 gap-3');

  const carrierField = makeSelectField('Провайдер', icon('tag', 14), inst.carrier || 'jitsi', ['jitsi', 'telemost', 'wbstream', 'openflux']);
  const transportField = makeSelectField('Транспорт', icon('wifi', 14), inst.transport || 'vp8channel', getTransportOptions(inst.carrier || 'jitsi'));
  const nameField = makeInputField('Имя', icon('tag', 14), inst.name || '', { placeholder: 'имя инстанса' });
  const roomIDField = makeInputField('Room ID', icon('tag', 14), inst.room_id || '', { placeholder: 'jitsi: https://meet.small-dm.ru/yourroom · wbstream: создать на stream.wb.ru' });
  const authTokenField = makeInputField('Auth token', icon('shield', 14), '', { placeholder: inst.has_auth_token ? 'задан, введите новый чтобы заменить' : 'wbstream account/moderator token, optional' });
  authTokenField.input.type = 'password';
  const clientIDWrap = makeReadonlyWithRotate('Client ID', icon('shield', 14), inst.client_id || '(не задан)', async (rotateBtn) => {
    const ok = await showConfirm({
      title: 'Ротация Client ID?',
      message: 'Все клиенты, импортировавшие предыдущий URI, должны импортировать новый. Текущие соединения будут прерваны при перезапуске сервиса.',
      danger: true,
      confirmText: 'Ротировать',
    });
    if (!ok) return;
    await withLoading(rotateBtn, async () => {
      try {
        const res = await api('/instances/' + inst.id + '/rotate-client-id', { method: 'POST' });
        showToast('Client ID обновлён');
        closeModal(overlay);
        render();
        // Open modal again with new value? Caller decides; we just rerender.
      } catch (e) { showToast('Ошибка: ' + e.message, 'error'); }
    });
  });
  const keyRotateBtn = el('button', 'btn btn-danger btn-sm w-full');
  keyRotateBtn.innerHTML = icon('refresh-cw') + '<span>Пересоздать ключ</span>';
  keyRotateBtn.onclick = async () => {
    const ok = await showConfirm({
      title: 'Пересоздать ключ?',
      message: 'Старый ключ перестанет работать. Клиенты должны импортировать новый URI.',
      danger: true,
      confirmText: 'Пересоздать',
    });
    if (!ok) return;
    await withLoading(keyRotateBtn, async () => {
      try {
        await api('/instances/' + inst.id + '/rotate-key', { method: 'POST' });
        showToast('Ключ пересоздан');
        closeModal(overlay);
        render();
      } catch (e) { showToast('Ошибка: ' + e.message, 'error'); }
    });
  };
  const roomRotateBtn = el('button', 'btn btn-secondary btn-sm w-full');
  roomRotateBtn.innerHTML = icon('rotate-ccw') + '<span>Пересоздать Room ID</span>';
  roomRotateBtn.onclick = async () => {
    const ok = await showConfirm({
      title: 'Пересоздать Room ID?',
      message: 'Сервер создаст новую комнату при следующем подключении.',
      danger: true,
    });
    if (!ok) return;
    await withLoading(roomRotateBtn, async () => {
      try {
        await api('/instances/' + inst.id + '/rotate-room', { method: 'POST' });
        showToast('Room ID пересоздан');
        closeModal(overlay);
        render();
      } catch (e) { showToast('Ошибка: ' + e.message, 'error'); }
    });
  };

  connGrid.appendChild(carrierField.field);
  connGrid.appendChild(transportField.field);
  connGrid.appendChild(nameField.field);
  connGrid.appendChild(roomIDField.field);
  connGrid.appendChild(authTokenField.field);
  connGrid.appendChild(clientIDWrap.field);
  connectionSec.appendChild(connGrid);

  const rotateRow = el('div', 'grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3');
  rotateRow.appendChild(keyRotateBtn);
  rotateRow.appendChild(roomRotateBtn);
  connectionSec.appendChild(rotateRow);

  const openfluxKeySec = el('div', 'p-3 mt-3 rounded-lg border border-gray-700 bg-gray-800/30 hidden');
  openfluxKeySec.innerHTML = '<div class="text-xs text-gray-400 mb-2 flex items-center gap-1.5">' + icon('lock', 12) + '<span>Шифрование OpenFlux (AES-256-GCM)</span></div>';
  const openfluxKeyRow = el('div', 'flex gap-2 items-center');
  const openfluxKeyInput = el('input', 'input flex-1 font-mono text-xs');
  openfluxKeyInput.type = 'password';
  openfluxKeyInput.value = inst.openflux_key || '';
  openfluxKeyInput.placeholder = inst.has_openflux_key ? 'Ключ задан (введите новый или очистите)' : 'Ключ шифрования (опционально, от 16 символов)';
  let openfluxKeyCleared = false;
  const toggleKeyVisBtn = el('button', 'btn btn-secondary btn-sm p-2 shrink-0');
  toggleKeyVisBtn.type = 'button';
  toggleKeyVisBtn.title = 'Показать / скрыть ключ';
  toggleKeyVisBtn.innerHTML = icon('eye', 14);
  toggleKeyVisBtn.onclick = () => {
    if (openfluxKeyInput.type === 'password') {
      openfluxKeyInput.type = 'text';
      toggleKeyVisBtn.innerHTML = icon('eye-off', 14);
    } else {
      openfluxKeyInput.type = 'password';
      toggleKeyVisBtn.innerHTML = icon('eye', 14);
    }
  };
  const genKeyBtn = el('button', 'btn btn-secondary btn-sm flex items-center gap-1 shrink-0');
  genKeyBtn.type = 'button';
  genKeyBtn.title = 'Сгенерировать случайный 256-битный ключ';
  genKeyBtn.innerHTML = icon('refresh-cw', 12) + '<span>Сгенерировать</span>';
  genKeyBtn.onclick = () => {
    openfluxKeyInput.value = randHex(32);
    openfluxKeyInput.type = 'text';
    toggleKeyVisBtn.innerHTML = icon('eye-off', 14);
    openfluxKeyCleared = false;
  };
  const clearKeyBtn = el('button', 'btn btn-secondary btn-sm p-2 shrink-0');
  clearKeyBtn.type = 'button';
  clearKeyBtn.title = 'Очистить ключ шифрования';
  clearKeyBtn.innerHTML = icon('trash-2', 14);
  clearKeyBtn.onclick = () => {
    openfluxKeyInput.value = '';
    openfluxKeyCleared = true;
    showToast('Ключ шифрования очищен. Нажмите «Сохранить» для применения.');
  };
  openfluxKeyRow.appendChild(openfluxKeyInput);
  openfluxKeyRow.appendChild(toggleKeyVisBtn);
  openfluxKeyRow.appendChild(genKeyBtn);
  openfluxKeyRow.appendChild(clearKeyBtn);
  openfluxKeySec.appendChild(openfluxKeyRow);
  const openfluxKeyHint = el('div', 'mt-1.5 text-xs text-gray-500 mb-3');
  openfluxKeyHint.textContent = 'При наличии ключа exit-node и мобильный клиент шифруют трафик (AES-256-GCM). Ключ добавляется в QR-код и ссылку (&k=...).';
  openfluxKeySec.appendChild(openfluxKeyHint);
  const openfluxCodecField = makeSelectField('Кодек / формат кадров', icon('sliders-horizontal', 14), inst.openflux_codec || 'batched', [
    { value: 'batched', label: 'Batched (ZSTD + пачки, рекомендуется)' },
    { value: 'legacy', label: 'Legacy (LZ4 per-packet)' },
  ]);
  openfluxKeySec.appendChild(openfluxCodecField.field);
  // ponytail: B24 auth only, visible for bitrix24 transport.
  const b24Block = el('div', 'mt-3 hidden');
  b24Block.innerHTML = '<div class="text-xs text-gray-400 mb-2">Битрикс24 (портал, куки + sessid + chat)</div>';
  const b24Grid = el('div', 'grid grid-cols-1 gap-2');
  const b24CookiesField = makeInputField('B24 куки', icon('lock', 14), '', { placeholder: inst.has_b24_cookies ? 'куки заданы (введите новые чтобы заменить)' : 'PHPSESSID=...; BITRIX_SM_...=...' });
  const b24SessidField = makeInputField('B24 sessid', icon('key', 14), inst.b24_sessid || '', { placeholder: 'sessid из портала' });
  const b24ChatField = makeInputField('B24 chat ID', icon('hash', 14), inst.b24_chat_id || '', { placeholder: 'пусто = создать новый, chat123 = переиспользовать' });
  b24Grid.appendChild(b24CookiesField.field);
  b24Grid.appendChild(b24SessidField.field);
  b24Grid.appendChild(b24ChatField.field);
  b24Block.appendChild(b24Grid);
  openfluxKeySec.appendChild(b24Block);
  connectionSec.appendChild(openfluxKeySec);
  div.appendChild(connectionSec);

  // ── Network section ──
  const networkSec = el('div', 'section mb-3');
  const netTitle = el('div', 'section-title flex items-center gap-1.5');
  netTitle.innerHTML = icon('wifi', 12) + '<span>Network</span>';
  networkSec.appendChild(netTitle);
  const netGrid = el('div', 'grid grid-cols-1 md:grid-cols-2 gap-3');
  const dnsField = makeInputField('DNS', icon('wifi', 14), inst.dns || '', { placeholder: '8.8.8.8:53' });
  const socksField = makeInputField('SOCKS proxy', icon('shield', 14), inst.socks_proxy || '', { placeholder: 'socks5://user:pass@host:port' });
  const warpField = makeInputField('WARP proxy', icon('shield', 14), inst.warp_proxy || '', { placeholder: '127.0.0.1:40000' });
  netGrid.appendChild(dnsField.field);
  netGrid.appendChild(socksField.field);
  netGrid.appendChild(warpField.field);
  networkSec.appendChild(netGrid);
  const proxyHint = el('div', 'mt-3 text-xs text-gray-500');
  proxyHint.innerHTML = 'SOCKS — для signaling. WARP — для клиентского трафика (отдельный SOCKS5).';
  networkSec.appendChild(proxyHint);
  div.appendChild(networkSec);

  // ── Advanced section (transport-specific + debug) ──
  const advSec = el('div', 'section mb-3');
  const advHeader = el('div', 'flex items-center justify-between cursor-pointer');
  const advTitle = el('div', 'section-title flex items-center gap-1.5 mb-0');
  advTitle.innerHTML = icon('sliders-horizontal', 12) + '<span>Advanced</span>';
  const chevron = el('span', 'text-gray-500');
  chevron.innerHTML = icon('chevron-down', 14);
  advHeader.appendChild(advTitle);
  advHeader.appendChild(chevron);
  advSec.appendChild(advHeader);
  const advBody = el('div', 'mt-3');

  const jitsiBlock = el('div', 'border border-gray-700 rounded-lg p-3 mb-3 hidden');
  jitsiBlock.innerHTML = '<div class="text-xs text-gray-400 mb-2">Jitsi DataChannel / SCTP</div>';
  const jitsiGrid = el('div', 'grid grid-cols-1 md:grid-cols-2 gap-2');
  const bridgeModeField = makeSelectField('Bridge mode', icon('sliders-horizontal', 14), inst.jitsi_bridge_mode || 'auto', ['auto', 'sctp', 'colibri-ws']);
  const jitsiSCTPMaxMessageField = makeInputField('SCTP max message', icon('sliders-horizontal', 14), inst.jitsi_sctp_max_message_size || '', { placeholder: 'empty = legacy 12288' });
  const trafficPayloadField = makeInputField('Transport payload cap', icon('sliders-horizontal', 14), inst.traffic_max_payload_size || '', { placeholder: 'empty, 1188, 4096, 8192' });
  const trafficMinDelayField = makeInputField('Min delay', icon('clock', 14), inst.traffic_min_delay || '', { placeholder: 'empty или 1ms' });
  const trafficMaxDelayField = makeInputField('Max delay', icon('clock', 14), inst.traffic_max_delay || '', { placeholder: 'empty или 3ms' });
  jitsiGrid.appendChild(bridgeModeField.field);
  jitsiGrid.appendChild(jitsiSCTPMaxMessageField.field);
  jitsiGrid.appendChild(trafficPayloadField.field);
  jitsiGrid.appendChild(trafficMinDelayField.field);
  jitsiGrid.appendChild(trafficMaxDelayField.field);
  jitsiBlock.appendChild(jitsiGrid);
  const jitsiHint = el('div', 'mt-2 text-xs text-gray-500 leading-relaxed');
  jitsiHint.innerHTML = 'Для проверенных публичных Jitsi обычно доступен только <b>SCTP</b>. ' +
    '<b>auto</b> выбирает Colibri WS только если он advertised, иначе SCTP. ' +
    '<b>colibri-ws</b> нужен только для диагностики и завершит запуск, если WS не advertised. ' +
    'Пусто сохраняет legacy SCTP frame для совместимости. Для диагностики скорости можно явно поставить SCTP max message <b>1200</b> и payload cap <b>1188</b>, но только когда обе стороны обновлены.';
  jitsiBlock.appendChild(jitsiHint);
  advBody.appendChild(jitsiBlock);

  const vp8Block = el('div', 'border border-gray-700 rounded-lg p-3 mb-3 hidden');
  vp8Block.innerHTML = '<div class="text-xs text-gray-400 mb-2">VP8 параметры</div>';
  const vp8Grid = el('div', 'grid grid-cols-2 gap-2');
  const vp8FpsInp = el('input', ''); vp8FpsInp.type = 'number'; vp8FpsInp.min = '0'; vp8FpsInp.step = '1'; vp8FpsInp.placeholder = 'FPS (empty=120, 0=core default)'; vp8FpsInp.value = inst.vp8_fps || '';
  const vp8BatchInp = el('input', ''); vp8BatchInp.type = 'number'; vp8BatchInp.min = '0'; vp8BatchInp.step = '1'; vp8BatchInp.placeholder = 'Batch (empty=64, 0=core default)'; vp8BatchInp.value = inst.vp8_batch || '';
  vp8Grid.appendChild(vp8FpsInp);
  vp8Grid.appendChild(vp8BatchInp);
  vp8Block.appendChild(vp8Grid);
  advBody.appendChild(vp8Block);

  const seiBlock = el('div', 'border border-gray-700 rounded-lg p-3 hidden');
  seiBlock.innerHTML = '<div class="text-xs text-gray-400 mb-2">SEI параметры</div>';
  const seiGrid = el('div', 'grid grid-cols-2 gap-2');
  const seiFpsInp = el('input', ''); seiFpsInp.placeholder = 'FPS (20)';
  const seiBatchInp = el('input', ''); seiBatchInp.placeholder = 'Batch (1)';
  const seiFragInp = el('input', ''); seiFragInp.placeholder = 'Fragment (900)';
  const seiAckInp = el('input', ''); seiAckInp.placeholder = 'ACK ms (3000)';
  seiGrid.appendChild(seiFpsInp); seiGrid.appendChild(seiBatchInp);
  seiGrid.appendChild(seiFragInp); seiGrid.appendChild(seiAckInp);
  seiBlock.appendChild(seiGrid);
  advBody.appendChild(seiBlock);

  const debugLabel = el('label', 'inline-flex items-center gap-2 text-sm font-medium mt-1 cursor-pointer');
  const debugEditInp = el('input', '');
  debugEditInp.type = 'checkbox';
  debugEditInp.checked = !!inst.debug;
  debugEditInp.style.width = 'auto';
  debugEditInp.style.minHeight = 'auto';
  debugLabel.appendChild(debugEditInp);
  debugLabel.appendChild(el('span', '', 'Debug (verbose openflux log)'));
  advBody.appendChild(debugLabel);

  advSec.appendChild(advBody);
  let advOpen = true;
  function setAdvOpen(open) {
    advOpen = open;
    advBody.classList.toggle('hidden', !open);
    chevron.style.transform = open ? '' : 'rotate(-90deg)';
  }
  advHeader.onclick = () => setAdvOpen(!advOpen);
  setAdvOpen(true);
  div.appendChild(advSec);

  // wbstream hint
  const wbHint = el('div', 'mb-3 text-xs text-amber-300 bg-amber-900/30 border border-amber-700/40 p-3 rounded-lg');
  wbHint.innerHTML = '<b>WB Stream.</b> Room ID и токен можно ввести вручную либо получить через удалённый Chrome: Настройки → WB Stream → «Обновить общий токен».';
  div.appendChild(wbHint);

  // Jitsi server presets (shown only when carrier=jitsi)
  const jitsiPresets = createJitsiPresetPanel(roomIDField.input, bridgeModeField.input, transportField.input);
  div.appendChild(jitsiPresets);

  // Conditional visibility (issue #52: only supported combos selectable).
  function getTransportOptions(carrier) {
    return compatibleTransports(carrier);
  }

  function isTransportCompatible(carrier, transport) {
    return compatibleTransports(carrier).includes(transport);
  }

  function updateTransportOptions() {
    const c = carrierField.input.value;
    const currentTransport = transportField.input.value;
    const allowed = compatibleTransports(c);

    // Rebuild transport select with the carrier's options only.
    transportField.input.innerHTML = '';
    allowed.forEach(t => {
      const opt = el('option', '', t);
      opt.value = t;
      transportField.input.appendChild(opt);
    });

    // Restore current selection when still compatible, else default.
    if (allowed.includes(currentTransport)) {
      transportField.input.value = currentTransport;
    } else {
      transportField.input.value = allowed[0] || '';
      showToast('Транспорт переключён на ' + (allowed[0] || '-') + ' — единственный совместимый с ' + c, 'error');
    }

    // Auto-rename instance when carrier changes
    const curName = nameField.input.value;
    if (c === 'openflux') {
      const room = roomIDField.input.value.trim();
      const t = transportField.input.value;
      if (t === 'mailru' || room.includes('mail.ru')) {
        nameField.input.value = 'OpenFlux Mail.ru';
      } else if (t === 'avito' || room.includes('avito.ru')) {
        nameField.input.value = 'OpenFlux Avito';
      } else if (t === 'cups' || t === 'cupsonline' || room.includes('cups.online')) {
        nameField.input.value = 'OpenFlux Cups';
      } else if (t === 'telemost' || room.includes('telemost.yandex.ru')) {
        nameField.input.value = 'OpenFlux Telemost';
      } else if (t === 'bitrix24' || t === 'bitrix' || room.includes('bitrix24')) {
        nameField.input.value = 'OpenFlux Bitrix24';
      } else if (t === 'boards' || t === 'board' || room.includes('boards.yandex.ru')) {
        nameField.input.value = 'OpenFlux Boards';
      } else if (t === 'vyandex' || room.includes('/edit/d/')) {
        nameField.input.value = 'OpenFlux Volga';
      } else {
        nameField.input.value = 'OpenFlux Yandex';
      }
    } else if (/^(jitsi|telemost|wbstream)_olcrtc/.test(curName) || /^OpenFlux/.test(curName) || curName === '') {
      const t = transportField.input.value;
      nameField.input.value = carrierPrefix + '_olcrtc' + (t && t !== 'vp8channel' ? '_' + t : '');
    }
    updateVisibility();
  }
  function updateNameFromTransport() {
    const c = carrierField.input.value;
    const t = transportField.input.value;
    const carriers = { jitsi: 'jitsi', telemost: 'telemost', wbstream: 'wbstream' };
    const carrierPrefix = carriers[c] || c;
    const curName = nameField.input.value;
    if (c === 'openflux') {
      const room = roomIDField.input.value.trim();
      if (t === 'mailru' || room.includes('mail.ru')) {
        nameField.input.value = 'OpenFlux Mail.ru';
      } else if (t === 'avito' || room.includes('avito.ru')) {
        nameField.input.value = 'OpenFlux Avito';
      } else if (t === 'cups' || t === 'cupsonline' || room.includes('cups.online')) {
        nameField.input.value = 'OpenFlux Cups';
      } else if (t === 'telemost' || room.includes('telemost.yandex.ru')) {
        nameField.input.value = 'OpenFlux Telemost';
      } else if (t === 'bitrix24' || t === 'bitrix' || room.includes('bitrix24')) {
        nameField.input.value = 'OpenFlux Bitrix24';
      } else if (t === 'boards' || t === 'board' || room.includes('boards.yandex.ru')) {
        nameField.input.value = 'OpenFlux Boards';
      } else if (t === 'vyandex' || room.includes('/edit/d/')) {
        nameField.input.value = 'OpenFlux Volga';
      } else {
        nameField.input.value = 'OpenFlux Yandex';
      }
    } else if (/^(jitsi|telemost|wbstream)_olcrtc/.test(curName) || /^OpenFlux/.test(curName) || curName === '') {
      nameField.input.value = carrierPrefix + '_olcrtc' + (t && t !== 'vp8channel' ? '_' + t : '');
    }
    updateVisibility();
  }
  // datachannel warning
  const dcWarn = el('div', 'p-2 mb-3 text-xs rounded border border-red-500/50 bg-red-500/10 text-red-200 hidden');
  dcWarn.innerHTML = '<strong>Внимание:</strong> DataChannel не работает с данным провайдером. Используйте <b>vp8channel</b>.';
  div.appendChild(dcWarn);
  function updateVisibility() {
    const t = transportField.input.value;
    const c = carrierField.input.value;
    vp8Block.classList.toggle('hidden', t !== 'vp8channel');
    seiBlock.classList.toggle('hidden', t !== 'seichannel');
    jitsiBlock.classList.toggle('hidden', !(c === 'jitsi' && t === 'datachannel'));
    authTokenField.field.classList.toggle('hidden', c !== 'wbstream');
    clientIDWrap.field.classList.toggle('hidden', c === 'openflux');
    wbHint.classList.toggle('hidden', c !== 'wbstream');
    jitsiPresets.classList.toggle('hidden', c !== 'jitsi');
    openfluxKeySec.classList.toggle('hidden', c !== 'openflux');
    b24Block.classList.toggle('hidden', !(c === 'openflux' && t === 'bitrix24'));
    keyRotateBtn.style.display = (c === 'openflux') ? 'none' : '';
    roomRotateBtn.disabled = (c === 'wbstream' || c === 'openflux');
    roomRotateBtn.title = (c === 'wbstream') ? 'WB Stream отключил автосоздание румы' : (c === 'openflux') ? 'Для OpenFlux используется постоянная ссылка на документ' : '';
    if (c === 'openflux') {
      const lbl = roomIDField.field.querySelector('label');
      if (lbl && lbl.lastChild) lbl.lastChild.textContent = ' Ссылка на документ (Yandex / Mail.ru Docs)';
      roomIDField.input.placeholder = 'https://disk.yandex.ru/i/... или https://docs.mail.ru/...';
    } else {
      const lbl = roomIDField.field.querySelector('label');
      if (lbl && lbl.lastChild) lbl.lastChild.textContent = ' Room ID';
      roomIDField.input.placeholder = 'jitsi: https://meet.small-dm.ru/yourroom · wbstream: создать на stream.wb.ru';
    }
    // Show datachannel warning only for non-jitsi carriers
    dcWarn.classList.toggle('hidden', !(t === 'datachannel' && c !== 'jitsi'));
  }
  carrierField.input.addEventListener('change', () => { updateTransportOptions(); });
  transportField.input.addEventListener('change', () => { updateNameFromTransport(); });
  roomIDField.input.addEventListener('input', () => {
    if (carrierField.input.value === 'openflux') updateNameFromTransport();
  });
  updateVisibility();

  // Footer actions
  const btnRow = el('div', 'flex gap-2 justify-end mt-2');
  const cancelBtn = el('button', 'btn btn-secondary');
  cancelBtn.textContent = 'Отмена';
  const saveBtn = el('button', 'btn btn-primary');
  saveBtn.textContent = 'Сохранить';
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(saveBtn);
  div.appendChild(btnRow);

  const overlay = showModal(div);
  cancelBtn.onclick = () => closeModal(overlay);
  saveBtn.onclick = async () => {
    const carrier = carrierField.input.value;
    const room = roomIDField.input.value.trim();
    const t = transportField.input.value;
    if (carrier === 'wbstream' && !room) {
      showToast('Для wbstream нужно указать Room ID', 'error');
      return;
    }
    const autoOk = (t === 'cups' || t === 'cupsonline' || t === 'avito') && (!room || room === 'auto');
    if (carrier === 'openflux' && !autoOk && (!room || (!room.startsWith('http://') && !room.startsWith('https://')))) {
      showToast('Для OpenFlux укажите полную ссылку на документ (https://...)', 'error');
      return;
    }
    const body = {
      carrier,
      transport: transportField.input.value,
      name: nameField.input.value,
      room_id: room,
      dns: dnsField.input.value,
      socks_proxy: socksField.input.value,
      warp_proxy: warpField.input.value,
      debug: debugEditInp.checked,
      jitsi_bridge_mode: bridgeModeField.input.value,
      jitsi_sctp_max_message_size: jitsiSCTPMaxMessageField.input.value.trim(),
      traffic_max_payload_size: trafficPayloadField.input.value.trim(),
      traffic_min_delay: trafficMinDelayField.input.value.trim(),
      traffic_max_delay: trafficMaxDelayField.input.value.trim(),
    };
    if (carrier === 'openflux') {
      const k = openfluxKeyInput.value.trim();
      if (k) {
        body.openflux_key = k;
      } else if (openfluxKeyCleared || inst.has_openflux_key) {
        body.clear_openflux_key = true;
      }
      body.openflux_codec = openfluxCodecField.input.value;
      if (t === 'bitrix24') {
        if (b24CookiesField.input.value.trim()) body.b24_cookies = b24CookiesField.input.value.trim();
        if (b24SessidField.input.value.trim()) body.b24_sessid = b24SessidField.input.value.trim();
        if (b24ChatField.input.value.trim()) body.b24_chat_id = b24ChatField.input.value.trim();
      }
    }
    const authToken = authTokenField.input.value.trim();
    if (authToken) {
      body.auth_token = authToken;
    }
    if (!vp8Block.classList.contains('hidden')) {
      body.vp8_fps = vp8FpsInp.value.trim();
      body.vp8_batch = vp8BatchInp.value.trim();
    }
    if (!seiBlock.classList.contains('hidden')) {
      if (seiFpsInp.value) body.sei_fps = parseInt(seiFpsInp.value, 10);
      if (seiBatchInp.value) body.sei_batch = parseInt(seiBatchInp.value, 10);
      if (seiFragInp.value) body.sei_frag = parseInt(seiFragInp.value, 10);
      if (seiAckInp.value) body.sei_ack_ms = parseInt(seiAckInp.value, 10);
    }
    await withLoading(saveBtn, async () => {
      try {
        await api('/instances/' + inst.id + '/config', { method: 'PUT', body: JSON.stringify(body) });
        showToast('Сохранено');
        closeModal(overlay);
        render();
      } catch (e) { showToast(e.message || 'Не удалось сохранить', 'error'); }
    });
  };
}

// ── Form-field factories ─────────────────────────────────────────────────────
function makeFieldShell(label, iconHTML) {
  const field = el('div', 'field');
  const labelEl = el('label', 'field-label');
  labelEl.innerHTML = (iconHTML || '') + '<span>' + label + '</span>';
  field.appendChild(labelEl);
  return { field, labelEl };
}

function makeInputField(label, iconHTML, value, opts) {
  const { field, labelEl } = makeFieldShell(label, iconHTML);
  const input = el('input', '');
  input.value = value || '';
  if (opts && opts.placeholder) input.placeholder = opts.placeholder;
  if (opts && opts.readonly) { input.readOnly = true; }
  const inputID = 'fld-' + Math.random().toString(36).slice(2, 9);
  input.id = inputID;
  labelEl.setAttribute('for', inputID);
  field.appendChild(input);
  return { field, input };
}

function makeSelectField(label, iconHTML, value, options) {
  const { field, labelEl } = makeFieldShell(label, iconHTML);
  const input = el('select', '');
  options.forEach(o => {
    const val = typeof o === 'object' && o !== null ? o.value : o;
    const txt = typeof o === 'object' && o !== null ? o.label : o;
    const opt = el('option', '', txt);
    opt.value = val;
    if (val === value) opt.selected = true;
    input.appendChild(opt);
  });
  const inputID = 'fld-' + Math.random().toString(36).slice(2, 9);
  input.id = inputID;
  labelEl.setAttribute('for', inputID);
  field.appendChild(input);
  return { field, input };
}

function makeReadonlyWithRotate(label, iconHTML, value, onRotate) {
  const { field, labelEl } = makeFieldShell(label, iconHTML);
  const row = el('div', 'field-row');
  const input = el('input', '');
  input.value = value;
  input.readOnly = true;
  const copyBtn = el('button', 'btn btn-secondary btn-icon');
  copyBtn.type = 'button';
  copyBtn.title = 'Копировать';
  copyBtn.setAttribute('aria-label', 'Копировать ' + label);
  copyBtn.innerHTML = icon('copy', 16);
  copyBtn.onclick = () => { navigator.clipboard.writeText(value); showToast(label + ' скопирован'); };
  const rotateBtn = el('button', 'btn btn-secondary btn-icon');
  rotateBtn.type = 'button';
  rotateBtn.title = 'Ротация';
  rotateBtn.setAttribute('aria-label', 'Ротация ' + label);
  rotateBtn.innerHTML = icon('rotate-ccw', 16);
  rotateBtn.onclick = () => onRotate(rotateBtn);
  row.appendChild(input);
  row.appendChild(copyBtn);
  row.appendChild(rotateBtn);
  field.appendChild(row);
  const hint = el('div', 'text-xs text-gray-500 mt-1', 'Управляется кнопкой ротации');
  field.appendChild(hint);
  return { field, input };
}

// ── Subscription modals ──────────────────────────────────────────────────────
async function showManageSubInstancesModal(sub, instances, allSubs) {
  const div = el('div', '');
  const title = el('h3', 'text-lg font-semibold mb-1', 'Состав подписки «' + sub.name + '»');
  div.appendChild(title);
  div.appendChild(el('div', 'text-sm text-gray-400 mb-4', 'Отметьте нужные инстансы. Уже добавленные отмечены галочкой; изменения применятся одной кнопкой.'));

  const list = el('div', 'space-y-2 mb-4 max-h-72 overflow-y-auto pr-1');
  list.appendChild(el('div', 'text-sm text-gray-400', 'Загрузка...'));
  div.appendChild(list);

  const manualTitle = el('div', 'font-medium text-sm mb-2', 'Добавить URI вручную');
  const manualInp = el('textarea', 'w-full mb-1');
  manualInp.rows = 3;
  manualInp.placeholder = 'olcrtc://...\nПо одному URI на строку';
  div.appendChild(manualTitle);
  div.appendChild(manualInp);
  div.appendChild(el('div', 'text-xs text-gray-500 mb-4', 'Можно добавить несколько URI сразу — по одному на строку.'));

  const btnRow = el('div', 'flex gap-2 justify-end');
  const cancelBtn = el('button', 'btn btn-secondary');
  cancelBtn.textContent = 'Отмена';
  const saveBtn = el('button', 'btn btn-primary');
  saveBtn.textContent = 'Сохранить состав';
  saveBtn.disabled = true;
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(saveBtn);
  div.appendChild(btnRow);

  const overlay = showModal(div);
  cancelBtn.onclick = () => closeModal(overlay);

  let subscriptionInstances;
  const otherSubsMemberships = new Map();
  try {
    subscriptionInstances = await api('/subs/' + sub.slug + '/instances');
    if (Array.isArray(allSubs) && allSubs.length > 1) {
      const otherSubs = allSubs.filter(s => s.slug !== sub.slug);
      const results = await Promise.allSettled(
        otherSubs.map(s => api('/subs/' + s.slug + '/instances').then(items => ({ sub: s, items })))
      );
      results.forEach(res => {
        if (res.status === 'fulfilled' && Array.isArray(res.value.items)) {
          const sName = res.value.sub.name || res.value.sub.slug;
          res.value.items.forEach(entry => {
            if (entry.source_instance_id !== null && entry.source_instance_id !== undefined) {
              const srcId = String(entry.source_instance_id);
              if (!otherSubsMemberships.has(srcId)) otherSubsMemberships.set(srcId, new Set());
              otherSubsMemberships.get(srcId).add(sName);
            }
          });
        }
      });
    }
  } catch (e) {
    list.innerHTML = '';
    list.appendChild(el('div', 'text-rose-400 text-sm', 'Ошибка: ' + e.message));
    return;
  }

  const linkedBySource = new Map();
  const looseEntries = [];
  const adminIDs = new Set((instances || []).map(inst => String(inst.id)));
  (subscriptionInstances || []).forEach(entry => {
    const hasSource = entry.source_instance_id !== null && entry.source_instance_id !== undefined;
    const sourceKey = hasSource ? String(entry.source_instance_id) : '';
    if (!hasSource || !adminIDs.has(sourceKey)) {
      looseEntries.push(entry);
      return;
    }
    if (!linkedBySource.has(sourceKey)) linkedBySource.set(sourceKey, []);
    linkedBySource.get(sourceKey).push(entry);
  });

  list.innerHTML = '';
  const choices = [];
  const subscriptionPart = cleanInstanceNamePart(sub.name) || 'subscription';
  if (!instances || instances.length === 0) {
    list.appendChild(el('div', 'text-gray-400 text-sm', 'В Admin UI пока нет инстансов.'));
  }
  (instances || []).forEach(inst => {
    const linkedEntries = linkedBySource.get(String(inst.id)) || [];
    const initiallyLinked = linkedEntries.length > 0;
    const baseName = instanceProviderPrefix(inst) + '_' + subscriptionPart;
    const rawURI = withInstanceName(inst.subscription_uri || inst.uri || '', baseName);
    const row = el('label', 'radio-row card');
    const checkbox = el('input', '');
    checkbox.type = 'checkbox';
    checkbox.checked = initiallyLinked;
    checkbox.disabled = !initiallyLinked && !rawURI;
    checkbox.style.width = 'auto';
    checkbox.style.minHeight = 'auto';

    const info = el('div', 'flex-1 min-w-0');
    const nameRow = el('div', 'flex items-center justify-between gap-2');
    nameRow.appendChild(el('span', 'text-sm font-medium truncate', inst.label || ('Инстанс #' + inst.id)));
    const state = el('span', 'badge');
    nameRow.appendChild(state);
    info.appendChild(nameRow);
    info.appendChild(el('div', 'text-xs text-gray-500 truncate', '#' + inst.id + ' — ' + (inst.carrier || '-') + ' / ' + (inst.transport || '-')));
    const otherSubNames = Array.from(otherSubsMemberships.get(String(inst.id)) || []);
    if (otherSubNames.length > 0) {
      const otherRow = el('div', 'text-xs text-indigo-400 mt-0.5 truncate');
      otherRow.textContent = 'В подписках: ' + otherSubNames.join(', ');
      info.appendChild(otherRow);
    }

    const updateState = () => {
      state.className = 'badge';
      if (checkbox.disabled) {
        state.textContent = 'URI недоступен';
      } else if (initiallyLinked && checkbox.checked) {
        state.classList.add('badge-emerald');
        state.textContent = linkedEntries.length > 1 ? ('Добавлен ×' + linkedEntries.length) : 'Добавлен';
      } else if (initiallyLinked) {
        state.classList.add('badge-amber');
        state.textContent = 'Будет удалён';
      } else if (checkbox.checked) {
        state.classList.add('badge-blue');
        state.textContent = 'Будет добавлен';
      } else {
        state.textContent = 'Не добавлен';
      }
    };
    checkbox.onchange = updateState;
    updateState();
    row.appendChild(checkbox);
    row.appendChild(info);
    list.appendChild(row);
    choices.push({ checkbox, initiallyLinked, linkedEntries, rawURI, sourceInstanceID: inst.id });
  });

  const looseChoices = [];
  if (looseEntries.length > 0) {
    list.appendChild(el('div', 'font-medium text-sm pt-2', 'Ручные и недоступные записи'));
    looseEntries.forEach(entry => {
      const hasSource = entry.source_instance_id !== null && entry.source_instance_id !== undefined;
      const row = el('label', 'radio-row card');
      const checkbox = el('input', '');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.style.width = 'auto';
      checkbox.style.minHeight = 'auto';
      const info = el('div', 'flex-1 min-w-0');
      info.appendChild(el('div', 'text-sm font-medium', hasSource ? ('Удалённый инстанс #' + entry.source_instance_id) : 'Ручной URI'));
      info.appendChild(el('div', 'text-xs text-gray-500 truncate', entry.raw_uri || '-'));
      const state = el('span', 'badge badge-emerald', hasSource ? 'Недоступен в Admin' : 'Добавлен');
      checkbox.onchange = () => {
        state.className = checkbox.checked ? 'badge badge-emerald' : 'badge badge-amber';
        state.textContent = checkbox.checked ? (hasSource ? 'Недоступен в Admin' : 'Добавлен') : 'Будет удалён';
      };
      row.appendChild(checkbox);
      row.appendChild(info);
      row.appendChild(state);
      list.appendChild(row);
      looseChoices.push({ checkbox, entry });
    });
  }

  saveBtn.disabled = false;
  saveBtn.onclick = async () => {
    const removals = [];
    const additions = [];
    choices.forEach(choice => {
      if (choice.initiallyLinked && !choice.checkbox.checked) {
        choice.linkedEntries.forEach(entry => removals.push(entry));
      } else if (!choice.initiallyLinked && choice.checkbox.checked) {
        additions.push({ rawURI: choice.rawURI, sourceInstanceID: choice.sourceInstanceID });
      }
    });
    looseChoices.forEach(choice => {
      if (!choice.checkbox.checked) removals.push(choice.entry);
    });

    const manualURIs = [...new Set(manualInp.value.split(/\r?\n/).map(uri => uri.trim()).filter(Boolean))];
    const invalidURI = manualURIs.find(uri => !uri.toLowerCase().startsWith('olcrtc://') && !uri.toLowerCase().startsWith('openflux://'));
    if (invalidURI) {
      showToast('Ручной URI должен начинаться с olcrtc:// или openflux://', 'error');
      return;
    }
    manualURIs.forEach(rawURI => additions.push({ rawURI, sourceInstanceID: null }));

    if (removals.length === 0 && additions.length === 0) {
      showToast('Изменений нет');
      return;
    }

    await withLoading(saveBtn, async () => {
      let removed = 0;
      let added = 0;
      const errors = [];
      for (const entry of removals) {
        try {
          await api('/subs/' + sub.slug + '/instances/' + entry.id, { method: 'DELETE' });
          removed++;
        } catch (e) { errors.push(e); }
      }
      for (const addition of additions) {
        try {
          const body = { raw_uri: addition.rawURI };
          if (addition.sourceInstanceID !== null && addition.sourceInstanceID !== undefined) {
            body.source_instance_id = addition.sourceInstanceID;
          }
          await api('/subs/' + sub.slug + '/instances', { method: 'POST', body: JSON.stringify(body) });
          added++;
        } catch (e) { errors.push(e); }
      }

      closeModal(overlay);
      render();
      if (errors.length > 0) {
        const prefix = added + removed > 0 ? ('Сохранено частично: добавлено ' + added + ', удалено ' + removed + '. ') : '';
        showToast(prefix + 'Ошибок: ' + errors.length + '. ' + errors[0].message, 'error');
      } else {
        showToast('Состав сохранён: добавлено ' + added + ', удалено ' + removed);
      }
    });
  };
}

function showCreateSubModal() {
  const div = el('div', '');
  div.innerHTML = '<h3 class="text-lg font-semibold mb-3">Создать подписку</h3>';
  const nameInp = el('input', 'mb-3');
  nameInp.placeholder = 'Имя подписки';
  const slugRow = el('div', 'slug-row mb-3');
  const slugInp = el('input', '');
  slugInp.placeholder = 'Slug (пусто = автогенерация)';
  const randBtn = el('button', 'btn btn-secondary btn-sm');
  randBtn.type = 'button';
  randBtn.textContent = 'Случайный';
  randBtn.onclick = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let s = ''; const len = 5 + Math.floor(Math.random() * 6);
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
    slugInp.value = s;
  };
  slugRow.appendChild(slugInp);
  slugRow.appendChild(randBtn);
  div.appendChild(nameInp);
  div.appendChild(slugRow);

  const btnRow = el('div', 'flex gap-2 justify-end');
  const cancelBtn = el('button', 'btn btn-secondary');
  cancelBtn.textContent = 'Отмена';
  const createBtn = el('button', 'btn btn-primary');
  createBtn.textContent = 'Создать';
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(createBtn);
  div.appendChild(btnRow);

  const overlay = showModal(div);
  cancelBtn.onclick = () => closeModal(overlay);
  createBtn.onclick = async () => {
    if (!nameInp.value) { showToast('Введите имя', 'error'); return; }
    await withLoading(createBtn, async () => {
      try {
        await api('/subs', { method: 'POST', body: JSON.stringify({ name: nameInp.value, slug: slugInp.value || undefined }) });
        showToast('Подписка создана');
        closeModal(overlay);
        render();
      } catch (e) { showToast('Ошибка: ' + e.message, 'error'); }
    });
  };
}

async function showLogsModal(service) {
  const div = el('div', '');
  div.innerHTML = '<h3 class="text-lg font-semibold mb-3">Логи: ' + service + '</h3>';
  const pre = el('pre', 'logs');
  pre.textContent = 'Загрузка...';
  div.appendChild(pre);
  const btnRow = el('div', 'flex gap-2 justify-end mt-3');
  const refreshBtn = el('button', 'btn btn-secondary btn-sm');
  refreshBtn.innerHTML = icon('refresh-cw') + '<span>Обновить</span>';
  const closeBtn = el('button', 'btn btn-primary btn-sm');
  closeBtn.textContent = 'Закрыть';
  btnRow.appendChild(refreshBtn);
  btnRow.appendChild(closeBtn);
  div.appendChild(btnRow);
  const overlay = showModal(div);

  async function load() {
    try {
      const data = await api('/system/logs/' + service + '?lines=200');
      pre.textContent = data.logs || '(пусто)';
    } catch (e) {
      pre.textContent = 'Ошибка: ' + e.message;
    }
  }
  refreshBtn.onclick = () => withLoading(refreshBtn, load);
  closeBtn.onclick = () => closeModal(overlay);
  await load();
}

function showImportSubModal() {
  const div = el('div', '');
  div.innerHTML = '<h3 class="text-lg font-semibold mb-3">Импорт подписок</h3>';
  const ta = el('textarea', 'mb-3');
  ta.placeholder = 'Вставьте JSON с подписками...';
  ta.rows = 8;
  div.appendChild(ta);

  const cbRow = el('label', 'mb-3 flex items-center gap-2 text-sm cursor-pointer');
  const owCb = el('input', '');
  owCb.type = 'checkbox';
  owCb.style.width = 'auto'; owCb.style.minHeight = 'auto';
  cbRow.appendChild(owCb);
  cbRow.appendChild(el('span', '', 'Перезаписать существующие'));
  div.appendChild(cbRow);

  const btnRow = el('div', 'flex gap-2 justify-end');
  const cancelBtn = el('button', 'btn btn-secondary');
  cancelBtn.textContent = 'Отмена';
  const impBtn = el('button', 'btn btn-primary');
  impBtn.textContent = 'Импортировать';
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(impBtn);
  div.appendChild(btnRow);

  const overlay = showModal(div);
  cancelBtn.onclick = () => closeModal(overlay);
  impBtn.onclick = async () => {
    await withLoading(impBtn, async () => {
      try {
        const data = JSON.parse(ta.value);
        const url = '/subs/import' + (owCb.checked ? '?overwrite=true' : '');
        const res = await api(url, { method: 'POST', body: JSON.stringify(data) });
        showToast('Импортировано: ' + (res.created || 0) + ' создано, ' + (res.skipped || 0) + ' пропущено');
        closeModal(overlay);
        render();
      } catch (e) { showToast('Ошибка: ' + e.message, 'error'); }
    });
  };
}

// ── Update overlay ───────────────────────────────────────────────────────────
const UPDATE_STEPS = [
  { id: 'download',    label: 'Скачивание бинарников',  phases: ['queued', 'starting', 'downloading_server', 'downloading_admin', 'verifying'] },
  { id: 'stopping',    label: 'Остановка сервисов',     phases: ['stopping'] },
  { id: 'replacing',   label: 'Замена бинарников',      phases: ['replacing'] },
  { id: 'starting',    label: 'Запуск сервера и админки', phases: ['starting_server', 'starting_admin'] },
  { id: 'ready',       label: 'Готовность к работе',    phases: ['completed'] },
];

function phaseToStepIndex(phase) {
  for (let i = 0; i < UPDATE_STEPS.length; i++) {
    if (UPDATE_STEPS[i].phases.includes(phase)) return i;
  }
  return -1;
}

// kick sends the actual update request. Polling must not start before it settles:
// /tmp/olcrtc-update-state.json outlives previous runs, so an older "error" phase
// would otherwise be picked up instantly and stop tracking this update.
function showUpdateOverlay(targetVersion, targetBranch, kick) {
  const existing = document.getElementById('update-overlay');
  if (existing) existing.remove();

  const overlay = el('div', '');
  overlay.id = 'update-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(1,1,2,0.95);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;z-index:9999;animation:fadeIn 0.3s ease-out;';

  const content = el('div', '');
  content.style.cssText = 'text-align:center;max-width:520px;padding:48px 32px;width:100%;';

  const spinnerWrap = el('div', '');
  spinnerWrap.style.cssText = 'margin-bottom:28px;display:flex;justify-content:center;';
  spinnerWrap.innerHTML = '<div id="update-spinner" style="width:64px;height:64px;border:4px solid var(--color-hairline);border-top-color:var(--color-primary);border-radius:50%;animation:spin 1s linear infinite;"></div>';

  const title = el('h2', '');
  title.style.cssText = 'font-size:28px;font-weight:600;letter-spacing:-0.6px;color:var(--color-ink);margin-bottom:10px;';
  title.textContent = 'Обновление сервера';

  const subtitle = el('p', '');
  subtitle.style.cssText = 'font-size:15px;color:var(--color-ink-muted);margin-bottom:28px;line-height:1.5;';
  subtitle.textContent = 'Устанавливается версия ' + targetVersion + ' из ветки ' + (targetBranch || 'master');

  const stepsList = el('div', '');
  stepsList.id = 'update-steps';
  stepsList.style.cssText = 'text-align:left;background:rgba(255,255,255,0.03);border:1px solid var(--color-hairline);border-radius:12px;padding:16px 20px;margin-bottom:20px;';
  UPDATE_STEPS.forEach((step, idx) => {
    const row = el('div', '');
    row.id = 'update-step-' + step.id;
    row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:8px 0;font-size:14px;color:var(--color-ink-subtle);';
    const marker = el('div', '');
    marker.className = 'update-step-marker';
    marker.style.cssText = 'width:20px;height:20px;border-radius:50%;border:2px solid var(--color-hairline);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--color-ink-tertiary);transition:all 0.3s;';
    marker.textContent = String(idx + 1);
    const label = el('span', '');
    label.className = 'update-step-label';
    label.textContent = step.label;
    row.appendChild(marker);
    row.appendChild(label);
    stepsList.appendChild(row);
  });

  const status = el('div', '');
  status.id = 'update-status';
  status.style.cssText = 'font-size:13px;color:var(--color-ink-subtle);margin-bottom:8px;font-family:ui-monospace,monospace;min-height:18px;';
  status.textContent = 'Подготовка...';

  const progressBar = el('div', '');
  progressBar.style.cssText = 'width:100%;height:4px;background:var(--color-hairline);border-radius:2px;margin-top:8px;overflow:hidden;';
  const progressFill = el('div', '');
  progressFill.id = 'update-progress';
  progressFill.style.cssText = 'height:100%;background:var(--color-primary);width:1%;transition:width 0.6s ease;';
  progressBar.appendChild(progressFill);

  const meta = el('div', '');
  meta.style.cssText = 'display:flex;justify-content:space-between;font-size:12px;color:var(--color-ink-tertiary);margin-top:12px;';
  const elapsedEl = el('span', ''); elapsedEl.id = 'update-elapsed'; elapsedEl.textContent = 'Прошло: 0s';
  const percentEl = el('span', ''); percentEl.id = 'update-percent'; percentEl.textContent = '1%';
  meta.appendChild(elapsedEl);
  meta.appendChild(percentEl);

  content.appendChild(spinnerWrap);
  content.appendChild(title);
  content.appendChild(subtitle);
  content.appendChild(stepsList);
  content.appendChild(status);
  content.appendChild(progressBar);
  content.appendChild(meta);
  overlay.appendChild(content);
  document.body.appendChild(overlay);

  const startTime = Date.now();
  let lastPhase = 'queued';
  let lastMessage = 'Подготовка обновления...';
  let lastPercent = 1;
  let adminWentDown = false;
  let finishing = false;
  let pollInterval = null;
  // Server-side timestamp of this run, taken from the update response. Comparing it
  // with state.updated_at (also server-side) filters out leftovers without relying
  // on the browser clock matching the server clock.
  let minUpdatedAt = 0;

  function applyStepIndex(activeIdx) {
    UPDATE_STEPS.forEach((step, idx) => {
      const row = document.getElementById('update-step-' + step.id);
      if (!row) return;
      const marker = row.querySelector('.update-step-marker');
      if (idx < activeIdx) {
        marker.style.borderColor = 'var(--color-success, #22c55e)';
        marker.style.background = 'var(--color-success, #22c55e)';
        marker.style.color = '#fff';
        marker.textContent = '✓';
        row.style.color = 'var(--color-ink)';
      } else if (idx === activeIdx) {
        marker.style.borderColor = 'var(--color-primary)';
        marker.style.background = 'var(--color-primary)';
        marker.style.color = '#fff';
        marker.textContent = String(idx + 1);
        row.style.color = 'var(--color-ink)';
      } else {
        marker.style.borderColor = 'var(--color-hairline)';
        marker.style.background = 'transparent';
        marker.style.color = 'var(--color-ink-tertiary)';
        marker.textContent = String(idx + 1);
        row.style.color = 'var(--color-ink-subtle)';
      }
    });
  }

  function applyState(phase, message, percent, adminDown) {
    const stepIdx = phaseToStepIndex(phase);
    if (stepIdx >= 0) applyStepIndex(stepIdx);
    if (typeof percent === 'number' && percent >= lastPercent) {
      lastPercent = percent;
      progressFill.style.width = percent + '%';
      percentEl.textContent = percent + '%';
    }
    if (adminDown) {
      status.textContent = (message || lastMessage) + ' (админка перезапускается...)';
    } else {
      status.textContent = message || lastMessage;
    }
  }

  function fail(msg) {
    finishing = true;
    clearInterval(elapsedInterval);
    clearInterval(pollInterval);
    const spinner = document.getElementById('update-spinner');
    if (spinner) {
      spinner.style.animation = 'none';
      spinner.style.borderColor = 'var(--color-danger, #ef4444)';
      spinner.style.borderTopColor = 'var(--color-danger, #ef4444)';
    }
    title.textContent = 'Ошибка обновления';
    status.textContent = msg;
    status.style.color = 'var(--color-danger, #ef4444)';
    const closeBtn = el('button', 'btn btn-secondary');
    closeBtn.textContent = 'Закрыть';
    closeBtn.style.cssText = 'margin-top:20px;';
    closeBtn.onclick = () => overlay.remove();
    content.appendChild(closeBtn);
  }

  function complete() {
    if (finishing) return;
    finishing = true;
    applyStepIndex(UPDATE_STEPS.length); // all checked
    progressFill.style.width = '100%';
    percentEl.textContent = '100%';
    status.textContent = 'Обновление завершено! Перезагрузка...';
    clearInterval(elapsedInterval);
    clearInterval(pollInterval);
    setTimeout(() => { location.reload(); }, 1500);
  }

  const elapsedInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    elapsedEl.textContent = 'Прошло: ' + elapsed + 's';
  }, 1000);

  async function pollOnce() {
    if (finishing) return;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);

    // Try to read real progress from admin
    let progressData = null;
    let adminReachable = false;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(API + '/system/update-progress', {
        headers: creds ? { 'Authorization': 'Basic ' + btoa(creds.username + ':' + creds.password) } : {},
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        progressData = await res.json();
        adminReachable = true;
        if (progressData && minUpdatedAt && typeof progressData.updated_at === 'number' && progressData.updated_at < minUpdatedAt) {
          // State file still describes an earlier update — treat it as no data.
          progressData = null;
        }
      }
    } catch (e) {
      adminWentDown = true;
    }

    if (progressData) {
      lastPhase = progressData.phase || lastPhase;
      lastMessage = progressData.message || lastMessage;
      const percent = typeof progressData.percent === 'number' ? progressData.percent : lastPercent;
      applyState(lastPhase, lastMessage, percent, false);

      if (lastPhase === 'error') {
        fail(lastMessage || 'Произошла ошибка во время обновления');
        return;
      }

      // Real "completed" from script — verify admin actually serves new version before reload
      if (lastPhase === 'completed') {
        try {
          const sres = await fetch(API + '/system/status', {
            headers: creds ? { 'Authorization': 'Basic ' + btoa(creds.username + ':' + creds.password) } : {},
          });
          if (sres.ok) {
            const sd = await sres.json();
            const v = (sd.version || '').replace(/^v/, '');
            const t = (targetVersion || '').replace(/^v/, '');
            const b = sd.release_branch || 'master';
            if (v && v === t && b === (targetBranch || 'master')) { complete(); return; }
            // version still old — admin is up but binary not yet swapped from its perspective
            status.textContent = 'Завершение обновления... (версия: ' + (sd.version || 'неизвестно') + ', ветка: ' + b + ')';
          }
        } catch (e) { /* ignore */ }
      }
    } else {
      // Admin is unreachable — we're in stop/replace/restart window. Show last known phase.
      // If we haven't seen any phase past "verifying", assume we just hit "stopping".
      const lastIdx = phaseToStepIndex(lastPhase);
      if (lastIdx <= 0 && elapsed > 5) {
        // No state file yet but admin is down — assume stopping
        applyState('stopping', 'Остановка сервисов...', Math.max(lastPercent, 45), true);
      } else if (lastIdx === 1) {
        // We were at "stopping", now admin is gone — likely "replacing"
        applyState('replacing', 'Замена бинарников...', Math.max(lastPercent, 60), true);
      } else {
        applyState(lastPhase, lastMessage, lastPercent, true);
      }
    }

    // Safety net: reload after 3 minutes regardless
    if (elapsed > 180) {
      status.textContent = 'Время ожидания истекло. Перезагрузка...';
      clearInterval(elapsedInterval);
      clearInterval(pollInterval);
      setTimeout(() => { location.reload(); }, 1500);
    }
  }

  function startPolling() {
    if (pollInterval) return;
    pollOnce();
    pollInterval = setInterval(pollOnce, 1500);
  }

  if (typeof kick === 'function') {
    Promise.resolve().then(kick).then((res) => {
      if (res && typeof res.started_at === 'number') minUpdatedAt = res.started_at;
    }).catch((e) => {
      // The request can be cut short while the admin restarts — the update itself
      // may well be running, so fall back to polling without a stale-state filter.
      console.error('Запрос обновления завершился ошибкой', e);
    }).then(startPolling);
    // Watchdog: a request that never settles must not leave the overlay frozen
    // without the polling loop (and its own timeout).
    setTimeout(startPolling, 15000);
  } else {
    startPolling();
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Initialize theme
  setTheme();
  render();
});
})();
