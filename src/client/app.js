/* ════════════════════════════════════════════════════════════════
   ANIMSA — İstemci uygulaması (saf JavaScript)
   Bölümler:
    1. Yardımcılar       6. Giriş + canlı önizleme   11. Alarm / erteleme
    2. Depolama          7. Mikrofon / konuşma       12. Ayarlar
    3. Arka plan         8. Onay kartı               13. Tanıtım
    4. Başlık            9. Başarı + konfeti         14. Bildirim + senkron
    5. Liste            10. Kaydırarak silme         15. Başlatma
   parse(), dayLabel(), hhmm(), fullDate() derlemede bu dosyanın önüne eklenir.
   ════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

const VERSION = '__VERSION__';

/* ═══ 1. Yardımcılar ═══ */
const $ = id => document.getElementById(id);
const html = document.documentElement;
const reduceMQ = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const isStandalone = () => (window.navigator.standalone === true) || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lowerTR = s => String(s).toLocaleLowerCase('tr-TR');
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function haptic(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* desteklenmiyor */ } }
function uuid() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* yok */ }
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** "2 saat 14 dakika sonra" */
function leftLong(ms) {
  if (ms <= 0) return 'Zamanı geldi';
  const mins = Math.ceil(ms / 60000);
  if (mins < 1) return '1 dakikadan az kaldı';
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  const parts = [];
  if (d) parts.push(d + ' gün');
  if (h) parts.push(h + ' saat');
  if (m && !d) parts.push(m + ' dakika');
  if (!parts.length) parts.push(mins + ' dakika');
  return parts.join(' ') + ' sonra';
}
/** "2s 14d" */
function leftShort(ms) {
  if (ms <= 0) return 'şimdi';
  const mins = Math.ceil(ms / 60000);
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d) return d + 'g' + (h ? ' ' + h + 's' : '');
  if (h) return h + 's' + (m ? ' ' + m + 'd' : '');
  return m + 'd';
}

/* Toast */
function toast(msg, type) {
  const box = $('toasts');
  const t = document.createElement('div');
  t.className = 'toast glass' + (type ? ' ' + type : '');
  t.setAttribute('role', type === 'err' ? 'alert' : 'status');
  t.innerHTML = `<span class="ic" aria-hidden="true">${type === 'err' ? '⚠️' : type === 'ok' ? '✨' : '💬'}</span><span>${esc(msg)}</span>`;
  box.appendChild(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 450); }, 3000);
  while (box.children.length > 3) box.firstElementChild.remove();
}

/* Genel hata yakalayıcı: kullanıcı asla ham hata görmez */
window.addEventListener('error', () => { /* sessizce yut, arayüz çalışmaya devam eder */ });
window.addEventListener('unhandledrejection', e => { try { e.preventDefault(); } catch (x) { /* yok */ } });

/* ═══ 2. Depolama ═══ */
const K_REM = 'anımsa.reminders', K_UID = 'anımsa.uid', K_SET = 'anımsa.settings';
function readLS(k, fallback) {
  try { const v = localStorage.getItem(k); if (v == null) return fallback; const p = JSON.parse(v); return p == null ? fallback : p; } catch (e) { return fallback; }
}
function writeLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

function validReminder(r) {
  return r && typeof r === 'object' && typeof r.id === 'string' && typeof r.text === 'string' && Number.isFinite(r.at);
}
const state = {
  reminders: [],
  uid: null,
  settings: { onboarded: false, silent: false, lastSubAt: 0, pendingDeletes: [] },
  tab: 'up'
};
function loadState() {
  const list = readLS(K_REM, []);
  state.reminders = Array.isArray(list) ? list.filter(validReminder).map(r => ({
    id: r.id, text: String(r.text).slice(0, 200), at: +r.at, createdAt: Number.isFinite(r.createdAt) ? r.createdAt : Date.now(),
    synced: !!r.synced, done: !!r.done, snoozedFrom: Number.isFinite(r.snoozedFrom) ? r.snoozedFrom : undefined
  })) : [];
  const uid = readLS(K_UID, null);
  state.uid = typeof uid === 'string' && /^[a-f0-9]{64}$/.test(uid) ? uid : null;
  const s = readLS(K_SET, {});
  if (s && typeof s === 'object') {
    state.settings.onboarded = !!s.onboarded;
    state.settings.silent = !!s.silent;
    state.settings.lastSubAt = Number.isFinite(s.lastSubAt) ? s.lastSubAt : 0;
    state.settings.pendingDeletes = Array.isArray(s.pendingDeletes) ? s.pendingDeletes.filter(x => typeof x === 'string').slice(-200) : [];
  }
  prunePast();
}
function prunePast() {
  const now = Date.now();
  const past = state.reminders.filter(r => r.at <= now).sort((a, b) => b.at - a.at);
  if (past.length > 50) {
    const drop = new Set(past.slice(50).map(r => r.id));
    state.reminders = state.reminders.filter(r => !drop.has(r.id));
  }
}
function save() {
  writeLS(K_REM, state.reminders);
  writeLS(K_SET, state.settings);
  if (state.uid) writeLS(K_UID, state.uid); else { try { localStorage.removeItem(K_UID); } catch (e) { /* yok */ } }
}

/* ═══ 3. Canlı arka plan: yıldız tozu ═══ */
const stars = (() => {
  const cv = $('stars');
  const ctx = cv.getContext('2d');
  let parts = [], raf = 0, w = 0, h = 0, dpr = 1, running = false, last = 0;
  let frames = 0, frameSum = 0, measured = false;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = innerWidth; h = innerHeight;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function spawn(n) {
    parts = [];
    for (let i = 0; i < n; i++) parts.push({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.3 + 0.3, v: Math.random() * 6 + 3, p: Math.random() * Math.PI * 2, s: Math.random() * 0.8 + 0.4, hue: Math.random() < 0.3 ? 'c' : Math.random() < 0.5 ? 'p' : 'w' });
  }
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(64, t - last) : 16; last = t;
    // İlk 90 karede hız ölç: düşük güç modunda (≈30 fps) parçacıkları kapat
    // İlk ~2 saniyede kare hızını ölç: düşük güç modunda (iOS ≈30 fps'ye kısar) ya da zayıf cihazda parçacıkları kapat
    if (!measured) {
      frames++;
      if (frames === 6) frameSum = t;                       // ilk birkaç kareyi (ısınma) sayma
      if (frames > 6 && t - frameSum > 2000) {
        measured = true;
        const fps = (frames - 6) * 1000 / (t - frameSum);
        if (fps < 40) { document.body.classList.add('low-power'); stop(); ctx.clearRect(0, 0, w, h); return; }
      }
    }
    ctx.clearRect(0, 0, w, h);
    for (const q of parts) {
      q.y -= q.v * dt / 1000; q.p += q.s * dt / 1000;
      if (q.y < -4) { q.y = h + 4; q.x = Math.random() * w; }
      const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(q.p * 2));
      ctx.globalAlpha = a;
      ctx.fillStyle = q.hue === 'c' ? '#9BEAFF' : q.hue === 'p' ? '#C6B8FF' : '#FFFFFF';
      ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function start() {
    if (running || reduceMQ.matches || document.body.classList.contains('low-power') || document.hidden) return;
    running = true; last = 0; raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; cancelAnimationFrame(raf); raf = 0; }
  function init() {
    resize();
    const cores = navigator.hardwareConcurrency || 4;
    spawn(cores <= 4 ? 40 : 56);
    if (reduceMQ.matches) { ctx.clearRect(0, 0, w, h); return; }
    start();
    addEventListener('resize', () => { resize(); spawn(parts.length || 40); });
    document.addEventListener('visibilitychange', () => { document.hidden ? stop() : start(); });
  }
  return { init, start, stop };
})();

/* ═══ 4. Başlık ═══ */
function renderHeader() {
  const now = new Date();
  const h = now.getHours();
  $('greet').textContent = h >= 5 && h < 12 ? 'Günaydın' : h >= 12 && h < 18 ? 'İyi günler' : h >= 18 && h < 22 ? 'İyi akşamlar' : 'İyi geceler';
  $('dateLine').textContent = fullDate(now);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const todayCount = state.reminders.filter(r => r.at > now.getTime() && r.at < end).length;
  const upcoming = state.reminders.filter(r => r.at > now.getTime()).length;
  $('countTxt').textContent = todayCount ? `Bugün ${todayCount} hatırlatıcın var` : upcoming ? 'Bugün için hatırlatıcın yok' : 'Her şey yolunda';
}

/* ═══ 5. Liste ═══ */
const RING_SM = 2 * Math.PI * 23, RING_LG = 2 * Math.PI * 46;
const cardEls = new Map();   // id → kart elemanı (anahtar tabanlı yeniden kullanım)
let firstRender = true, dropId = null;

function upcomingList() { const n = Date.now(); return state.reminders.filter(r => r.at > n).sort((a, b) => a.at - b.at); }
function pastList() { const n = Date.now(); return state.reminders.filter(r => r.at <= n).sort((a, b) => b.at - a.at); }
function progressOf(r, now) { const total = Math.max(60000, r.at - r.createdAt); return clamp((now - r.createdAt) / total, 0, 1); }
function ringClass(ms) { return ms < 3600000 ? 'c-pink' : ms <= 6 * 3600000 ? 'c-cyan' : 'c-purple'; }
function whenText(r) { const d = new Date(r.at); return dayLabel(d, new Date()) + ' ' + hhmm(d); }

function groupOf(r, now) {
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.floor((new Date(r.at).setHours(0, 0, 0, 0) - d0) / 86400000);
  if (diff <= 0) return ['today', 'Bugün'];
  if (diff === 1) return ['tomorrow', 'Yarın'];
  if (diff < 7) return ['week', 'Bu hafta'];
  return ['later', 'Daha sonra'];
}

