/* ════════════════════════════════════════════════════════════════
   ANIMSA — Sunucu (Cloudflare Worker)
   • Uygulamayı sunar (HTML, manifest, service worker, ikonlar)
   • JSON API: /api/config, /api/subscribe, /api/reminders, /api/delete, /api/sync, /api/test
   • Cron (her dakika): zamanı gelen hatırlatıcılar için Web Push gönderir
   KV anahtarları:
     vapid        → { publicKey, privateJwk, subject }
     sub:<uid>    → { sub, silent, updatedAt }
     pending      → [{ uid, id, text, at, tries }]  (cron yalnızca bunu okur)
   ════════════════════════════════════════════════════════════════ */
import { generateVapidKeys, sendPush, cleanSubscription, sha256Hex } from './push.js';

const MAX_PENDING = 1000;          // KV değerini makul boyutta tut
const MAX_PER_UID = 300;
const MAX_TRIES = 5;
const MAX_SENDS_PER_RUN = 40;      // ücretsiz plan: çağrı başına 50 alt istek
const EARLY_MS = 15000;            // cron dakika başında çalışır; 15 sn erken gönderim payı
const UID_RE = /^[a-f0-9]{64}$/;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY'
};
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob: mediastream:; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC_HEADERS, ...extra }
  });
}
const err = (status, code, message) => json({ ok: false, error: code, message }, status);

class HttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

async function readJson(request) {
  const ct = request.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new HttpError(415, 'unsupported_media_type', 'İstek gövdesi JSON olmalı.');
  const text = await request.text();
  if (text.length > 65536) throw new HttpError(413, 'too_large', 'İstek çok büyük.');
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch { throw new HttpError(400, 'bad_json', 'Geçersiz JSON.'); }
}

function needUid(uid) { if (typeof uid !== 'string' || !UID_RE.test(uid)) throw new HttpError(400, 'bad_uid', 'Geçersiz kullanıcı kimliği.'); return uid; }
function needId(id) { if (typeof id !== 'string' || !ID_RE.test(id)) throw new HttpError(400, 'bad_id', 'Geçersiz hatırlatıcı kimliği.'); return id; }
function needText(t) {
  if (typeof t !== 'string') throw new HttpError(400, 'bad_text', 'Metin eksik.');
  const s = t.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300);
  if (!s) throw new HttpError(400, 'bad_text', 'Metin boş olamaz.');
  return s;
}
function needAt(at, now) {
  if (typeof at !== 'number' || !Number.isFinite(at) || !Number.isInteger(at)) throw new HttpError(400, 'bad_at', 'Geçersiz zaman.');
  if (at < now - 10 * 60000) throw new HttpError(400, 'at_in_past', 'Bu zaman geçmişte kaldı.');
  if (at > now + 3 * 365 * 86400000) throw new HttpError(400, 'at_too_far', 'Zaman çok ileride.');
  return at;
}

/* ── KV yardımcıları ── */
async function readPending(env) {
  try {
    const v = await env.KV.get('pending', 'json');
    return Array.isArray(v) ? v.filter(r => r && typeof r.uid === 'string' && typeof r.id === 'string' && typeof r.at === 'number') : [];
  } catch { return []; }
}
async function writePending(env, list) {
  list.sort((a, b) => a.at - b.at);
  await env.KV.put('pending', JSON.stringify(list));
}
async function getSub(env, uid) {
  try { const v = await env.KV.get('sub:' + uid, 'json'); return v && v.sub ? v : null; } catch { return null; }
}

