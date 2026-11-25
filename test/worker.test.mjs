// Derlenmiş worker.js üzerinde uçtan uca testler: statik dosyalar, API (geçerli/geçersiz), cron (sahte KV + sahte push servisi).
import crypto from 'node:crypto';
import worker from '../worker.js';

let pass = 0, fail = 0;
const ok = (name, cond, info = '') => { if (cond) { pass++; console.log('✅', name); } else { fail++; console.log('❌', name, info); } };
const B = s => Buffer.from(s, 'base64url');

/* ── Sahte KV ── */
function mockKV() {
  const m = new Map();
  const kv = {
    m, gets: 0, puts: 0, deletes: 0,
    async get(k, t) { kv.gets++; const v = m.get(k); if (v == null) return null; return (t === 'json' || (t && t.type === 'json')) ? JSON.parse(v) : v; },
    async put(k, v) { kv.puts++; m.set(k, String(v)); },
    async delete(k) { kv.deletes++; m.delete(k); },
    json(k) { const v = m.get(k); return v == null ? null : JSON.parse(v); }
  };
  return kv;
}

/* ── Sahte push servisi ── */
function makeSubscriber(endpoint = 'https://web.push.apple.com/QG' + crypto.randomBytes(8).toString('hex')) {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16).toString('base64url');
  return { endpoint, priv: ecdh.getPrivateKey().toString('base64url'), sub: { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth } } };
}
function decrypt(body, s) {
  body = Buffer.from(body);
  const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const e = crypto.createECDH('prime256v1'); e.setPrivateKey(B(s.priv));
  const secret = e.computeSecret(asPub);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, B(s.sub.keys.auth), Buffer.concat([Buffer.from('WebPush: info\0'), B(s.sub.keys.p256dh), asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(-16));
  const pt = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
  return JSON.parse(pt.subarray(0, pt.lastIndexOf(2)).toString('utf8'));
}
function pushService(statusFn) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    const st = typeof statusFn === 'function' ? statusFn(url, init, calls.length) : statusFn;
    if (st === 'throw') throw new Error('network down');
    return new Response(null, { status: st });
  };
  f.calls = calls;
  return f;
}