function makeCard(r, past) {
  const wrap = document.createElement('div');
  wrap.className = 'card-wrap';
  wrap.dataset.id = r.id;
  wrap.innerHTML = `
    <div class="del-bg" aria-hidden="false"><button class="del-btn" aria-label="Sil: ${esc(r.text)}"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>Sil</button></div>
    <div class="card glass press${past ? ' past' : ''}" role="group">
      <div class="emoji" aria-hidden="true"></div>
      <div class="card-txt"><div class="card-title"></div><div class="card-sub num"></div></div>
      <div class="ring-sm" aria-hidden="true"><svg viewBox="0 0 54 54"><circle class="ring-track" cx="27" cy="27" r="23" stroke-width="3.5"/><circle class="ring-bar" cx="27" cy="27" r="23" stroke-width="3.5" stroke-dasharray="${RING_SM}" stroke-dashoffset="${RING_SM}"/></svg><div class="ring-center num"></div></div>
    </div>`;
  attachSwipe(wrap);
  return wrap;
}
function updateCard(wrap, r, now) {
  const past = r.at <= now;
  const card = wrap.querySelector('.card');
  card.classList.toggle('past', past);
  wrap.querySelector('.emoji').textContent = emojiFor(r.text);
  wrap.querySelector('.card-title').textContent = r.text;
  const sub = wrap.querySelector('.card-sub');
  const st = whenText(r) + (r.snoozedFrom ? ' · ertelendi' : '');
  sub.innerHTML = esc(st) + (!r.synced && !past && state.uid ? '<span class="unsynced">senkronize değil</span>' : '');
  const ms = r.at - now;
  const ring = wrap.querySelector('.ring-sm');
  ring.hidden = past;
  if (!past) {
    ring.className = 'ring-sm ' + ringClass(ms);
    wrap.querySelector('.ring-center').textContent = leftShort(ms);
    wrap.querySelector('.ring-bar').style.strokeDashoffset = String(RING_SM * (1 - progressOf(r, now)));
  }
  // <1 saat: dönen kenar ışığı
  const urgent = !past && ms < 3600000;
  let edge = card.querySelector('.glow-edge');
  if (urgent && !edge) { edge = document.createElement('span'); edge.className = 'glow-edge'; edge.setAttribute('aria-hidden', 'true'); card.appendChild(edge); }
  else if (!urgent && edge) edge.remove();
  card.setAttribute('aria-label', `${r.text}, ${whenText(r)}${past ? ', geçti' : ', ' + leftLong(ms)}`);
}

function renderHero(next, now) {
  const box = $('hero');
  if (!next) {
    if (box.dataset.state !== 'empty') {
      box.dataset.state = 'empty'; box.dataset.id = '';
      box.innerHTML = `<div class="empty">
        <svg viewBox="0 0 168 168" aria-hidden="true"><defs>
          <radialGradient id="eg" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#7C5CFF" stop-opacity=".55"/><stop offset=".6" stop-color="#19D3FF" stop-opacity=".12"/><stop offset="1" stop-color="#19D3FF" stop-opacity="0"/></radialGradient>
          <linearGradient id="eb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#A08BFF"/><stop offset="1" stop-color="#19D3FF"/></linearGradient>
          <linearGradient id="em" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE3F1"/><stop offset="1" stop-color="#FF5CAA"/></linearGradient></defs>
          <circle cx="84" cy="88" r="80" fill="url(#eg)"/>
          <path d="M124 34a16 16 0 1 0 14 23 13 13 0 0 1-14-23z" fill="url(#em)" opacity=".9"/>
          <circle cx="40" cy="40" r="1.6" fill="#fff" opacity=".7"/><circle cx="132" cy="110" r="1.2" fill="#fff" opacity=".6"/><circle cx="30" cy="112" r="1" fill="#fff" opacity=".5"/>
          <g class="bell-swing"><path d="M84 46c-19 0-31 14-31 32v18l-9 13h80l-9-13V78c0-18-12-32-31-32z" fill="url(#eb)"/><path d="M62 74c2-10 9-17 18-19" stroke="#fff" stroke-opacity=".5" stroke-width="3" stroke-linecap="round" fill="none"/><circle cx="84" cy="120" r="8" fill="#F5F7FF"/><circle cx="84" cy="44" r="5" fill="url(#eb)"/></g>
        </svg>
        <h2>Henüz hatırlatıcı yok</h2>
        <p>Mikrofona dokun ve söyle. Ya da yaz: “Yarın sabah 9'da toplantı”.</p></div>`;
    }
    return;
  }
  if (box.dataset.state !== 'hero' || box.dataset.id !== next.id) {
    const isDrop = dropId === next.id;
    box.dataset.state = 'hero'; box.dataset.id = next.id;
    box.innerHTML = `<article class="hero glass${isDrop ? ' card-wrap drop' : ' tab-panel'}" aria-label="Sıradaki hatırlatıcı">
      <div class="hero-label"><span class="pulse" aria-hidden="true"></span>Sıradaki hatırlatıcı
        <button class="hero-del press" aria-label="Sıradaki hatırlatıcıyı sil"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg></button></div>
      <div class="hero-body">
        <div class="hero-main">
          <h2 class="hero-task" id="heroTask"></h2>
          <div class="hero-time num"><span id="heroTime"></span><small id="heroDay"></small></div>
          <div class="hero-left" id="heroLeft"></div>
        </div>
        <div class="ring-lg" aria-hidden="true">
          <svg viewBox="0 0 104 104"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7C5CFF"/><stop offset="1" stop-color="#19D3FF"/></linearGradient></defs>
          <circle class="ring-track" cx="52" cy="52" r="46" stroke-width="6"/>
          <circle class="ring-bar" id="heroBar" cx="52" cy="52" r="46" stroke-width="6" stroke="url(#rg)" stroke-dasharray="${RING_LG}" stroke-dashoffset="${RING_LG}"/></svg>
          <div class="ring-center num"><div><b id="heroShort"></b><span>kaldı</span></div></div>
        </div>
      </div></article>`;
    box.querySelector('.hero-del').addEventListener('click', () => heroDelete(next.id));
  }
  const d = new Date(next.at), ms = next.at - now;
  $('heroTask').textContent = next.text;
  $('heroTime').textContent = hhmm(d);
  $('heroDay').textContent = dayLabel(d, new Date());
  $('heroLeft').textContent = leftLong(ms);
  $('heroShort').textContent = leftShort(ms);
  requestAnimationFrame(() => { const b = $('heroBar'); if (b) b.style.strokeDashoffset = String(RING_LG * (1 - progressOf(next, now))); });
}
// Hero silme: iki dokunuşlu (yanlışlıkla silmeyi önler)
let heroArm = 0;
function heroDelete(id) {
  const b = document.querySelector('.hero-del');
  if (!heroArm) { b.classList.add('armed'); b.setAttribute('aria-label', 'Silmek için tekrar dokun'); haptic([8, 30, 8]); heroArm = setTimeout(() => { heroArm = 0; b.classList.remove('armed'); }, 2500); return; }
  clearTimeout(heroArm); heroArm = 0;
  const hero = document.querySelector('.hero');
  if (hero) hero.classList.add('removing');
  setTimeout(() => { $('hero').dataset.state = ''; deleteReminder(id); }, 220);
}

function render() {
  const now = Date.now();
  renderHeader();
  const up = upcomingList();
  renderHero(up[0], now);
  syncList($('list'), up.slice(1), now, false);
  syncList($('pastList'), pastList(), now, true);
  const pastEmpty = !pastList().length;
  $('clearPast').hidden = pastEmpty;
  if (pastEmpty && !$('pastList').querySelector('.empty-past')) $('pastList').innerHTML = '<div class="empty-past">Geçmiş boş. Zamanı geçen hatırlatıcılar burada görünür.</div>';
  firstRender = false; dropId = null;
}

/** Listeyi anahtar tabanlı günceller: mevcut kartları korur, giriş animasyonunu yalnızca yenilere uygular. */
function syncList(container, items, now, past) {
  const empty = container.querySelector('.empty-past'); if (empty && items.length) empty.remove();
  const want = [];
  let lastGroup = null, idx = 0;
  for (const r of items) {
    if (!past) {
      const [gk, gl] = groupOf(r, new Date(now));
      if (gk !== lastGroup) { want.push({ head: gk, label: gl }); lastGroup = gk; }
    }
    want.push({ r });
  }
  const keep = new Set();
  const nodes = [];
  for (const w of want) {
    if (w.head) {
      const key = (past ? 'p-' : 'u-') + w.head;
      let h = container.querySelector(`[data-head="${key}"]`);
      if (!h) { h = document.createElement('h3'); h.className = 'sec-h'; h.dataset.head = key; h.textContent = w.label; }
      keep.add(h); nodes.push(h);
    } else {
      const key = (past ? 'p:' : 'u:') + w.r.id;
      let el = cardEls.get(key);
      if (!el) {
        el = makeCard(w.r, past); cardEls.set(key, el);
        if (dropId === w.r.id) el.classList.add('drop');
        else if (!past || firstRender) { el.classList.add('enter'); el.style.animationDelay = (idx * 40) + 'ms'; }
        el.addEventListener('animationend', () => { el.classList.remove('enter', 'drop'); el.style.animationDelay = ''; }, { once: true });
      }
      updateCard(el, w.r, now);
      keep.add(el); nodes.push(el); idx++;
    }
  }
  // Fazlaları kaldır
  for (const child of Array.from(container.children)) if (!keep.has(child) && !child.classList.contains('empty-past')) { child.remove(); }
  for (const [k, el] of cardEls) if (!el.isConnected && k.startsWith(past ? 'p:' : 'u:')) cardEls.delete(k);
  // Sırayı uygula (yalnızca gerekirse taşı)
  nodes.forEach((n, i) => { if (container.children[i] !== n) container.insertBefore(n, container.children[i] || null); });
}

