// Web Push kripto testleri: RFC 8291 Ek A test vektörü, Node ile bağımsız çözme, VAPID JWT doğrulama.
import crypto from 'node:crypto';
import { encryptPayload, vapidJwt, generateVapidKeys, isAllowedEndpoint, cleanSubscription, b64uDecode, b64uEncode, sha256Hex } from '../src/push.js';

let pass = 0, fail = 0;
const ok = (name, cond, info = '') => { if (cond) { pass++; console.log('✅', name); } else { fail++; console.log('❌', name, info); } };
const B = s => Buffer.from(s, 'base64url');

/* ── 1) RFC 8291 Ek A ── */
const V = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPriv: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPub: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPriv: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPub: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  expected: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'
};
const asPubBytes = B(V.asPub);
const asJwk = { kty: 'EC', crv: 'P-256', d: V.asPriv, x: b64uEncode(asPubBytes.subarray(1, 33)), y: b64uEncode(asPubBytes.subarray(33, 65)) };
const out = await encryptPayload(V.plaintext, V.uaPub, V.auth, { salt: V.salt, asKeys: { privateJwk: asJwk, publicKey: V.asPub } });
ok('RFC 8291 Ek A: şifreli çıktı test vektörüyle birebir aynı', b64uEncode(out) === V.expected, '\n  bulunan: ' + b64uEncode(out));

/* ── Node crypto ile bağımsız çözme (alıcı tarafı) ── */
function nodeDecrypt(body, uaPrivB64, uaPubB64, authB64) {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const asPub = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(B(uaPrivB64));
  const secret = ecdh.computeSecret(asPub);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), B(uaPubB64), asPub]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, B(authB64), keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let end = pt.length - 1;
  while (end >= 0 && pt[end] === 0) end--;          // dolgu sıfırları
  if (pt[end] !== 2) throw new Error('padding delimiter 0x02 yok');
  return { text: pt.subarray(0, end).toString('utf8'), rs, idlen };
}
const dv = nodeDecrypt(Buffer.from(out), V.uaPriv, V.uaPub, V.auth);
ok('RFC vektörü Node crypto ile çözülüyor', dv.text === V.plaintext && dv.rs === 4096 && dv.idlen === 65);

// Rastgele anahtarlarla: Türkçe karakterli yük
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const uaPub = ua.getPublicKey().toString('base64url'), uaPriv = ua.getPrivateKey().toString('base64url');
const auth = crypto.randomBytes(16).toString('base64url');
const msg = JSON.stringify({ title: '⏰ Hatırlatıcı', body: 'Çğıİöşü — Ahmet\'i ara 📞' });
const body = await encryptPayload(msg, uaPub, auth);
let dec2 = null; try { dec2 = nodeDecrypt(Buffer.from(body), uaPriv, uaPub, auth); } catch (e) { dec2 = { text: 'HATA ' + e.message }; }
ok('Rastgele anahtar + Türkçe yük: Node ile çözme başarılı', dec2.text === msg, dec2.text);
const body2 = await encryptPayload(msg, uaPub, auth);
ok('Her şifrelemede salt ve efemer anahtar farklı', Buffer.compare(Buffer.from(body.subarray(0, 86)), Buffer.from(body2.subarray(0, 86))) !== 0);
let tooBig = false; try { await encryptPayload('x'.repeat(4000), uaPub, auth); } catch { tooBig = true; }
ok('4096 bayt kaydı aşan yük reddediliyor', tooBig);

/* ── 2) VAPID JWT ── */
const vk = await generateVapidKeys();
ok('VAPID açık anahtarı 65 bayt, 0x04 ile başlıyor', B(vk.publicKey).length === 65 && B(vk.publicKey)[0] === 4);
const jwt = await vapidJwt('https://web.push.apple.com', 'https://animsa.example.workers.dev', vk.privateJwk);
const [h, p, s] = jwt.split('.');
const pubKeyObj = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: vk.privateJwk.x, y: vk.privateJwk.y }, format: 'jwk' });
const verified = crypto.verify('sha256', Buffer.from(h + '.' + p), { key: pubKeyObj, dsaEncoding: 'ieee-p1363' }, B(s));
ok('VAPID JWT imzası açık anahtarla doğrulanıyor (Node crypto)', verified);
// Açık anahtar ham biçimden de aynı noktayı veriyor mu?
const rawPub = B(vk.publicKey);
ok('Ham açık anahtar JWK x/y ile tutarlı', b64uEncode(rawPub.subarray(1, 33)) === vk.privateJwk.x && b64uEncode(rawPub.subarray(33)) === vk.privateJwk.y);
const hdr = JSON.parse(B(h).toString()), pl = JSON.parse(B(p).toString());
const nowS = Math.floor(Date.now() / 1000);
ok('JWT başlığı ES256', hdr.alg === 'ES256' && hdr.typ === 'JWT');
ok('JWT aud = push origin, exp ≤ 12 saat, sub var', pl.aud === 'https://web.push.apple.com' && pl.exp - nowS <= 12 * 3600 && pl.exp > nowS && /^https:|^mailto:/.test(pl.sub));
const tampered = crypto.verify('sha256', Buffer.from(h + '.' + p + 'x'), { key: pubKeyObj, dsaEncoding: 'ieee-p1363' }, B(s));
ok('Değiştirilmiş JWT doğrulanmıyor', !tampered);

/* ── 3) Uç nokta güvenliği ── */
const allowed = ['https://web.push.apple.com/QGx', 'https://api.push.apple.com/x', 'https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://db5p.notify.windows.com/w/?token=x'];
const denied = ['http://web.push.apple.com/x', 'https://evil.com/web.push.apple.com', 'https://web.push.apple.com.evil.com/x', 'https://push.apple.com.evil/x', 'https://localhost/x', 'https://169.254.169.254/', 'https://fcm.googleapis.com:8443/x', 'https://user:pw@fcm.googleapis.com/x', 'javascript:alert(1)', 'https://evilpush.apple.com/x'];
ok('İzinli push alan adları kabul ediliyor', allowed.every(isAllowedEndpoint));
ok('Diğer tüm adresler reddediliyor', denied.every(u => !isAllowedEndpoint(u)), denied.filter(isAllowedEndpoint).join(','));
ok('Geçerli abonelik temizleniyor', !!cleanSubscription({ endpoint: allowed[0], keys: { p256dh: uaPub, auth }, expirationTime: null }));
ok('Bozuk anahtarlı abonelik reddediliyor', !cleanSubscription({ endpoint: allowed[0], keys: { p256dh: 'abc', auth } }) && !cleanSubscription({ endpoint: allowed[0] }) && !cleanSubscription(null));
ok('SHA-256 özeti', (await sha256Hex('abc')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
let badB64 = false; try { b64uDecode('a b'); } catch { badB64 = true; }
ok('Geçersiz base64url reddediliyor', badB64);

console.log(`\nKripto: ${pass}/${pass + fail} geçti`);
process.exit(fail ? 1 : 0);
