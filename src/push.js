/* ════════════════════════════════════════════════════════════════
   Web Push — kütüphanesiz, yalnızca Web Crypto
   • VAPID (RFC 8292): ES256 imzalı JWT
   • Yük şifrelemesi (RFC 8291 + RFC 8188): aes128gcm
   Cloudflare Workers ve Node 20+ ortamında aynı kodla çalışır.
   ════════════════════════════════════════════════════════════════ */

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();

/* ── base64url ── */
export function b64uEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64uDecode(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_\-]*={0,2}$/.test(str)) throw new Error('bad_base64');
  const s = str.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...arrs) {
  const len = arrs.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

/* ── VAPID anahtarları ── */
export async function generateVapidKeys() {
  const kp = await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await subtle().exportKey('raw', kp.publicKey));
  const jwk = await subtle().exportKey('jwk', kp.privateKey);
  return { publicKey: b64uEncode(raw), privateJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d } };
}

/** VAPID JWT üretir. aud = push servisinin origin'i, exp ≤ 12 saat. */
export async function vapidJwt(aud, subject, privateJwk, nowSec) {
  const now = nowSec || Math.floor(Date.now() / 1000);
  const header = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64uEncode(enc.encode(JSON.stringify({ aud, exp: now + 12 * 3600, sub: subject })));
  const key = await subtle().importKey('jwk', { ...privateJwk, ext: true, key_ops: ['sign'] }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // Web Crypto ECDSA imzası zaten JWS'nin istediği ham r||s (64 bayt) biçimindedir
  const sig = new Uint8Array(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(header + '.' + payload)));
  return header + '.' + payload + '.' + b64uEncode(sig);
}

/* ── HKDF (Extract + Expand) ── */
async function hkdf(salt, ikm, info, length) {
  const key = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/**
 * RFC 8291 şifreleme. Dönüş: aes128gcm gövdesi (Uint8Array).
 * opts.salt ve opts.asKeys yalnızca test vektörü içindir.
 */
export async function encryptPayload(plaintext, uaPublicB64, authSecretB64, opts = {}) {
  const uaPublic = b64uDecode(uaPublicB64);
  const authSecret = b64uDecode(authSecretB64);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('bad_p256dh');
  if (authSecret.length < 16) throw new Error('bad_auth');
  const data = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext;
  const rs = 4096;
  if (data.length + 1 + 16 > rs - 86) throw new Error('payload_too_large');

  // Efemer uygulama sunucusu anahtarı
  let asPrivate, asPublic;
  if (opts.asKeys) {
    asPrivate = await subtle().importKey('jwk', opts.asKeys.privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    asPublic = b64uDecode(opts.asKeys.publicKey);
  } else {
    const kp = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    asPrivate = kp.privateKey;
    asPublic = new Uint8Array(await subtle().exportKey('raw', kp.publicKey));
  }
  const uaKey = await subtle().importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: uaKey }, asPrivate, 256));

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = opts.salt ? b64uDecode(opts.salt) : globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // Tek kayıt: düz metin || 0x02 (son kayıt sınırlayıcısı)
  const padded = concat(data, new Uint8Array([2]));
  const aesKey = await subtle().importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, padded));

  // Başlık: salt(16) || rs(4, big-endian) || idlen(1) || keyid(as_public)
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs, false);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ct);
}

/* ── Güvenlik: yalnızca bilinen push servisleri ── */
export function isAllowedEndpoint(endpoint) {
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  return h === 'web.push.apple.com' || h.endsWith('.push.apple.com') ||
    h === 'fcm.googleapis.com' ||
    h.endsWith('.push.services.mozilla.com') ||
    h.endsWith('.notify.windows.com');
}

/** Aboneliğin biçimini doğrular. Geçerliyse temizlenmiş kopya döner, değilse null. */
export function cleanSubscription(sub) {
  try {
    if (!sub || typeof sub !== 'object' || typeof sub.endpoint !== 'string' || sub.endpoint.length > 2048) return null;
    if (!isAllowedEndpoint(sub.endpoint)) return null;
    const k = sub.keys || {};
    const p = b64uDecode(k.p256dh), a = b64uDecode(k.auth);
    if (p.length !== 65 || p[0] !== 4 || a.length !== 16) return null;
    return { endpoint: sub.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } };
  } catch { return null; }
}

/**
 * Bildirim gönderir. Dönüş: { ok, status, gone, retry }
 *  gone  → abonelik geçersiz (404/410), silinmeli
 *  retry → geçici hata (429/5xx/ağ), sonra tekrar denenmeli
 */
export async function sendPush(sub, payloadObj, vapid, fetchImpl) {
  const f = fetchImpl || globalThis.fetch;
  if (!sub || !isAllowedEndpoint(sub.endpoint)) return { ok: false, status: 0, gone: true, retry: false, error: 'endpoint_not_allowed' };
  try {
    const body = await encryptPayload(JSON.stringify(payloadObj), sub.keys.p256dh, sub.keys.auth);
    const aud = new URL(sub.endpoint).origin;
    const jwt = await vapidJwt(aud, vapid.subject, vapid.privateJwk);
    const res = await f(sub.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `vapid t=${jwt}, k=${vapid.publicKey}`,
        'TTL': '86400',
        'Urgency': 'high',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream'
      },
      body
    });
    const status = res.status;
    if (status >= 200 && status < 300) return { ok: true, status };
    if (status === 404 || status === 410) return { ok: false, status, gone: true, retry: false };
    if (status === 429 || status >= 500) return { ok: false, status, gone: false, retry: true };
    return { ok: false, status, gone: false, retry: true }; // 400/403/413: sınırlı tekrar
  } catch (e) {
    return { ok: false, status: 0, gone: false, retry: true, error: String(e && e.message || e) };
  }
}

export async function sha256Hex(str) {
  const h = new Uint8Array(await subtle().digest('SHA-256', enc.encode(str)));
  return Array.from(h, b => b.toString(16).padStart(2, '0')).join('');
}