const ORIGIN = 'https://animsa.ornek.workers.dev';
let NOW = Date.UTC(2026, 10, 24, 11, 0, 0);
const deps = (fetchImpl) => ({ now: () => NOW, fetch: fetchImpl || pushService(201) });
const req = (path, opts = {}) => new Request(ORIGIN + path, opts);
const post = (path, body, ct = 'application/json') => req(path, { method: 'POST', headers: { 'content-type': ct }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const call = async (env, r, d) => { const res = await worker.fetch(r, env, {}, d || deps()); let data = null; const text = await res.text(); try { data = JSON.parse(text); } catch { data = text; } return { res, data }; };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

/* ═══ Statik dosyalar ═══ */
{
  const env = { KV: mockKV() };
  let { res, data } = await call(env, req('/'));
  ok('GET / → 200 HTML, UTF-8, CSP', res.status === 200 && res.headers.get('content-type') === 'text/html; charset=utf-8' && data.includes('<title>Anımsa</title>') && !!res.headers.get('content-security-policy'));
  ok('HTML: viewport-fit=cover, apple meta etiketleri, manifest', data.includes('viewport-fit=cover') && data.includes('apple-mobile-web-app-capable') && data.includes('black-translucent') && data.includes('apple-touch-icon') && data.includes('rel="manifest"'));
  ({ res, data } = await call(env, req('/manifest.webmanifest')));
  ok('Manifest: standalone, tr, #05060F, Anımsa', res.status === 200 && data.display === 'standalone' && data.lang === 'tr' && data.theme_color === '#05060F' && data.background_color === '#05060F' && data.short_name === 'Anımsa');
  ({ res, data } = await call(env, req('/sw.js')));
  ok('GET /sw.js → JavaScript, önbellek sürümlü', res.status === 200 && /javascript/.test(res.headers.get('content-type')) && /animsa-[0-9a-f]{10}/.test(data) && data.includes("addEventListener('push'"));
  for (const sz of [180, 192, 512]) {
    const r2 = await worker.fetch(req(`/icon-${sz}.png`), env, {}, deps());
    const buf = Buffer.from(await r2.arrayBuffer());
    ok(`GET /icon-${sz}.png → geçerli ${sz}×${sz} PNG`, r2.status === 200 && r2.headers.get('content-type') === 'image/png' && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(16) === sz && buf.readUInt32BE(20) === sz);
  }
  ({ res } = await call(env, req('/apple-touch-icon.png')));
  ok('GET /apple-touch-icon.png → 200', res.status === 200);
  ({ res } = await call(env, req('/yok')));
  ok('Bilinmeyen sayfa → 404', res.status === 404);
  ({ res } = await call(env, req('/', { method: 'DELETE' })));
  ok('Statik yolda DELETE → 405', res.status === 405);
}

/* ═══ API ═══ */
const env = { KV: mockKV() };
const S = makeSubscriber();
const uid = sha(S.endpoint);
{
  let { res, data } = await call(env, req('/api/config'));
  ok('GET /api/config → 65 baytlık VAPID açık anahtarı', res.status === 200 && B(data.publicKey).length === 65 && res.headers.get('content-type').startsWith('application/json'));
  const stored = env.KV.json('vapid');
  ok('VAPID anahtarı ilk çalışmada üretilip KV\'ye kaydedildi', stored && stored.publicKey === data.publicKey && !!stored.privateJwk.d && stored.subject === ORIGIN);
  const again = await call(env, req('/api/config'));
  ok('İkinci çağrıda aynı anahtar', again.data.publicKey === data.publicKey);
  ({ res } = await call(env, post('/api/config', {})));
  ok('POST /api/config → 405', res.status === 405);
  ({ res, data } = await call({}, req('/api/config')));
  ok('KV bağlaması yoksa anlaşılır 500 hatası', res.status === 500 && data.error === 'kv_missing');

  // Abonelik
  ({ res, data } = await call(env, post('/api/subscribe', '{bozuk')));
  ok('Bozuk JSON → 400 bad_json', res.status === 400 && data.error === 'bad_json');
  ({ res, data } = await call(env, post('/api/subscribe', 'x=1', 'text/plain')));
  ok('Yanlış Content-Type → 415', res.status === 415);
  ({ res, data } = await call(env, post('/api/subscribe', '[]')));
  ok('JSON dizisi gövde → 400', res.status === 400);
  ({ res, data } = await call(env, post('/api/subscribe', { uid: 'abc', sub: S.sub })));
  ok('Geçersiz uid → 400 bad_uid', res.status === 400 && data.error === 'bad_uid');
  const evil = makeSubscriber('https://evil.example.com/push');
  ({ res, data } = await call(env, post('/api/subscribe', { uid: sha(evil.endpoint), sub: evil.sub })));
  ok('İzinsiz push adresi → 400 bad_subscription', res.status === 400 && data.error === 'bad_subscription');
  ({ res, data } = await call(env, post('/api/subscribe', { uid: sha('baska'), sub: S.sub })));
  ok('uid ≠ SHA-256(endpoint) → 400 uid_mismatch', res.status === 400 && data.error === 'uid_mismatch');
  ({ res, data } = await call(env, post('/api/subscribe', { uid, sub: S.sub })));
  ok('Geçerli abonelik → 200 ve KV\'de sub:<uid>', res.status === 200 && data.ok && env.KV.json('sub:' + uid).sub.endpoint === S.endpoint);
  ({ res, data } = await call(env, post('/api/subscribe', { uid, sub: { ...S.sub, keys: { p256dh: 'AAAA', auth: S.sub.keys.auth } } })));
  ok('Bozuk p256dh → 400', res.status === 400);

  // Hatırlatıcılar
  const rem = { uid, id: 'r1-aaaaaaaa', text: 'Ahmet\'i ara 📞', at: NOW + 3600000 };
  ({ res, data } = await call(env, post('/api/reminders', rem)));
  ok('POST /api/reminders → 200, pending\'e eklendi', res.status === 200 && env.KV.json('pending').length === 1 && env.KV.json('pending')[0].text === 'Ahmet\'i ara 📞');
  ({ res } = await call(env, post('/api/reminders', { ...rem, text: 'Ahmet\'i ara (güncel)' })));
  const pend = env.KV.json('pending');
  ok('Aynı id ile tekrar gönderim güncelleme yapar (çift kayıt yok)', res.status === 200 && pend.length === 1 && pend[0].text === 'Ahmet\'i ara (güncel)');
  const bad = [
    [{ ...rem, id: 'x' }, 'bad_id'], [{ ...rem, id: '../../etc' }, 'bad_id'], [{ ...rem, text: '   ' }, 'bad_text'], [{ ...rem, text: 5 }, 'bad_text'],
    [{ ...rem, at: 'yarın' }, 'bad_at'], [{ ...rem, at: 1.5 }, 'bad_at'], [{ ...rem, at: NOW - 3600000 }, 'at_in_past'], [{ ...rem, at: NOW + 10 * 365 * 86400000 }, 'at_too_far'],
    [{ ...rem, uid: 'Z'.repeat(64) }, 'bad_uid']
  ];
  for (const [b, code] of bad) { const r = await call(env, post('/api/reminders', b)); ok(`Geçersiz hatırlatıcı reddedildi (${code})`, r.res.status === 400 && r.data.error === code, JSON.stringify(r.data)); }
  ({ res, data } = await call(env, post('/api/reminders', { ...rem, uid: sha('kayitsiz') })));
  ok('Abone olmayan uid → 404 not_subscribed', res.status === 404 && data.error === 'not_subscribed');
  ({ res } = await call(env, req('/api/reminders')));
  ok('GET /api/reminders → 405', res.status === 405);
  ({ res } = await call(env, post('/api/bilinmeyen', {})));
  ok('Bilinmeyen API → 404', res.status === 404);
  const long = await call(env, post('/api/reminders', { ...rem, id: 'r-long-0001', text: 'a'.repeat(1000) }));
  ok('Çok uzun metin 300 karaktere kısaltılır', long.res.status === 200 && env.KV.json('pending').find(r => r.id === 'r-long-0001').text.length === 300);
  ({ res } = await call(env, post('/api/subscribe', 'x'.repeat(70000))));
  ok('64 KB üstü gövde → 413', res.status === 413);

  // Silme
  ({ res, data } = await call(env, post('/api/delete', { uid, id: 'r-long-0001' })));
  ok('POST /api/delete → kayıt silindi', res.status === 200 && data.deleted === 1 && !env.KV.json('pending').some(r => r.id === 'r-long-0001'));
  ({ res, data } = await call(env, post('/api/delete', { uid, id: 'yok-yok-yok' })));
  ok('Olmayan kaydı silmek hata vermez', res.status === 200 && data.deleted === 0);
  ({ res, data } = await call(env, post('/api/delete', { uid })));
  ok('id\'siz silme → 400', res.status === 400);

  // Senkron
  const putsBefore = env.KV.puts;
  ({ res, data } = await call(env, post('/api/sync', { uid, reminders: [{ id: 'r1-aaaaaaaa', text: 'Ahmet\'i ara (güncel)', at: NOW + 3600000 }] })));
  ok('Senkron: değişiklik yoksa KV\'ye yazmaz', res.status === 200 && data.changed === false && env.KV.puts === putsBefore);
  ({ res, data } = await call(env, post('/api/sync', { uid, reminders: [
    { id: 'r1-aaaaaaaa', text: 'Ahmet\'i ara (güncel)', at: NOW + 3600000 },
    { id: 's2-bbbbbbbb', text: 'Çevrimdışı eklenen', at: NOW + 7200000 },
    { id: 's3-cccccccc', text: 'Geçmişte kalmış', at: NOW - 60000 }
  ] })));
  const ids = env.KV.json('pending').map(r => r.id).sort();
  ok('Senkron: çevrimdışı ekleneni ekler, geçmiştekini eklemez', data.changed === true && ids.join() === 'r1-aaaaaaaa,s2-bbbbbbbb');
  ({ res, data } = await call(env, post('/api/sync', { uid, reminders: [{ id: 's2-bbbbbbbb', text: 'Çevrimdışı eklenen', at: NOW + 7200000 }] })));
  ok('Senkron: çevrimdışıyken silineni sunucudan da siler', env.KV.json('pending').map(r => r.id).join() === 's2-bbbbbbbb');
  ({ res } = await call(env, post('/api/sync', { uid, reminders: 'x' })));
  ok('Senkron: geçersiz liste → 400', res.status === 400);

  // Test bildirimi
  const ps = pushService(201);
  ({ res, data } = await call(env, post('/api/test', { uid }), deps(ps)));
  const testPayload = ps.calls[0] && decrypt(ps.calls[0].init.body, S);
  ok('POST /api/test → push gönderildi, Node ile çözülen içerik doğru', res.status === 200 && ps.calls.length === 1 && testPayload.title === '🎉 Test bildirimi' && /Her şey yolunda/.test(testPayload.body));
  ({ res, data } = await call(env, post('/api/test', { uid: sha('kayitsiz') })));
  ok('Test: abonelik yoksa 404', res.status === 404);
  ({ res, data } = await call(env, post('/api/test', { uid }), deps(pushService(502))));
  ok('Test: push servisi hata verirse 502 push_failed', res.status === 502 && data.error === 'push_failed');
}

/* ═══ Cron ═══ */
async function cron(env, f) { await worker.scheduled({ cron: '* * * * *', scheduledTime: NOW }, env, undefined, deps(f)); }
function setPending(env, list) { env.KV.m.set('pending', JSON.stringify(list)); }
async function freshEnv() {
  const e = { KV: mockKV() };
  await call(e, req('/api/config'));
  const s = makeSubscriber();
  const u = sha(s.endpoint);
  await call(e, post('/api/subscribe', { uid: u, sub: s.sub, silent: false, tz: 'Europe/Istanbul' }));
  return { e, s, u };
}
{
  const { e, s, u } = await freshEnv();
  setPending(e, [
    { uid: u, id: 'due-00001', text: 'Çamaşırı çıkar', at: NOW - 1000, tries: 0 },
    { uid: u, id: 'soon-0001', text: '10 sn sonra', at: NOW + 10000, tries: 0 },
    { uid: u, id: 'late-0001', text: 'Bir saat sonra', at: NOW + 3600000, tries: 0 },
    { uid: u, id: 'edge-0001', text: '30 sn sonra', at: NOW + 30000, tries: 0 }
  ]);
  const f = pushService(201);
  await cron(e, f);
  const left = e.KV.json('pending').map(r => r.id).sort();
  ok('Cron: zamanı gelen (ve ≤15 sn kalan) gönderildi', f.calls.length === 2);
  ok('Cron: zamanı gelmeyenler bekliyor', left.join() === 'edge-0001,late-0001');
  const c0 = f.calls[0];
  const h = c0.init.headers;
  ok('Push isteği: TTL, Urgency: high, Content-Encoding: aes128gcm', h.TTL === '86400' && h.Urgency === 'high' && h['Content-Encoding'] === 'aes128gcm');
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(h.Authorization);
  const vapid = e.KV.json('vapid');
  ok('Authorization: "vapid t=<jwt>, k=<açık anahtar>"', !!m && m[2] === vapid.publicKey);
  const [jh, jp, js] = m[1].split('.');
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: vapid.privateJwk.x, y: vapid.privateJwk.y }, format: 'jwk' });
  const claims = JSON.parse(B(jp).toString());
  ok('Cron JWT: imza geçerli, aud = push origin, exp ≤ 12 saat', crypto.verify('sha256', Buffer.from(jh + '.' + jp), { key: pub, dsaEncoding: 'ieee-p1363' }, B(js)) && claims.aud === 'https://web.push.apple.com' && claims.exp - Math.floor(Date.now() / 1000) <= 43200 && claims.sub === ORIGIN);
  const payload = decrypt(c0.init.body, s);
  const payloads = f.calls.map(c => decrypt(c.init.body, s));
  const p1 = payloads.find(x => x.id === 'due-00001');
  ok('Cron: şifreli yük Node ile çözüldü; başlıkta emoji + görev', !!p1 && p1.title === '🔔 Çamaşırı çıkar' && payload.url.startsWith('/?r='), JSON.stringify(p1));
  ok('Bildirim gövdesi kullanıcının saat diliminde saat içeriyor (Europe/Istanbul)', p1 && p1.body === '13:59 · Ertelemek için dokun', p1 && p1.body);
  const puts = e.KV.puts;
  NOW += 1000; await cron(e, pushService(201));
  ok('Cron: gönderilecek yoksa KV\'ye yazmaz', e.KV.puts === puts);
  NOW -= 1000;
}
{
  const { e, u } = await freshEnv();
  setPending(e, [{ uid: u, id: 'gone-0001', text: 'a', at: NOW - 1, tries: 0 }, { uid: u, id: 'gone-0002', text: 'b', at: NOW - 2, tries: 0 }, { uid: u, id: 'gone-0003', text: 'gelecek', at: NOW + 999999, tries: 0 }]);
  const f = pushService(410);
  await cron(e, f);
  ok('Cron 410: abonelik silindi', e.KV.json('sub:' + u) === null);
  ok('Cron 410: aynı kullanıcıya ikinci istek atılmadı, bekleyenleri temizlendi', f.calls.length === 1 && e.KV.json('pending').length === 0);
}
{
  const { e, u } = await freshEnv();
  setPending(e, [{ uid: u, id: 'nf-000001', text: 'a', at: NOW - 1, tries: 0 }]);
  await cron(e, pushService(404));
  ok('Cron 404: abonelik silindi', e.KV.json('sub:' + u) === null && e.KV.json('pending').length === 0);
}
for (const st of [500, 429, 503, 'throw']) {
  const { e, u } = await freshEnv();
  setPending(e, [{ uid: u, id: 'retry-0001', text: 'tekrar', at: NOW - 1, tries: 0 }]);
  const f = pushService(st);
  let after1 = null;
  for (let i = 0; i < 7; i++) { await cron(e, f); if (i === 0) after1 = e.KV.json('pending')[0]; }
  ok(`Cron ${st}: tekrar denendi, en fazla 5 deneme, sonra bırakıldı`, after1 && after1.tries === 1 && f.calls.length === 5 && e.KV.json('pending').length === 0, `çağrı=${f.calls.length}`);
}
{
  const { e, u } = await freshEnv();
  setPending(e, [{ uid: u, id: 'flaky-001', text: 'x', at: NOW - 1, tries: 0 }]);
  const f = pushService((url, init, n) => n < 3 ? 503 : 201);
  for (let i = 0; i < 4; i++) await cron(e, f);
  ok('Cron: geçici hatadan sonra başarılı gönderim ve kayıt silindi', f.calls.length === 3 && e.KV.json('pending').length === 0);
}
{
  const { e } = await freshEnv();
  const ghost = sha('ghost');
  setPending(e, [{ uid: ghost, id: 'ghost-001', text: 'x', at: NOW - 1, tries: 0 }]);
  const f = pushService(201);
  await cron(e, f);
  ok('Cron: aboneliği olmayan kayıt istek atılmadan bırakıldı', f.calls.length === 0 && e.KV.json('pending').length === 0);
}
{
  const { e } = await freshEnv();
  const bad = sha('https://evil.example.com/x');
  e.KV.m.set('sub:' + bad, JSON.stringify({ sub: { endpoint: 'https://evil.example.com/x', keys: { p256dh: 'x', auth: 'y' } } }));
  setPending(e, [{ uid: bad, id: 'evil-0001', text: 'x', at: NOW - 1, tries: 0 }]);
  const f = pushService(201);
  await cron(e, f);
  ok('Cron: KV\'ye sızmış izinsiz adrese asla istek atılmadı', f.calls.length === 0 && e.KV.json('pending').length === 0);
}
{
  const { e, u } = await freshEnv();
  setPending(e, [{ uid: u, id: 'race-0001', text: 'x', at: NOW - 1, tries: 0 }]);
  // Gönderim sırasında API yeni kayıt ekliyor (yarış durumu)
  const f = pushService(() => { const l = e.KV.json('pending'); l.push({ uid: u, id: 'race-new1', text: 'yeni', at: NOW + 60000, tries: 0 }); e.KV.m.set('pending', JSON.stringify(l)); return 201; });
  await cron(e, f);
  ok('Cron: gönderim sırasında eklenen kayıt kaybolmadı', e.KV.json('pending').map(r => r.id).join() === 'race-new1');
}
{
  const { e, u } = await freshEnv();
  const list = []; for (let i = 0; i < 60; i++) list.push({ uid: u, id: 'bulk-' + String(i).padStart(4, '0'), text: 'x' + i, at: NOW - 1000 + i, tries: 0 });
  setPending(e, list);
  const f = pushService(201);
  await cron(e, f);
  ok('Cron: tek çalışmada en fazla 40 gönderim (ücretsiz plan alt istek sınırı), kalanlar sonraki dakikaya', f.calls.length === 40 && e.KV.json('pending').length === 20);
}
{
  const e = { KV: mockKV() };
  e.KV.m.set('pending', '{bozuk json');
  let threw = false; try { await cron(e, pushService(201)); } catch { threw = true; }
  ok('Cron: bozuk pending verisinde çökmez', !threw);
  const r = await call(e, req('/api/config'));
  ok('Bozuk KV verisinde API çalışmaya devam eder', r.res.status === 200);
}