/** Her saniye: yalnızca sayaçları güncelle; bir hatırlatıcının zamanı geldiyse tam yeniden çiz. */
let lastMinuteKey = '';
function tick() {
  const now = Date.now();
  const crossed = state.reminders.some(r => r.at <= now && r.at > now - 1500);
  const mk = new Date().getMinutes();
  if (crossed || mk !== lastMinuteKey) { lastMinuteKey = mk; render(); }
  else {
    const up = upcomingList();
    if (up[0] && $('heroLeft')) { $('heroLeft').textContent = leftLong(up[0].at - now); $('heroShort').textContent = leftShort(up[0].at - now); }
  }
  checkDue();
  if (sheetState.open) updateLeft();
}

/* ═══ 6. Giriş + canlı önizleme ═══ */
const input = $('input'), ph = $('ph'), preview = $('preview'), hintEl = $('hint');
const PHRASES = ['Yarın sabah 9\'da toplantı…', '20 dakika sonra çamaşırı çıkar…', 'Cuma saat 15\'te doktor…', 'Akşam yedide annemi ara…', 'Yarım saat sonra su iç…'];
const typer = (() => {
  let i = 0, pos = 0, dir = 1, timer = 0, running = false;
  function step() {
    if (!running) return;
    if (input.value) { ph.textContent = ''; timer = setTimeout(step, 400); return; }
    const p = PHRASES[i];
    if (reduceMQ.matches) { ph.textContent = p; i = (i + 1) % PHRASES.length; timer = setTimeout(step, 3200); return; }
    if (dir > 0) {
      pos++; ph.textContent = p.slice(0, pos);
      if (pos >= p.length) { dir = -1; timer = setTimeout(step, 1700); return; }
      timer = setTimeout(step, 48 + Math.random() * 40);
    } else {
      pos--; ph.textContent = p.slice(0, pos);
      if (pos <= 0) { dir = 1; i = (i + 1) % PHRASES.length; timer = setTimeout(step, 380); return; }
      timer = setTimeout(step, 24);
    }
  }
  return {
    start() { if (running) return; running = true; step(); },
    stop() { running = false; clearTimeout(timer); }
  };
})();

let previewTimer = 0;
function updatePreview() {
  const v = input.value.trim();
  ph.hidden = !!input.value;
  syncSend();
  if (!v) { preview.classList.remove('show'); return; }
  try {
    const p = parse(v, new Date());
    const day = dayLabel(p.zaman, new Date());
    const timeTxt = (day === 'Bugün' ? '' : day + ' ') + hhmm(p.zaman);
    preview.innerHTML = `<span class="k">Anladığım:</span> <b class="num">${esc(timeTxt)}</b>${p.saatBelirtildiMi ? '' : ' <span>(saat yok)</span>'} • ${esc(p.görev)}`;
    preview.classList.add('show');
  } catch (e) { preview.classList.remove('show'); }
}
const sendBtn = $('sendBtn');
function syncSend() { sendBtn.classList.toggle('show', !!input.value.trim()); }
input.addEventListener('input', () => { ph.hidden = !!input.value; syncSend(); clearTimeout(previewTimer); previewTimer = setTimeout(updatePreview, 150); });
// Klavye kapalıyken de gönderilebilsin: önizleme satırına dokunmak da onay kartını açar
preview.addEventListener('click', () => { if (input.value.trim()) $('form').requestSubmit ? $('form').requestSubmit() : sendBtn.click(); });
$('form').addEventListener('submit', e => {
  e.preventDefault();
  const v = input.value.trim();
  if (!v) { const f = $('form'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); haptic([8, 40, 8]); return; }
  input.blur();
  openSheet(draftFrom(v));
});

function draftFrom(text) {
  const p = parse(text, new Date());
  // Önce bir çip seçilip sonra görev yazıldıysa: metinde zaman yoksa çipin zamanını kullan
  const chip = input.dataset.chip;
  delete input.dataset.chip;
  if (chip && !p.saatBelirtildiMi && p.güven < 0.65) {
    const t = parse(chip, new Date());
    return { text: p.görev, at: t.zaman.getTime(), timeSpecified: true, rolled: false, source: text + ' ' + chip };
  }
  return { text: p.görev, at: p.zaman.getTime(), timeSpecified: p.saatBelirtildiMi, rolled: p.yarinaAtildi, source: text };
}

let hintTimer = 0;
function showHint(msg, ms) {
  hintEl.textContent = msg; hintEl.classList.add('show');
  clearTimeout(hintTimer); hintTimer = setTimeout(() => hintEl.classList.remove('show'), ms || 3000);
}

// Hızlı çipler
$('chips').addEventListener('click', e => {
  const b = e.target.closest('[data-chip]'); if (!b) return;
  haptic(6);
  const chip = b.dataset.chip, v = input.value.trim();
  if (!v) { input.value = ''; input.focus(); showHint(`“${b.textContent}” seçildi. Şimdi ne hatırlatayım?`, 2600); input.dataset.chip = chip; return; }
  input.blur();
  const task = parse(v, new Date()).görev;
  const t = parse(chip, new Date());
  openSheet({ text: task, at: t.zaman.getTime(), timeSpecified: true, rolled: false, source: v + ' ' + chip });
  delete input.dataset.chip;
});
// iOS klavyesi açıldığında alt çubuğu klavyenin üstünde tut
if (window.visualViewport) {
  const vv = window.visualViewport;
  const onVV = () => {
    const off = Math.max(0, innerHeight - vv.height - vv.offsetTop);
    $('dock').style.transform = off > 40 ? `translateY(${-off + (parseFloat(getComputedStyle(html).getPropertyValue('--sab')) || 0)}px)` : '';
  };
  vv.addEventListener('resize', onVV); vv.addEventListener('scroll', onVV);
}

/* ═══ 7. Mikrofon / konuşma ═══
   İki yol, aynı arayüz:
   • Kayıt + Whisper (iPhone): sesi kendimiz kaydeder, 16 kHz WAV'a çevirip /api/transcribe'a göndeririz.
     iOS ana ekran uygulamalarında tarayıcının konuşma tanıması çalışmadığı için asıl yol budur.
   • Tarayıcı tanıması (diğerleri): webkitSpeechRecognition, konuşurken yazı canlı akar. */
const orbBtn = $('orb'), listenEl = $('listen'), bigWrap = $('bigWrap'), bigOrb = $('bigOrb');
let L = null;               // aktif dinleme oturumu
let serverAI = null;        // /api/config: sunucuda Workers AI var mı (null = henüz bilinmiyor)
const hasGUM = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

function micFallback(msg) {
  input.focus();
  showHint(msg || 'Klavyedeki 🎤 simgesine dokunarak konuşabilirsin.', msg ? 7000 : 3000);
}
// Tarayıcı tanıması bir kez hiç çalışmadıysa 3 gün boyunca o yolu denemeyiz
const K_MIC = 'anımsa.micBroken';
function micBroken() { const t = readLS(K_MIC, 0); return Number.isFinite(t) && Date.now() - t < 3 * 86400000; }
function markMicBroken() { writeLS(K_MIC, Date.now()); }
const AI_MISSING_MSG = 'Sesli tanıma kurulmamış: Cloudflare\'de Worker\'a "AI" adlı Workers AI bağlaması ekle. Şimdilik klavyedeki 🎤 ile konuşabilirsin.';

function newSession(mode) {
  return { mode, text: '', ended: false, stopped: false, stream: null, ac: null, analyser: null, proc: null, chunks: [], rate: 0,
    raf: 0, silence: 0, lastRipple: 0, level: 0, failed: false, cancelled: false, alive: false, boost: 0, watchdog: 0, doneTimer: 0,
    speechSeen: false, quietSince: 0, t0: performance.now() };
}

orbBtn.addEventListener('click', () => {
  if (L) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // iPhone'da (ya da tarayıcı tanıması yoksa) kayıt + Whisper; sunucuda AI olmadığı biliniyorsa denemeyiz
  const preferRecord = hasGUM && serverAI !== false && (isIOS || !SR || micBroken());
  if (preferRecord) { startRecord(); return; }
  if (!SR || micBroken()) { micFallback(serverAI === false && isIOS ? AI_MISSING_MSG : undefined); return; }
  startNative(SR);
});