const vapidCache = new WeakMap(); // izolat içi önbellek, KV bağlaması başına (KV okumasını azaltır)
async function getVapid(env, origin) {
  let v = vapidCache.get(env.KV);
  if (!v) {
    v = await env.KV.get('vapid', 'json');
    if (!v || !v.publicKey || !v.privateJwk) {
      // İlk çalışma: anahtar çiftini üret ve sakla
      v = await generateVapidKeys();
      v.createdAt = Date.now();
      await env.KV.put('vapid', JSON.stringify(v));
      const again = await env.KV.get('vapid', 'json'); // eşzamanlı ilk istekler aynı anahtarda buluşsun
      if (again && again.publicKey) v = again;
    }
  }
  if (origin && v.subject !== origin && /^https:\/\//.test(origin)) {
    v = { ...v, subject: origin };
    await env.KV.put('vapid', JSON.stringify(v));
  }
  vapidCache.set(env.KV, v);
  return v;
}
function vapidFor(env, v) {
  return { publicKey: v.publicKey, privateJwk: v.privateJwk, subject: env.VAPID_SUBJECT || v.subject || 'mailto:animsa@localhost' };
}

function payloadFor(r, silent) {
  return { title: '⏰ Hatırlatıcı', body: r.text, id: r.id, at: r.at, url: '/?r=' + encodeURIComponent(r.id), silent: !!silent };
}

/* ── API ── */
async function handleApi(request, env, url, deps) {
  const path = url.pathname;
  const now = deps.now();
  if (path === '/api/config') {
    if (request.method !== 'GET') return err(405, 'method_not_allowed', 'Yalnızca GET.');
    const v = await getVapid(env, url.origin);
    return json({ ok: true, publicKey: v.publicKey });
  }
  const routes = ['/api/subscribe', '/api/reminders', '/api/delete', '/api/sync', '/api/test'];
  if (!routes.includes(path)) return err(404, 'not_found', 'Böyle bir uç nokta yok.');
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed', message: 'Yalnızca POST.' }, 405, { Allow: 'POST' });
  const body = await readJson(request);

  if (path === '/api/subscribe') {
    const uid = needUid(body.uid);
    const sub = cleanSubscription(body.sub);
    if (!sub) throw new HttpError(400, 'bad_subscription', 'Geçersiz bildirim aboneliği.');
    if ((await sha256Hex(sub.endpoint)) !== uid) throw new HttpError(400, 'uid_mismatch', 'Kimlik abonelikle eşleşmiyor.');
    await env.KV.put('sub:' + uid, JSON.stringify({ sub, silent: body.silent === true, updatedAt: now }));
    // Abonelik yenilendiyse eski kimliğin bekleyenlerini yeni kimliğe taşı
    if (typeof body.oldUid === 'string' && UID_RE.test(body.oldUid) && body.oldUid !== uid) {
      await env.KV.delete('sub:' + body.oldUid);
      const list = await readPending(env);
      if (list.some(r => r.uid === body.oldUid)) {
        list.forEach(r => { if (r.uid === body.oldUid) r.uid = uid; });
        await writePending(env, list);
      }
    }
    return json({ ok: true });
  }

  const uid = needUid(body.uid);

  if (path === '/api/reminders') {
    const id = needId(body.id);
    const text = needText(body.text);
    const at = needAt(body.at, now);
    if (!(await getSub(env, uid))) throw new HttpError(404, 'not_subscribed', 'Bildirim aboneliği bulunamadı.');
    const list = (await readPending(env)).filter(r => !(r.uid === uid && r.id === id));
    if (list.length >= MAX_PENDING || list.filter(r => r.uid === uid).length >= MAX_PER_UID) throw new HttpError(429, 'too_many', 'Çok fazla bekleyen hatırlatıcı var.');
    list.push({ uid, id, text, at, tries: 0 });
    await writePending(env, list);
    return json({ ok: true });
  }

  if (path === '/api/delete') {
    const list = await readPending(env);
    if (body.all === true) {
      const rest = list.filter(r => r.uid !== uid);
      if (rest.length !== list.length) await writePending(env, rest);
      await env.KV.delete('sub:' + uid);
      return json({ ok: true });
    }
    const id = needId(body.id);
    const rest = list.filter(r => !(r.uid === uid && r.id === id));
    if (rest.length !== list.length) await writePending(env, rest);
    return json({ ok: true, deleted: list.length - rest.length });
  }

  if (path === '/api/sync') {
    // Çevrimdışı kalmış değişiklikleri telafi eder: bu kullanıcının bekleyenlerini istemcinin listesiyle değiştirir
    if (!Array.isArray(body.reminders) || body.reminders.length > MAX_PER_UID) throw new HttpError(400, 'bad_reminders', 'Geçersiz liste.');
    if (!(await getSub(env, uid))) throw new HttpError(404, 'not_subscribed', 'Bildirim aboneliği bulunamadı.');
    const list = await readPending(env);
    const mine = new Map(list.filter(r => r.uid === uid).map(r => [r.id, r]));
    const next = list.filter(r => r.uid !== uid);
    const seen = new Set();
    for (const item of body.reminders) {
      if (!item || typeof item !== 'object') continue;
      const id = needId(item.id), text = needText(item.text);
      if (seen.has(id)) continue; seen.add(id);
      if (typeof item.at !== 'number' || !Number.isInteger(item.at)) throw new HttpError(400, 'bad_at', 'Geçersiz zaman.');
      const old = mine.get(id);
      // Geçmiş zamanlı kayıt sunucuda yoksa ekleme (zaten gönderilmiş olabilir)
      if (item.at <= now && !(old && old.at === item.at)) continue;
      if (item.at > now + 3 * 365 * 86400000) continue;
      next.push({ uid, id, text, at: item.at, tries: old && old.at === item.at ? old.tries || 0 : 0 });
    }
    if (next.length > MAX_PENDING) throw new HttpError(429, 'too_many', 'Çok fazla bekleyen hatırlatıcı var.');
    const sig = l => JSON.stringify(l.filter(r => r.uid === uid).map(r => [r.id, r.text, r.at]).sort());
    const changed = sig(next) !== sig(list);
    if (changed) await writePending(env, next);
    return json({ ok: true, changed, count: next.filter(r => r.uid === uid).length });
  }

  if (path === '/api/test') {
    const rec = await getSub(env, uid);
    if (!rec) throw new HttpError(404, 'not_subscribed', 'Bildirim aboneliği bulunamadı.');
    const v = vapidFor(env, await getVapid(env));
    const res = await sendPush(rec.sub, { title: '⏰ Hatırlatıcı', body: 'Test bildirimi: her şey yolunda! 🎉', id: 'test', at: now, url: '/', silent: rec.silent }, v, deps.fetch);
    if (res.ok) return json({ ok: true });
    if (res.gone) { await env.KV.delete('sub:' + uid); return err(410, 'subscription_gone', 'Abonelik geçersiz; bildirimleri yeniden açın.'); }
    return err(502, 'push_failed', 'Bildirim servisi isteği reddetti (' + res.status + ').');
  }
  return err(404, 'not_found', 'Böyle bir uç nokta yok.');
}