/* ═══ Bildirim içeriği: emoji + ertelendi ═══ */
{
  const { e, s, u } = await freshEnv();
  setPending(e, [{ uid: u, id: 'emo-00001', text: 'Annemi ara', at: NOW - 1, tries: 0, snoozed: true }]);
  const f = pushService(201);
  await cron(e, f);
  const pl = decrypt(f.calls[0].init.body, s);
  ok('Ertelenmiş hatırlatıcı: "📞 Annemi ara" / "Ertelendi · 13:59 · …"', pl.title === '📞 Annemi ara' && pl.body.startsWith('Ertelendi · 13:59'), JSON.stringify(pl));
  const r = await call(e, post('/api/reminders', { uid: u, id: 'snz-00001', text: 'x', at: NOW + 60000, snoozed: true }));
  ok('POST /api/reminders snoozed alanını saklıyor', r.res.status === 200 && e.KV.json('pending').find(x => x.id === 'snz-00001').snoozed === true);
  const bad = await call(e, post('/api/subscribe', { uid: u, sub: s.sub, tz: 'Mars/Olympus' }));
  ok('Geçersiz saat dilimi yok sayılıyor (abonelik yine kabul)', bad.res.status === 200 && e.KV.json('sub:' + u).tz === null);
}

/* ═══ Önceden uyarı ═══ */
{
  const { e, s, u } = await freshEnv();
  const H = 3600000, M = 60000;
  // 20:00'deki hatırlatıcı (NOW + 1 saat), 30 dk önce uyarı
  let r = await call(e, post('/api/reminders', { uid: u, id: 'lead-0001', text: 'Annemi ara', at: NOW + H, lead: 30 }));
  let pend = e.KV.json('pending').find(x => x.id === 'lead-0001');
  ok('Önceden uyarılı hatırlatıcı kaydedildi (lead 30, henüz gönderilmedi)', r.res.status === 200 && pend.lead === 30 && pend.preSent === false);
  r = await call(e, post('/api/reminders', { uid: u, id: 'lead-late1', text: 'Geç kurulan', at: NOW + 10 * M, lead: 30 }));
  ok('Uyarı zamanı zaten geçmişse ön uyarı gönderilmiş sayılır', e.KV.json('pending').find(x => x.id === 'lead-late1').preSent === true);
  r = await call(e, post('/api/reminders', { uid: u, id: 'lead-bad01', text: 'x', at: NOW + H, lead: -5 }));
  ok('Geçersiz önceden uyarı süresi 0 sayılır', e.KV.json('pending').find(x => x.id === 'lead-bad01').lead === 0);
  await call(e, post('/api/delete', { uid: u, id: 'lead-late1' })); await call(e, post('/api/delete', { uid: u, id: 'lead-bad01' }));

  const saved = NOW;
  NOW = saved + 29 * M; let f = pushService(201); await cron(e, f);
  ok('Uyarı zamanından önce hiçbir şey gönderilmiyor', f.calls.length === 0);
  NOW = saved + 30 * M; f = pushService(201); await cron(e, f);
  const pre = f.calls[0] && decrypt(f.calls[0].init.body, s);
  pend = e.KV.json('pending').find(x => x.id === 'lead-0001');
  ok('30 dk önce: önceden uyarı gönderildi ("⏳ 30 dk sonra · 15:00")', f.calls.length === 1 && pre.title === '📞 Annemi ara' && pre.body === '⏳ 30 dk sonra · 15:00' && pre.pre === true, JSON.stringify(pre));
  ok('Önceden uyarıdan sonra asıl hatırlatma beklemede kalıyor (preSent: true)', pend && pend.preSent === true);
  NOW = saved + 31 * M; f = pushService(201); await cron(e, f);
  ok('Önceden uyarı ikinci kez gönderilmiyor', f.calls.length === 0);
  NOW = saved + 60 * M; f = pushService(201); await cron(e, f);
  const main = f.calls[0] && decrypt(f.calls[0].init.body, s);
  ok('Asıl zamanda normal hatırlatma gönderildi ve kayıt silindi', f.calls.length === 1 && main.body === '15:00 · Ertelemek için dokun' && !main.pre && !e.KV.json('pending').some(x => x.id === 'lead-0001'), JSON.stringify(main));
  NOW = saved;

  // Ön uyarı başarısız olsa da asıl hatırlatma gider
  await call(e, post('/api/reminders', { uid: u, id: 'lead-0002', text: 'Toplantı', at: NOW + H, lead: 30 }));
  NOW = saved + 30 * M; f = pushService(503); await cron(e, f); NOW = saved;
  ok('Ön uyarı geçici hata verirse tekrar denenmez, asıl hatırlatma bekler', f.calls.length === 1 && e.KV.json('pending').find(x => x.id === 'lead-0002').preSent === true);
  // Senkron: lead korunur, değişmeyen kayıtta preSent korunur
  r = await call(e, post('/api/sync', { uid: u, reminders: [{ id: 'lead-0002', text: 'Toplantı', at: NOW + H, lead: 30 }] }));
  ok('Senkron: aynı kayıt için önceden uyarı durumu korunuyor', e.KV.json('pending').find(x => x.id === 'lead-0002').preSent === true);
  r = await call(e, post('/api/sync', { uid: u, reminders: [{ id: 'lead-0002', text: 'Toplantı', at: NOW + 2 * H, lead: 30 }] }));
  ok('Senkron: zamanı değişen kayıtta önceden uyarı yeniden kuruluyor', e.KV.json('pending').find(x => x.id === 'lead-0002').preSent === false);
}