/* ── Yol 1: Kayıt + Whisper ── */
function startRecord() {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ac;
  try { ac = new AC(); } catch (e) { micFallback(); return; }   // dokunuş anında oluştur: iOS'ta askıya alınmasın
  const S = L = newSession('record');
  S.ac = ac; S.rate = ac.sampleRate;
  openListen('Dinliyorum… bitince sus ya da ✓\'ye dokun');
  startMeter(S);
  // Önce iyileştirilmiş ayarlarla, izin dışı bir hatada en sade ayarla bir kez daha dene
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    .catch(e => (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) ? Promise.reject(e) : navigator.mediaDevices.getUserMedia({ audio: true }))
    .then(stream => {
      if (L !== S || S.stopped) { stream.getTracks().forEach(t => t.stop()); return; }
      S.stream = stream;
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      const src = ac.createMediaStreamSource(stream);
      S.analyser = ac.createAnalyser(); S.analyser.fftSize = 1024; S.analyser.smoothingTimeConstant = 0.6;
      src.connect(S.analyser);
      // Ham ses örneklerini topla (ScriptProcessor: iOS dahil her yerde çalışır; çıkışı sessizdir)
      const proc = ac.createScriptProcessor(4096, 1, 1);
      proc.onaudioprocess = e => { if (L === S && !S.stopped) S.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
      src.connect(proc); proc.connect(ac.destination);
      S.proc = proc; S.alive = true; S.t0 = performance.now();
    })
    .catch(e => { if (L === S) { S.failed = 'perm'; S.errName = (e && e.name) || 'Hata'; finishListening(); } });
}
function stopRecord(S) { S.stopped = true; finishListening(); }

/** Float32 örnekleri 16 kHz mono 16-bit WAV'a çevirir (Whisper'ın beklediği biçim). */
function toWav16k(chunks, rate) {
  let n = 0; for (const c of chunks) n += c.length;
  const all = new Float32Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  const ratio = rate / 16000, outLen = Math.floor(all.length / ratio);
  const pcm = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const a = Math.floor(i * ratio), b = Math.min(all.length, Math.floor((i + 1) * ratio));
    let sum = 0; for (let k = a; k < b; k++) sum += all[k];
    const v = clamp(sum / Math.max(1, b - a), -1, 1);
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2), dv = new DataView(buf);
  const w = (p, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(p + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 16000, true);
  dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return { blob: new Blob([buf], { type: 'audio/wav' }), seconds: outLen / 16000 };
}

/* ── Yol 2: Tarayıcı tanıması ── */
function startNative(SR) {
  let rec;
  try { rec = new SR(); } catch (e) { micFallback(); return; }
  rec.lang = 'tr-TR'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
  const S = L = newSession('native'); S.rec = rec;
  const alive = () => { if (L === S) S.alive = true; };
  rec.onstart = alive; rec.onaudiostart = alive; rec.onsoundstart = alive; rec.onspeechstart = alive;
  S.watchdog = setTimeout(() => { if (L === S && !S.text && !S.alive) { S.failed = 'dead'; try { rec.abort(); } catch (e) { /* yok */ } finishListening(); } }, 6000);
  rec.onresult = e => {
    if (L !== S) return;
    let s = '';
    for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript;
    S.text = s.trim(); S.alive = true; S.boost = 1;
    $('listenText').textContent = S.text;
    input.value = S.text; ph.hidden = !!S.text; updatePreview();
    resetSilence();
  };
  rec.onerror = e => {
    if (L !== S) return;
    const code = e && e.error;
    if (code === 'aborted') return;
    S.failed = code === 'no-speech' ? 'nospeech' : 'error';
  };
  rec.onend = () => finishListening();
  try { rec.start(); } catch (e) { L = null; micFallback(); return; }
  openListen('Dinliyorum…');
  startMeter(S);
  resetSilence();
}
function resetSilence() {
  const S = L; if (!S || S.mode !== 'native') return;
  clearTimeout(S.silence);
  S.silence = setTimeout(() => { if (L === S) try { S.rec.stop(); } catch (e) { /* yok */ } }, 8000);
}

/* ── Ortak sahne ── */
function openListen(status) {
  listenEl.setAttribute('aria-hidden', 'false');
  $('listenText').textContent = '';
  $('listenStatus').textContent = status;
  listenEl.classList.remove('processing', 'flow', 'error');
  setInert(true);
  // FLIP: küçük küreden büyüğe
  const a = orbBtn.getBoundingClientRect();
  listenEl.classList.add('open');
  const b = bigWrap.getBoundingClientRect();
  const s = a.width / b.width;
  const dx = (a.left + a.width / 2) - (b.left + b.width / 2), dy = (a.top + a.height / 2) - (b.top + b.height / 2);
  bigWrap.classList.remove('flip');
  bigWrap.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
  void bigWrap.offsetWidth;
  bigWrap.classList.add('flip');
  bigWrap.style.transform = '';
  haptic(8);
}
function closeListen() {
  listenEl.classList.remove('open');
  listenEl.setAttribute('aria-hidden', 'true');
  setTimeout(() => { listenEl.classList.remove('processing', 'flow', 'error'); bigOrb.style.removeProperty('--lvl'); }, 450);
  if (!sheetState.open && !alarmState.open) setInert(false);
}

/** Küre, halkalar ve dalga formu. Ses analizörü varsa gerçek seviye, yoksa sözcüklerle güçlenen yumuşak nabız. */
function startMeter(S) {
  const wave = $('wave'), wctx = wave.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const W = wave.clientWidth || 300, H = wave.clientHeight || 64;
  wave.width = W * dpr; wave.height = H * dpr; wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const grad = wctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(124,92,255,0)'); grad.addColorStop(0.2, '#7C5CFF'); grad.addColorStop(0.8, '#19D3FF'); grad.addColorStop(1, 'rgba(25,211,255,0)');
  let buf = null;
  const t0 = performance.now();
  const loop = t => {
    if (L !== S) return;
    S.raf = requestAnimationFrame(loop);
    let target, pts = [];
    if (S.analyser) {
      if (!buf) buf = new Uint8Array(S.analyser.fftSize);
      S.analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      target = clamp(Math.sqrt(sum / buf.length) * 4.2, 0, 1);
      const step = Math.floor(buf.length / 64);
      for (let i = 0; i < 64; i++) pts.push((buf[i * step] - 128) / 128);
      if (S.mode === 'record' && !S.stopped) {
        // Otomatik durdurma: konuşma başladıktan sonra 1,6 sn sessizlik; hiç konuşulmazsa 8 sn; en fazla 30 sn
        const el = t - S.t0;
        if (target > 0.14) { S.speechSeen = true; S.quietSince = 0; }
        else if (S.speechSeen && target < 0.08) { S.quietSince = S.quietSince || t; }
        if ((S.speechSeen && S.quietSince && t - S.quietSince > 1600) || (!S.speechSeen && el > 8000) || el > 30000) { stopRecord(S); return; }
        const secs = Math.floor(el / 1000);
        if (S.speechSeen && secs !== S.lastSecs) { S.lastSecs = secs; $('listenStatus').textContent = 'Dinliyorum… 0:' + String(secs).padStart(2, '0'); }
      }
    } else {
      const k = (t - t0) / 1000;
      S.boost *= 0.96;
      target = 0.24 + 0.14 * Math.sin(k * 2.4) + 0.06 * Math.sin(k * 6.1) + 0.45 * S.boost * (0.6 + 0.4 * Math.sin(k * 11));
      for (let i = 0; i < 64; i++) pts.push(Math.sin(i / 5 + k * 5) * 0.18 * (0.6 + 0.4 * Math.sin(k * 2.4)) * Math.sin(Math.PI * i / 63));
    }
    S.level += (target - S.level) * 0.22;
    if (!reduceMQ.matches) bigOrb.style.setProperty('--lvl', S.level.toFixed(3));
    const gap = 1100 - S.level * 800;   // ses yükseldikçe halkalar sıklaşır (en fazla 3)
    if (!reduceMQ.matches && t - S.lastRipple > gap && bigWrap.querySelectorAll('.ripple').length < 3) {
      S.lastRipple = t;
      const r = document.createElement('span'); r.className = 'ripple';
      r.addEventListener('animationend', () => r.remove(), { once: true });
      bigWrap.insertBefore(r, bigOrb);
    }
    wctx.clearRect(0, 0, W, H);
    wctx.lineWidth = 2.2; wctx.strokeStyle = grad; wctx.lineCap = 'round';
    wctx.beginPath();
    const amp = H * 0.42 * (0.35 + S.level);
    for (let i = 0; i < pts.length; i++) {
      const x = (i / (pts.length - 1)) * W, y = H / 2 + pts[i] * amp * 2.2 * Math.sin(Math.PI * i / (pts.length - 1));
      i ? wctx.lineTo(x, y) : wctx.moveTo(x, y);
    }
    wctx.stroke();
  };
  S.raf = requestAnimationFrame(loop);
}
function stopMeter(S) {
  cancelAnimationFrame(S.raf);
  clearTimeout(S.silence); clearTimeout(S.watchdog); clearTimeout(S.doneTimer);
  try { if (S.proc) { S.proc.onaudioprocess = null; S.proc.disconnect(); } } catch (e) { /* yok */ }
  try { if (S.stream) S.stream.getTracks().forEach(t => t.stop()); } catch (e) { /* yok */ }
  try { if (S.ac && S.ac.state !== 'closed') S.ac.close(); } catch (e) { /* yok */ }
  bigWrap.querySelectorAll('.ripple').forEach(r => r.remove());
}
async function failListen(status, hint) {
  listenEl.classList.add('error'); $('listenStatus').textContent = status;
  haptic([20, 60, 20]);
  await sleep(900); closeListen();
  if (hint) micFallback(hint);
}
async function toSheet(text) {
  $('listenText').textContent = text;
  listenEl.classList.add('flow');
  openSheet(draftFrom(text));
  await sleep(300);
  closeListen();
}

async function finishListening() {
  const S = L; if (!S || S.ended) return;
  S.ended = true; S.stopped = true;
  stopMeter(S);
  if (S.rec) S.rec.onresult = S.rec.onerror = S.rec.onend = S.rec.onstart = S.rec.onaudiostart = S.rec.onsoundstart = S.rec.onspeechstart = null;
  L = null;
  if (S.cancelled) { closeListen(); return; }

  if (S.mode === 'record') {
    if (S.failed === 'perm') {
      const n = S.errName;
      if (n === 'NotAllowedError' || n === 'SecurityError')
        return failListen('Mikrofon izni yok', 'iPhone mikrofona izin vermedi. Ayarlar › Safari › Mikrofon’u “Sor” ya da “İzin Ver” yap, Anımsa’yı kapatıp yeniden aç. (' + n + ')');
      if (n === 'NotReadableError' || n === 'AbortError')
        return failListen('Mikrofon meşgul', 'Mikrofon şu an başka bir uygulamada (arama, kayıt) kullanılıyor olabilir. Kapatıp tekrar dene. (' + n + ')');
      if (n === 'NotFoundError')
        return failListen('Mikrofon bulunamadı', 'Mikrofon bulunamadı. Klavyedeki 🎤 ile konuşabilirsin. (' + n + ')');
      return failListen('Mikrofon açılamadı', 'Mikrofon açılamadı. Klavyedeki 🎤 ile konuşabilirsin. (' + n + ')');
    }
    const wav = S.chunks.length ? toWav16k(S.chunks, S.rate) : null;
    if (!wav || wav.seconds < 0.5 || !S.speechSeen) {
      $('listenStatus').textContent = 'Bir şey duyamadım';
      await sleep(700); closeListen(); showHint('Bir şey duyamadım. Tekrar dene ya da yaz.', 3000); return;
    }
    $('listenStatus').textContent = 'Anlıyorum…';
    listenEl.classList.add('processing');
    let res, data = {};
    try {
      res = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav.blob });
      try { data = await res.json(); } catch (e) { /* yok */ }
    } catch (e) { listenEl.classList.remove('processing'); return failListen('İnternet yok', 'Sesli tanıma için internet gerekli. Şimdilik yazarak ekleyebilirsin.'); }
    listenEl.classList.remove('processing');
    if (res.status === 503 && data.error === 'ai_missing') { serverAI = false; return failListen('Sesli tanıma kurulmamış', AI_MISSING_MSG); }
    if (!res.ok) return failListen('Anlayamadım', 'Ses yazıya çevrilemedi. Tekrar dene ya da klavyedeki 🎤 ile konuş.');
    const text = String(data.text || '').trim();
    if (!text) { $('listenStatus').textContent = 'Bir şey duyamadım'; await sleep(700); closeListen(); showHint('Söylediğini anlayamadım. Biraz daha yakından tekrar dene.', 3200); return; }
    input.value = text; ph.hidden = true; updatePreview();
    listenEl.classList.add('processing');
    await sleep(reduceMQ.matches ? 100 : 260);
    return toSheet(text);
  }

  // Tarayıcı tanıması
  const text = S.text;
  if (!text) {
    if (S.failed === 'dead' || (S.failed === 'error' && !S.alive) || (!S.alive && !S.failed)) {
      markMicBroken();
      // Bu tarayıcıda tanıma çalışmıyor: sunucuda AI varsa bir dahaki sefere kayıt yolu kullanılır
      return failListen('Sesli tanıma burada çalışmıyor', serverAI && hasGUM ? 'Tekrar küreye dokun; bu kez sesini kaydedip yazıya çevireceğim.' : 'Bu ekranda sesli tanıma çalışmıyor. Yazı kutusuna dokunup klavyedeki 🎤 ile konuş.');
    }
    if (S.failed === 'error') return failListen('Mikrofon kullanılamadı', 'Klavyedeki 🎤 simgesine dokunarak konuşabilirsin.');
    $('listenStatus').textContent = 'Bir şey duyamadım';
    await sleep(700); closeListen(); showHint('Bir şey duyamadım. Tekrar dene ya da yaz.', 3000);
    return;
  }
  $('listenStatus').textContent = 'Anlıyorum…';
  listenEl.classList.add('processing');
  await sleep(reduceMQ.matches ? 150 : 420);
  return toSheet(text);
}
// ✓: kaydı/tanımayı bitir. Tarayıcı tanıması "bitti" yanıtı vermezse 0,9 sn sonra yine de bitir (takılmasın)
$('listenDone').addEventListener('click', () => {
  const S = L; if (!S) return;
  haptic(8);
  if (S.mode === 'record') { if (!S.speechSeen && S.chunks.length) S.speechSeen = true; stopRecord(S); return; }
  try { S.rec.stop(); } catch (e) { /* yok */ }
  clearTimeout(S.doneTimer);
  S.doneTimer = setTimeout(() => { if (L === S) finishListening(); }, 900);
});
$('listenCancel').addEventListener('click', () => {
  const S = L; if (!S) return;
  S.cancelled = true;
  if (S.rec) { try { S.rec.abort(); } catch (e) { /* yok */ } }
  finishListening(); input.value = ''; updatePreview();
});
bigWrap.addEventListener('click', () => { if (L) $('listenDone').click(); });