/* ── Zamanlayıcı ── */
export async function runCron(env, deps) {
  const now = deps.now();
  const list = await readPending(env);
  const due = list.filter(r => r.at <= now + EARLY_MS).slice(0, MAX_SENDS_PER_RUN);
  if (!due.length) return { sent: 0, failed: 0, dropped: 0, waiting: list.length };

  const v = vapidFor(env, await getVapid(env));
  const subs = new Map();
  const remove = new Set(), bump = new Set(), goneUids = new Set();
  const key = r => r.uid + '|' + r.id + '|' + r.at;
  let sent = 0, failed = 0, dropped = 0;

  for (const r of due) {
    if (goneUids.has(r.uid)) { remove.add(key(r)); dropped++; continue; }
    if (!subs.has(r.uid)) subs.set(r.uid, await getSub(env, r.uid));
    const rec = subs.get(r.uid);
    if (!rec) { remove.add(key(r)); dropped++; continue; }           // abonelik yok → gönderilemez
    const res = await sendPush(rec.sub, payloadFor(r, rec.silent), v, deps.fetch);
    if (res.ok) { remove.add(key(r)); sent++; }
    else if (res.gone) { goneUids.add(r.uid); remove.add(key(r)); dropped++; await env.KV.delete('sub:' + r.uid); }
    else if ((r.tries || 0) + 1 >= MAX_TRIES) { remove.add(key(r)); dropped++; }
    else { bump.add(key(r)); failed++; }
  }

  // Yazmadan hemen önce tazeden oku (bu arada eklenen kayıtlar kaybolmasın)
  const fresh = await readPending(env);
  const next = [];
  for (const r of fresh) {
    const k = key(r);
    if (remove.has(k) || goneUids.has(r.uid)) continue;
    if (bump.has(k)) next.push({ ...r, tries: (r.tries || 0) + 1 });
    else next.push(r);
  }
  await writePending(env, next);
  return { sent, failed, dropped, waiting: next.length };
}