/* ═══ Ses → yazı (Workers AI) ═══ */
{
  const wav = (n = 8000) => { const b = Buffer.alloc(44 + n); b.write('RIFF', 0); b.write('WAVE', 8); return b; };
  const postAudio = (body, ct = 'audio/wav') => req('/api/transcribe', { method: 'POST', headers: { 'content-type': ct }, body });
  const calls = [];
  const aiOk = { async run(model, input) { calls.push({ model, input }); return { text: "  Akşam 8'de annemi ara.  " }; } };
  const e1 = { KV: mockKV(), AI: aiOk };
  let { res, data } = await call(e1, req('/api/config'));
  ok('/api/config ai:true (AI bağlaması varsa)', data.ai === true);
  ({ data } = await call({ KV: mockKV() }, req('/api/config')));
  ok('/api/config ai:false (AI bağlaması yoksa)', data.ai === false);
  ({ res, data } = await call(e1, postAudio(wav())));
  ok('POST /api/transcribe → Whisper turbo, Türkçe, temizlenmiş metin', res.status === 200 && data.text === "Akşam 8'de annemi ara." && calls[0].model === '@cf/openai/whisper-large-v3-turbo' && calls[0].input.language === 'tr' && typeof calls[0].input.audio === 'string');
  ok('Ses base64 olarak birebir iletiliyor', Buffer.from(calls[0].input.audio, 'base64').equals(wav()));
  const calls2 = [];
  const aiFallback = { async run(model, input) { calls2.push(model); if (model.includes('turbo')) throw new Error('model yok'); return { text: 'yarın 10da kurs' }; } };
  ({ res, data } = await call({ KV: mockKV(), AI: aiFallback }, postAudio(wav())));
  ok('Turbo hata verirse klasik Whisper modeline düşüyor', res.status === 200 && data.text === 'yarın 10da kurs' && calls2.join() === '@cf/openai/whisper-large-v3-turbo,@cf/openai/whisper');
  ({ res, data } = await call({ KV: mockKV(), AI: { async run() { throw new Error('kota'); } } }, postAudio(wav())));
  ok('İki model de hata verirse 502 stt_failed', res.status === 502 && data.error === 'stt_failed');
  ({ res, data } = await call({ KV: mockKV(), AI: { async run() { return { text: 'Altyazı M.K.' }; } } }, postAudio(wav())));
  ok('Whisper\'ın sessizlik uydurmaları ("Altyazı M.K.") boş metne çevriliyor', res.status === 200 && data.text === '');
  ({ res, data } = await call({ KV: mockKV() }, postAudio(wav())));
  ok('AI bağlaması yoksa 503 ai_missing ve açık Türkçe mesaj', res.status === 503 && data.error === 'ai_missing' && /AI/.test(data.message));
  ({ res } = await call(e1, postAudio(wav(), 'application/json')));
  ok('Ses dışı içerik → 415', res.status === 415);
  ({ res } = await call(e1, postAudio(Buffer.alloc(100))));
  ok('Çok kısa kayıt → 400', res.status === 400);
  ({ res } = await call(e1, postAudio(Buffer.alloc(3 * 1024 * 1024))));
  ok('2,5 MB üstü kayıt → 413', res.status === 413);
  ({ res } = await call(e1, req('/api/transcribe')));
  ok('GET /api/transcribe → 405', res.status === 405);
}

console.log(`\nWorker: ${pass}/${pass + fail} geçti`);
process.exit(fail ? 1 : 0);