/* ═══ 8. Onay kartı ═══ */
const sheet = $('sheet'), scrim = $('scrim'), taskInput = $('taskInput'), timeInput = $('timeInput'), dateInput = $('dateInput');
const sheetState = { open: false, draft: null };
const odo = $('odo');
(function buildOdo() {
  const col = () => { let s = ''; for (let i = 0; i < 10; i++) s += `<span>${i}</span>`; return `<span class="d"><span class="col">${s}</span></span>`; };
  odo.innerHTML = col() + col() + '<span class="colon">:</span>' + col() + col();
})();
function setOdo(h, m, fromZero) {
  const digits = (String(h).padStart(2, '0') + String(m).padStart(2, '0')).split('').map(Number);
  const cols = odo.querySelectorAll('.col');
  cols.forEach((c, i) => {
    if (fromZero && !reduceMQ.matches) { c.style.transition = 'none'; c.style.transform = 'translateY(0)'; void c.offsetWidth; c.style.transition = ''; c.style.transitionDelay = (i * 70) + 'ms'; }
    else c.style.transitionDelay = '0ms';
    c.style.transform = `translateY(${-digits[i] * 1.07}em)`;
  });
  $('timeSr').textContent = 'Saat ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function autoGrow() { taskInput.style.height = 'auto'; taskInput.style.height = Math.min(140, taskInput.scrollHeight) + 'px'; }

function openSheet(draft) {
  sheetState.draft = Object.assign({}, draft);
  sheetState.open = true;
  const d = new Date(draft.at);
  $('sheetKicker').textContent = draft.snoozeOf ? 'Ertele' : 'Yeni hatırlatıcı';
  taskInput.value = draft.text;
  const saveBtn = $('saveBtn'); saveBtn.classList.remove('done'); saveBtn.disabled = false;
  refreshSheetTime(true);
  timeInput.value = hhmm(d);
  dateInput.value = isoDate(d);
  dateInput.min = isoDate(new Date());
  setInert(true);
  sheet.classList.remove('closing', 'dragging'); sheet.style.transform = '';
  scrim.classList.add('open');
  requestAnimationFrame(() => { sheet.classList.add('open'); autoGrow(); });
  setTimeout(() => { try { sheet.focus({ preventScroll: true }); } catch (e) { /* yok */ } }, 60);
}
function refreshSheetTime(fromZero) {
  const dr = sheetState.draft; if (!dr) return;
  const d = new Date(dr.at);
  setOdo(d.getHours(), d.getMinutes(), fromZero);
  $('dateTxt').textContent = dayLabel(d, new Date());
  const note = $('timeNote'), box = $('timeBox');
  box.classList.remove('warn', 'bad'); note.className = 'time-note'; note.hidden = true;
  if (dr.at <= Date.now()) {
    box.classList.add('bad'); note.classList.add('bad'); note.hidden = false; note.textContent = '⚠︎ Bu zaman geçmişte kaldı. Saati ya da tarihi değiştir.';
  } else if (!dr.timeSpecified) {
    box.classList.add('warn'); note.hidden = false; note.textContent = `⚠︎ Saat belirtmedin, ${hhmm(d)} koydum.`;
  } else if (dr.rolled) {
    note.classList.add('info'); note.hidden = false; note.textContent = 'Bugün için bu saat geçtiği için yarına aldım.';
  }
  $('saveBtn').disabled = dr.at <= Date.now();
  updateLeft();
}
function updateLeft() { const dr = sheetState.draft; if (dr) $('leftTxt').innerHTML = `<b>${esc(leftLong(dr.at - Date.now()))}</b>`; }

function closeSheet() {
  if (!sheetState.open) return;
  sheetState.open = false;
  sheet.classList.add('closing'); sheet.classList.remove('open'); sheet.style.transform = '';
  if (!alarmState.open) scrim.classList.remove('open');
  setTimeout(() => sheet.classList.remove('closing'), 320);
  if (!alarmState.open && !panelOpen) setInert(false);
}
taskInput.addEventListener('input', autoGrow);
taskInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); taskInput.blur(); } });
timeInput.addEventListener('change', () => {
  const dr = sheetState.draft; if (!dr || !timeInput.value) return;
  const [h, m] = timeInput.value.split(':').map(Number);
  const d = new Date(dr.at); d.setHours(h, m, 0, 0);
  dr.at = d.getTime(); dr.timeSpecified = true; dr.rolled = false;
  refreshSheetTime(false);
});
dateInput.addEventListener('change', () => {
  const dr = sheetState.draft; if (!dr || !dateInput.value) return;
  const [y, mo, da] = dateInput.value.split('-').map(Number);
  const d = new Date(dr.at); d.setFullYear(y, mo - 1, da);
  dr.at = d.getTime(); dr.rolled = false;
  refreshSheetTime(false);
});
// Masaüstü tarayıcılarda tekerlek seçiciyi doğrudan aç
[timeInput, dateInput].forEach(inp => inp.addEventListener('click', () => { try { if (!isIOS && inp.showPicker) inp.showPicker(); } catch (e) { /* yok */ } }));
$('cancelBtn').addEventListener('click', () => { closeSheet(); });
scrim.addEventListener('click', () => { if (alarmState.open) return; closeSheet(); });
attachDragClose(sheet, () => closeSheet());