/* ── Statik dosyalar ── */
function staticResponse(path, assets, method) {
  const map = {
    '/': ['html', 'text/html; charset=utf-8', 'no-cache'],
    '/index.html': ['html', 'text/html; charset=utf-8', 'no-cache'],
    '/sw.js': ['sw', 'text/javascript; charset=utf-8', 'no-cache'],
    '/manifest.webmanifest': ['manifest', 'application/manifest+json; charset=utf-8', 'no-cache'],
    '/icon-180.png': ['icon180', 'image/png', 'public, max-age=604800'],
    '/apple-touch-icon.png': ['icon180', 'image/png', 'public, max-age=604800'],
    '/icon-192.png': ['icon192', 'image/png', 'public, max-age=604800'],
    '/icon-512.png': ['icon512', 'image/png', 'public, max-age=604800'],
    '/favicon.ico': ['icon192', 'image/png', 'public, max-age=604800']
  };
  const m = map[path];
  if (!m) return null;
  const headers = { 'Content-Type': m[1], 'Cache-Control': m[2], ...SEC_HEADERS };
  if (m[0] === 'html') { headers['Content-Security-Policy'] = CSP; headers['Permissions-Policy'] = 'microphone=(self)'; }
  if (m[0] === 'sw') headers['Service-Worker-Allowed'] = '/';
  return new Response(method === 'HEAD' ? null : assets.get(m[0]), { status: 200, headers });
}

/* ── Worker girişi ── */
export function makeWorker(ASSETS) {
  const cache = new Map();
  const assets = {
    get(name) {
      if (!cache.has(name)) {
        const v = ASSETS[name];
        if (name.startsWith('icon')) { const bin = atob(v); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); cache.set(name, u); }
        else cache.set(name, v);
      }
      return cache.get(name);
    }
  };
  const defaultDeps = () => ({ now: () => Date.now(), fetch: (...a) => fetch(...a) });

  return {
    async fetch(request, env, ctx, deps) {
      deps = deps || defaultDeps();
      try {
        const url = new URL(request.url);
        if (url.pathname.startsWith('/api/')) {
          if (!env || !env.KV) return err(500, 'kv_missing', 'KV bağlaması bulunamadı. Worker ayarlarında "KV" adıyla bir KV ad alanı bağlayın.');
          return await handleApi(request, env, url, deps);
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Yöntem desteklenmiyor', { status: 405, headers: { Allow: 'GET, HEAD', ...SEC_HEADERS } });
        const res = staticResponse(url.pathname, assets, request.method);
        if (res) return res;
        return new Response('Sayfa bulunamadı', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...SEC_HEADERS } });
      } catch (e) {
        if (e instanceof HttpError) return err(e.status, e.code, e.message);
        return err(500, 'server_error', 'Sunucuda beklenmeyen bir hata oluştu.');
      }
    },
    async scheduled(event, env, ctx, deps) {
      if (!env || !env.KV) return;
      const p = runCron(env, deps || defaultDeps()).catch(e => console.log('cron hata', e && e.message));
      if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p;
    }
  };
}