function attachDragClose(el, onClose) {
  let y0 = 0, t0 = 0, dy = 0, active = false, id = null;
  el.addEventListener('pointerdown', e => {
    if (e.target.closest('textarea, input, button, .pick-input, label')) return;
    if (el.scrollTop > 0) return;
    active = true; y0 = e.clientY; t0 = performance.now(); dy = 0; id = e.pointerId;
  });
  el.addEventListener('pointermove', e => {
    if (!active || e.pointerId !== id) return;
    dy = Math.max(0, e.clientY - y0);
    if (dy > 4) { el.classList.add('dragging'); try { el.setPointerCapture(id); } catch (x) { /* yok */ } el.style.transform = `translateY(${dy}px)`; }
  });
  const end = e => {
    if (!active || (e && e.pointerId !== id)) return;
    active = false; el.classList.remove('dragging');
    const v = dy / Math.max(1, performance.now() - t0);
    if (dy > 110 || (v > 0.6 && dy > 30)) onClose();
    else el.style.transform = '';
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}

/* Kaydet */
$('saveBtn').addEventListener('click', async () => {
  const dr = sheetState.draft; if (!dr) return;
  const text = (taskInput.value.trim() || 'Hatırlatıcı').slice(0, 200);
  if (dr.at <= Date.now()) { refreshSheetTime(false); haptic([20, 60, 20]); toast('Bu zaman geçmişte kaldı.', 'err'); return; }
  const btn = $('saveBtn');
  btn.disabled = true;
  let r;
  if (dr.snoozeOf) {
    r = state.reminders.find(x => x.id === dr.snoozeOf);
  }
  if (r) { r.text = text; r.snoozedFrom = r.snoozedFrom || r.at; r.at = dr.at; r.createdAt = Date.now(); r.done = false; r.synced = false; }
  else { r = { id: uuid(), text, at: dr.at, createdAt: Date.now(), synced: false, done: false }; state.reminders.push(r); }
  save();
  btn.classList.add('done', 'shine');
  haptic(12);
  const rect = btn.getBoundingClientRect();
  confetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
  input.value = ''; ph.hidden = false; preview.classList.remove('show');
  await sleep(reduceMQ.matches ? 300 : 620);
  closeSheet();
  setTab('up');
  dropId = r.id;
  setTimeout(() => { render(); btn.classList.remove('shine'); }, 180);
  syncOne(r);
  if (!state.uid) maybeNagNotifications();
});

/* ═══ 9. Konfeti ═══ */
function confetti(x, y, count) {
  if (reduceMQ.matches) return;
  let cv = $('fx');
  if (!cv) { cv = document.createElement('canvas'); cv.id = 'fx'; cv.setAttribute('aria-hidden', 'true'); document.body.appendChild(cv); }
  const dpr = Math.min(devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const colors = ['#7C5CFF', '#19D3FF', '#FF5CAA', '#3DFFB0', '#FFC857', '#F5F7FF'];
  const ps = [];
  for (let i = 0; i < (count || 60); i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3, sp = 4 + Math.random() * 7;
    ps.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s: 3 + Math.random() * 4, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: colors[i % colors.length], round: Math.random() < 0.4 });
  }
  const t0 = performance.now();
  let raf = 0;
  const frame = t => {
    const k = (t - t0) / 900;
    c.clearRect(0, 0, W, H);
    if (k >= 1) { cancelAnimationFrame(raf); cv.remove(); return; }
    for (const p of ps) {
      p.vy += 0.32; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      c.globalAlpha = 1 - k * k;
      c.fillStyle = p.c;
      c.save(); c.translate(p.x, p.y); c.rotate(p.r);
      if (p.round) { c.beginPath(); c.arc(0, 0, p.s / 2, 0, Math.PI * 2); c.fill(); } else c.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      c.restore();
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}

/* ═══ 10. Kaydırarak silme ═══ */
let openSwipe = null;
function attachSwipe(wrap) {
  const card = wrap.querySelector('.card'), bg = wrap.querySelector('.del-bg');
  let x0 = 0, y0 = 0, t0 = 0, dx = 0, base = 0, mode = null, id = null;
  const setX = (x, anim) => {
    card.classList.toggle('dragging', !anim);
    card.style.transform = x ? `translateX(${x}px)` : '';
    bg.style.opacity = String(clamp(-x / 90, 0, 1));
  };
  card.addEventListener('pointerdown', e => {
    if (openSwipe && openSwipe !== wrap) openSwipe._close();
    x0 = e.clientX; y0 = e.clientY; t0 = performance.now(); dx = 0; mode = null; id = e.pointerId;
    base = wrap._open ? -92 : 0;
  });
  card.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (!mode) {
      if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my) * 1.2) { mode = 'swipe'; try { card.setPointerCapture(id); } catch (x) { /* yok */ } }
      else if (Math.abs(my) > 8) { mode = 'scroll'; }
    }
    if (mode !== 'swipe') return;
    const raw = base + mx;              // ham mesafe (silme kararı bununla verilir)
    let x = raw;
    if (x > 0) x = x * 0.2;             // sağa doğru direnç
    if (x < -240) x = -240 + (x + 240) * 0.5;
    dx = raw; setX(x, false);
  });
  const end = e => {
    if (e.pointerId !== id) return;
    id = null;
    if (mode !== 'swipe') { mode = null; return; }
    mode = null;
    const v = (dx - base) / Math.max(1, performance.now() - t0);
    if (dx < -200 || (v < -0.9 && dx < -60)) { setX(-innerWidth, true); deleteReminder(wrap.dataset.id); return; }
    if (dx < -60) { wrap._open = true; openSwipe = wrap; setX(-92, true); haptic(6); }
    else wrap._close();
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
  wrap._close = () => { wrap._open = false; if (openSwipe === wrap) openSwipe = null; setX(0, true); };
  wrap.querySelector('.del-btn').addEventListener('click', () => deleteReminder(wrap.dataset.id));
  // Kartın kendisine dokununca açık silme alanını kapat
  card.addEventListener('click', () => { if (wrap._open) wrap._close(); });
}
document.addEventListener('pointerdown', e => { if (openSwipe && !openSwipe.contains(e.target)) openSwipe._close(); }, true);

/** Kartı küçültüp soldurur, alttakileri FLIP ile yukarı kaydırır. */
async function deleteReminder(id) {
  const r = state.reminders.find(x => x.id === id);
  if (!r) return;
  haptic(14);
  const els = Array.from(document.querySelectorAll(`.card-wrap[data-id="${CSS.escape(id)}"]`));
  for (const el of els) {
    const parent = el.parentElement;
    const sibs = parent ? Array.from(parent.children).filter(c => c !== el) : [];
    const before = new Map(sibs.map(s => [s, s.getBoundingClientRect().top]));
    el.classList.add('removing');
    await sleep(reduceMQ.matches ? 120 : 230);
    el.remove();
    if (!reduceMQ.matches) {
      for (const s of sibs) {
        const d = before.get(s) - s.getBoundingClientRect().top;
        if (!d) continue;
        s.style.transition = 'none'; s.style.transform = `translateY(${d}px)`;
        void s.offsetWidth;
        s.style.transition = 'transform 380ms cubic-bezier(0.22, 1, 0.36, 1)'; s.style.transform = '';
        s.addEventListener('transitionend', () => { s.style.transition = ''; }, { once: true });
      }
    }
  }
  for (const k of Array.from(cardEls.keys())) if (k.endsWith(':' + id)) cardEls.delete(k);
  state.reminders = state.reminders.filter(x => x.id !== id);
  save();
  setTimeout(render, 400);
  syncDelete(id);
}

/* ═══ 11. Alarm / erteleme ═══ */
const alarmEl = $('alarm');
const alarmState = { open: false, id: null };
const alerted = new Set();
function checkDue(forceId) {
  if (alarmState.open || sheetState.open || L) return;
  const now = Date.now();
  let r = null;
  if (forceId) r = state.reminders.find(x => x.id === forceId && !x.done);
  if (!r) r = state.reminders.filter(x => !x.done && x.at <= now && now - x.at < 12 * 3600000 && !alerted.has(x.id)).sort((a, b) => b.at - a.at)[0];
  if (!r) return;
  alerted.add(r.id);
  openAlarm(r);
}
function openAlarm(r) {
  alarmState.open = true; alarmState.id = r.id;
  $('alarmTask').textContent = r.text;
  $('alarmTime').textContent = whenText(r);
  setInert(true);
  scrim.classList.add('open');
  requestAnimationFrame(() => alarmEl.classList.add('open'));
  haptic([30, 80, 30, 80, 30]);
  setTimeout(() => { try { alarmEl.focus({ preventScroll: true }); } catch (e) { /* yok */ } }, 60);
}
/** Ana ekran simgesindeki sayı: bakılmamış (Tamam/Ertele denmemiş) zamanı gelmiş hatırlatıcılar */
async function refreshBadge(closeId) {
  const now = Date.now();
  const n = state.reminders.filter(x => !x.done && x.at <= now && now - x.at < 12 * 3600000).length;
  try { if (n && navigator.setAppBadge) await navigator.setAppBadge(n); else if (navigator.clearAppBadge) await navigator.clearAppBadge(); } catch (e) { /* desteklenmiyor */ }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg && reg.getNotifications) {
      const list = await reg.getNotifications();
      list.forEach(nt => { if (!n || (closeId && nt.tag === 'animsa-' + closeId) || nt.tag === 'animsa-test') nt.close(); });
    }
  } catch (e) { /* yok */ }
}
function closeAlarm() {
  alarmState.open = false;
  alarmEl.classList.add('closing'); alarmEl.classList.remove('open'); alarmEl.style.transform = '';
  setTimeout(() => alarmEl.classList.remove('closing'), 320);
  if (!sheetState.open) { scrim.classList.remove('open'); if (!panelOpen) setInert(false); }
  refreshBadge(alarmState.id);
  setTimeout(() => checkDue(), 600);
}
function snooze(ms) {
  const r = state.reminders.find(x => x.id === alarmState.id);
  if (r) {
    r.snoozedFrom = r.snoozedFrom || r.at;
    r.at = Date.now() + ms; r.createdAt = Date.now(); r.done = false; r.synced = false;
    alerted.delete(r.id);
    save(); dropId = r.id; render(); syncOne(r);
    toast(ms >= 3600000 ? '1 saat sonra tekrar hatırlatacağım.' : '10 dakika sonra tekrar hatırlatacağım.', 'ok');
  }
  closeAlarm();
}
$('snooze10').addEventListener('click', () => snooze(10 * 60000));
$('snooze60').addEventListener('click', () => snooze(60 * 60000));
$('alarmOk').addEventListener('click', () => {
  const r = state.reminders.find(x => x.id === alarmState.id);
  if (r) { r.done = true; save(); render(); }
  closeAlarm();
});
attachDragClose(alarmEl, () => $('alarmOk').click());

/* ═══ 12. Ayarlar ═══ */
const panel = $('panel');
let panelOpen = false;
function openPanel() { panelOpen = true; setInert(true); panel.classList.add('open'); scrim.classList.add('open'); refreshNotifUI(); setTimeout(() => { try { panel.focus({ preventScroll: true }); } catch (e) { /* yok */ } }, 50); }
function closePanel() { panelOpen = false; panel.classList.remove('open'); if (!sheetState.open && !alarmState.open) { scrim.classList.remove('open'); setInert(false); } disarmWipe(); }
$('settingsBtn').addEventListener('click', openPanel);
$('panelClose').addEventListener('click', closePanel);
scrim.addEventListener('click', () => { if (panelOpen) closePanel(); });
$('ver').textContent = VERSION;

function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
function notifStatus() {
  if (isIOS && !isStandalone()) return 'install';   // iOS: Web Push yalnızca ana ekrandan açılınca
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'granted' && state.uid) return 'on';
  if (Notification.permission === 'granted') return 'need';
  return 'off';
}
function refreshNotifUI() {
  const s = notifStatus();
  const badge = $('notifBadge'), desc = $('notifDesc');
  const M = {
    on: ['on', 'Açık', 'Zamanı gelince kilit ekranına bildirim gelir.'],
    off: ['off', 'Kapalı', 'Uygulama kapalıyken uyarı alamazsın.'],
    need: ['need', 'İzin gerekli', 'Abonelik tamamlanmadı. “Aç”a dokun.'],
    denied: ['bad', 'Kapalı', 'İzin reddedildi. iPhone Ayarlar › Bildirimler › Anımsa › Bildirimlere İzin Ver.'],
    install: ['need', 'İzin gerekli', 'Önce Safari’de Paylaş › Ana Ekrana Ekle ile kur, sonra ana ekrandan aç.'],
    unsupported: ['bad', 'Desteklenmiyor', 'Bu tarayıcı Web Push desteklemiyor (iOS 16.4+ gerekir).']
  }[s];
  badge.className = 'badge ' + M[0]; badge.textContent = M[1]; desc.textContent = M[2];
  $('enableRow').hidden = s === 'on' || s === 'unsupported';
  $('enableBtn').disabled = s === 'denied';
  $('testBtn').disabled = s !== 'on';
  $('soundOn').setAttribute('aria-pressed', String(!state.settings.silent));
  $('soundOff').setAttribute('aria-pressed', String(state.settings.silent));
}
$('enableBtn').addEventListener('click', async () => {
  if (notifStatus() === 'install') { closePanel(); showOnboarding(1); return; }
  const res = await enableNotifications();
  refreshNotifUI();
  if (res === 'granted') toast('Bildirimler açıldı.', 'ok');
});
$('testBtn').addEventListener('click', async () => {
  const b = $('testBtn'); b.disabled = true;
  try {
    await api('/api/test', { uid: state.uid });
    toast('Test bildirimi gönderildi. Birkaç saniye içinde gelmeli.', 'ok');
  } catch (e) {
    if (e.status === 410 || e.status === 404) { state.uid = null; save(); toast('Abonelik yenilenmeli. “Bildirimleri aç”a dokun.', 'err'); }
    else toast(e.offline ? 'İnternet bağlantısı yok.' : 'Test bildirimi gönderilemedi. Biraz sonra tekrar dene.', 'err');
  }
  refreshNotifUI();
  b.disabled = notifStatus() !== 'on';
});
function setSilent(v) {
  state.settings.silent = v; state.settings.lastSubAt = 0; save(); refreshNotifUI(); haptic(6);
  if (state.uid) ensureSubscription(false).catch(() => {});
}
$('soundOn').addEventListener('click', () => setSilent(false));
$('soundOff').addEventListener('click', () => setSilent(true));

let wipeArmed = 0;
function disarmWipe() { clearTimeout(wipeArmed); wipeArmed = 0; const b = $('wipeBtn'); b.classList.remove('armed'); b.textContent = 'Sil'; }
$('wipeBtn').addEventListener('click', async () => {
  const b = $('wipeBtn');
  if (!wipeArmed) { b.classList.add('armed'); b.textContent = 'Emin misin?'; haptic([10, 40, 10]); wipeArmed = setTimeout(disarmWipe, 4000); return; }
  disarmWipe(); b.disabled = true;
  try { if (state.uid) await api('/api/delete', { uid: state.uid, all: true }); } catch (e) { /* sunucuya ulaşılamasa da yerelde sil */ }
  try { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) { /* yok */ }
  try { [K_REM, K_UID, K_SET].forEach(k => localStorage.removeItem(k)); } catch (e) { /* yok */ }
  toast('Tüm veriler silindi.', 'ok');
  setTimeout(() => location.reload(), 900);
});

/* ═══ 13. Tanıtım ═══ */
const onb = $('onb'), track = $('onbTrack');
let onbStep = 0, onbDemoTimer = 0, guideTimer = 0, onbDone = false;
function onbSteps() { return isStandalone() ? [0, 2] : [0, 1, 2]; }
function showOnboarding(startAt) {
  onb.hidden = false; onb.classList.remove('hide');
  document.body.classList.add('onboarding');   // ana ekranı gizle, yalnızca canlı arka plan görünsün
  setInert(true, onb);
  const steps = onbSteps();
  if (!isStandalone()) Array.from(track.children).forEach(s => s.hidden = false);
  else track.children[1].hidden = true;
  goStep(Math.max(0, steps.indexOf(startAt || 0)));
  runDemo();
}
function goStep(i) {
  const steps = onbSteps();
  onbStep = clamp(i, 0, steps.length - 1);
  const visibleIndex = onbStep;
  track.style.transform = `translateX(${-visibleIndex * 100}%)`;
  const dots = $('dots').children;
  for (let k = 0; k < dots.length; k++) { dots[k].hidden = k >= steps.length; dots[k].classList.toggle('on', k === onbStep); }
  const cur = steps[onbStep];
  const lbl = $('onbNext').querySelector('.lbl');
  clearInterval(guideTimer);
  if (cur === 0) lbl.textContent = 'Devam';
  if (cur === 1) { lbl.textContent = 'Ekledim, devam'; animateGuide(); }
  if (cur === 2) { lbl.textContent = onbDone ? 'Başla' : 'Bildirimleri aç'; prepPerm(); }
  $('onbSkip').textContent = cur === 2 && !onbDone ? 'Şimdilik geç' : 'Atla';
  $('onbSkip').hidden = onbDone;
}
function animateGuide() {
  const steps = $('guide').children; let k = 0;
  const tickG = () => { for (let j = 0; j < steps.length; j++) steps[j].classList.toggle('on', j === k); k = (k + 1) % steps.length; };
  tickG(); guideTimer = setInterval(tickG, 1700);
}
function runDemo() {
  const q = $('demoQ'), a = $('demoA');
  const samples = ['Yarın sabah 9\'da toplantı', 'Akşam yedide annemi ara', '20 dk sonra çamaşırı çıkar'];
  let si = 0;
  const play = async () => {
    if (onb.hidden) return;
    const s = samples[si++ % samples.length];
    a.style.opacity = '0';
    for (let i = 0; i <= s.length; i++) { if (onb.hidden) return; q.textContent = s.slice(0, i); await sleep(reduceMQ.matches ? 0 : 45); }
    const p = parse(s, new Date());
    a.textContent = '✓ ' + dayLabel(p.zaman, new Date()) + ' ' + hhmm(p.zaman) + ' • ' + p.görev;
    a.style.opacity = '1';
    onbDemoTimer = setTimeout(play, 2400);
  };
  clearTimeout(onbDemoTimer); play();
}
function prepPerm() {
  const msg = $('permMsg');
  const s = notifStatus();
  if (onbDone) return;
  if (s === 'install') msg.innerHTML = 'Bildirimler yalnızca <b>ana ekrandan açılan</b> uygulamada çalışır. Önce önceki adımdaki gibi ana ekrana ekle.';
  else if (s === 'unsupported') msg.innerHTML = 'Bu tarayıcı bildirim desteklemiyor. iPhone’da <b>iOS 16.4 veya üstü</b> gerekir.';
  else if (s === 'denied') msg.innerHTML = deniedText();
  else msg.textContent = '';
}
function deniedText() { return 'İzin kapalı. Açmak için: iPhone <b>Ayarlar › Bildirimler › Anımsa</b> › <b>Bildirimlere İzin Ver</b>. Sonra uygulamaya geri dön.'; }
function finishOnboarding() {
  state.settings.onboarded = true; save();
  clearTimeout(onbDemoTimer); clearInterval(guideTimer);
  onb.classList.add('hide');
  document.body.classList.remove('onboarding');  // ana ekran tanıtım solarken belirir (çapraz geçiş)
  setTimeout(() => { onb.hidden = true; setInert(false); }, 500);
}
$('onbNext').addEventListener('click', async () => {
  const steps = onbSteps(), cur = steps[onbStep];
  haptic(6);
  if (cur !== 2) { goStep(onbStep + 1); return; }
  if (onbDone) { finishOnboarding(); return; }
  const s = notifStatus();
  if (s === 'install' || s === 'unsupported') { finishOnboarding(); return; }
  if (s === 'denied') { $('permMsg').innerHTML = deniedText(); return; }
  const res = await enableNotifications();
  if (res === 'granted') {
    onbDone = true;
    $('permTitle').innerHTML = '<span class="g">Hazırsın</span> 🎉';
    $('permSub').textContent = 'Zamanı gelince sana haber vereceğim.';
    $('permMsg').textContent = '';
    const r = $('onbNext').getBoundingClientRect();
    confetti(r.left + r.width / 2, r.top, 90);
    haptic([12, 50, 12]);
    goStep(onbStep);
  } else if (res === 'denied') { $('permMsg').innerHTML = deniedText(); }
  else if (res === 'error') { $('permMsg').textContent = 'Bağlantı kurulamadı. İnterneti kontrol edip tekrar dene.'; }
});
$('onbSkip').addEventListener('click', () => finishOnboarding());
// Tanıtımda kaydırma
(function () {
  let x0 = 0, dx = 0, on = false, id = null;
  track.addEventListener('pointerdown', e => { on = true; x0 = e.clientX; dx = 0; id = e.pointerId; });
  track.addEventListener('pointermove', e => {
    if (!on || e.pointerId !== id) return;
    dx = e.clientX - x0;
    if (Math.abs(dx) > 6) { track.classList.add('dragging'); track.style.transform = `translateX(calc(${-onbStep * 100}% + ${dx * 0.9}px))`; }
  });
  const end = () => { if (!on) return; on = false; track.classList.remove('dragging'); if (dx < -60) goStep(onbStep + 1); else if (dx > 60) goStep(onbStep - 1); else goStep(onbStep); };
  track.addEventListener('pointerup', end); track.addEventListener('pointercancel', end);
})();

/* Modal açıkken arka planı erişilebilirlik ağacından çıkar */
function setInert(on, except) {
  const app = $('app');
  try { app.inert = !!on; } catch (e) { /* eski tarayıcı */ }
  app.setAttribute('aria-hidden', on ? 'true' : 'false');
  if (except) except.inert = false;
}

/* ═══ 14. Bildirim + senkronizasyon ═══ */
async function api(path, body) {
  let res;
  try {
    res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { method: 'GET' });
  } catch (e) { const er = new Error('offline'); er.offline = true; throw er; }
  let data = {};
  try { data = await res.json(); } catch (e) { /* JSON değil */ }
  if (!res.ok) { const er = new Error(data.message || 'Sunucu hatası'); er.status = res.status; er.code = data.error; throw er; }
  return data;
}
async function sha256Hex(s) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return Array.from(h, b => b.toString(16).padStart(2, '0')).join('');
}
function b64uToBytes(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}
function sameKey(buf, b64) {
  if (!buf) return true;
  const a = new Uint8Array(buf), b = b64uToBytes(b64);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Kullanıcı dokunuşuyla çağrılır (iOS: izin isteği doğrudan dokunuştan gelmeli). */
async function enableNotifications() {
  if (!pushSupported()) { toast(isIOS && !isStandalone() ? 'Önce uygulamayı ana ekrana ekle.' : 'Bu tarayıcı bildirim desteklemiyor.', 'err'); return 'unsupported'; }
  let perm;
  try { perm = await Notification.requestPermission(); } catch (e) { perm = Notification.permission; }
  if (perm !== 'granted') { refreshNotifUI(); return perm === 'denied' ? 'denied' : 'default'; }
  try {
    await ensureSubscription(true);
    await fullSync(true);
    return 'granted';
  } catch (e) {
    toast(e.offline ? 'İnternet bağlantısı yok. Tekrar dene.' : 'Bildirim aboneliği kurulamadı. Tekrar dene.', 'err');
    return 'error';
  }
}
/** Her açılışta aboneliği doğrular, değiştiyse sunucuya bildirir. */
async function ensureSubscription(force) {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  const cfg = await api('/api/config');
  serverAI = !!cfg.ai;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options && sub.options.applicationServerKey, cfg.publicKey)) { try { await sub.unsubscribe(); } catch (e) { /* yok */ } sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(cfg.publicKey) });
  const json = sub.toJSON();
  const uid = await sha256Hex(json.endpoint);
  const changed = uid !== state.uid;
  if (force || changed || Date.now() - state.settings.lastSubAt > 86400000) {
    await api('/api/subscribe', { uid, sub: json, oldUid: changed && state.uid ? state.uid : undefined, silent: state.settings.silent, tz: userTz() });
    state.uid = uid; state.settings.lastSubAt = Date.now(); save();
    if (changed) state.reminders.forEach(r => { r.synced = false; });
  }
  return true;
}
function userTz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch (e) { return undefined; } }
async function syncOne(r) {
  if (!state.uid) return;
  try {
    await api('/api/reminders', { uid: state.uid, id: r.id, text: r.text, at: r.at, snoozed: !!r.snoozedFrom });
    r.synced = true; save(); render();
  } catch (e) {
    if (e.status === 404) { state.settings.lastSubAt = 0; ensureSubscription(true).then(() => fullSync(true)).catch(() => {}); }
    else if (!e.offline) toast('Sunucuya kaydedilemedi; internet gelince tekrar denenecek.', 'err');
    render();
  }
}
async function syncDelete(id) {
  if (!state.uid) return;
  try { await api('/api/delete', { uid: state.uid, id }); }
  catch (e) { state.settings.pendingDeletes.push(id); save(); }
}
let syncing = false;
async function fullSync(force) {
  if (!state.uid || syncing || !navigator.onLine) return;
  const now = Date.now();
  const dirty = state.reminders.some(r => !r.synced && r.at > now) || state.settings.pendingDeletes.length;
  if (!dirty && !force) return;
  syncing = true;
  try {
    const list = state.reminders.filter(r => r.at > now).map(r => ({ id: r.id, text: r.text, at: r.at, snoozed: !!r.snoozedFrom }));
    await api('/api/sync', { uid: state.uid, reminders: list });
    state.reminders.forEach(r => { if (r.at > now) r.synced = true; });
    state.settings.pendingDeletes = [];
    save(); render();
  } catch (e) {
    if (e.status === 404) { state.settings.lastSubAt = 0; save(); }
  } finally { syncing = false; }
}
let nagged = false;
function maybeNagNotifications() {
  if (nagged) return; nagged = true;
  const s = notifStatus();
  if (s === 'on') return;
  setTimeout(() => toast(s === 'install' ? 'Kaydedildi. Kilit ekranı bildirimi için uygulamayı ana ekrana ekle.' : 'Kaydedildi. Uygulama kapalıyken uyarı için bildirimleri aç.', ''), 900);
}
addEventListener('online', () => fullSync(false));

/* ═══ 15. Başlatma ═══ */
function setTab(t) {
  state.tab = t;
  $('seg').dataset.tab = t;
  $('tabUp').setAttribute('aria-selected', String(t === 'up'));
  $('tabPast').setAttribute('aria-selected', String(t === 'past'));
  $('panelUp').hidden = t !== 'up';
  $('panelPast').hidden = t !== 'past';
}
$('seg').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b && b.dataset.tab !== state.tab) { haptic(4); setTab(b.dataset.tab); $('scroller').scrollTop = 0; } });
$('clearPast').addEventListener('click', () => {
  const n = Date.now();
  state.reminders = state.reminders.filter(r => r.at > n);
  for (const k of Array.from(cardEls.keys())) if (k.startsWith('p:')) cardEls.delete(k);
  $('pastList').innerHTML = '';
  save(); render(); toast('Geçmiş temizlendi.', 'ok');
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (L) $('listenCancel').click(); else if (sheetState.open) closeSheet(); else if (panelOpen) closePanel();
});

function init() {
  loadState();
  if (reduceMQ.matches) document.body.classList.add('rm');
  stars.init();
  render();
  typer.start();
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { typer.stop(); return; }
    typer.start(); render(); checkDue(); refreshBadge();
    ensureSubscription(false).then(() => fullSync(true)).catch(() => {});
  });

  // Service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    navigator.serviceWorker.addEventListener('message', e => {
      const d = e.data || {};
      if (d.type === 'push' || d.type === 'open') { render(); setTimeout(() => checkDue(d.id), 200); }
    });
  }

  // Bildirimden açıldıysa (?r=<id>) erteleme seçeneklerini göster
  const params = new URLSearchParams(location.search);
  const rid = params.get('r');
  if (rid) { try { history.replaceState(null, '', '/'); } catch (e) { /* yok */ } }

  if (!state.settings.onboarded) showOnboarding(0);
  else setTimeout(() => checkDue(rid), 400);

  ensureSubscription(false).then(() => fullSync(true)).catch(() => {});
  api('/api/config').then(c => { serverAI = !!c.ai; }).catch(() => {});
  refreshBadge();
}

init();
// Test kancası (yalnızca otomatik testler için)
window.__animsa = { get mic() { return L ? { mode: L.mode, analyser: !!L.analyser, chunks: L.chunks.length, rate: L.rate } : null; }, state, render, openSheet, draftFrom, openAlarm, setTab, toast, openPanel, finishOnboarding, showOnboarding, confetti };
})();
