/* ════════════════════════════════════════════════════════════════
   ANIMSA — Türkçe anlama motoru (kural tabanlı, internetsiz)
   parse(metin, şimdi) → { zaman, görev, saatBelirtildiMi, güven, ... }
   Bu dosya hem tarayıcıda (derlemede gömülür) hem Node testlerinde çalışır.
   ════════════════════════════════════════════════════════════════ */

const TR = 'tr-TR';

/* ── Sözlükler ─────────────────────────────────────────────── */
const UNITS = { bir: 1, iki: 2, 'üç': 3, 'dört': 4, 'dörd': 4, 'beş': 5, 'altı': 6, yedi: 7, sekiz: 8, dokuz: 9 };
const TENS = { on: 10, yirmi: 20, otuz: 30, 'kırk': 40, elli: 50 };
// Sayı sözcüklerinin alabileceği ekler (uzundan kısaya)
const NUM_SUFFIXES = ['ında', 'inde', 'unda', 'ünde', 'sında', 'sinde', 'sinda', 'sına', 'sine', 'yı', 'yi', 'yu', 'yü', 'ya', 'ye', 'da', 'de', 'ta', 'te', 'dan', 'den', 'tan', 'ten', 'sı', 'si', 'su', 'sü', 'a', 'e', 'ı', 'i', 'u', 'ü'];
const LOC = new Set(['de', 'da', 'te', 'ta']); // bulunma eki: "7'de", "yedide"
const DAT = new Set(['a', 'e', 'ya', 'ye']); // yönelme eki: "bire", "ona"
const ACC = new Set(['ı', 'i', 'u', 'ü', 'yı', 'yi', 'yu', 'yü']); // belirtme eki: "dokuzu"

const WEEKDAYS = [ // uzun adlar önce (cumartesi > cuma, pazartesi > pazar)
  ['pazartesi', 1], ['cumartesi', 6], ['çarşamba', 3], ['perşembe', 4], ['salı', 2], ['cuma', 5], ['pazar', 0]
];
const WD_SUFFIX = new Set(['', 'ya', 'ye', 'a', 'e', 'da', 'de', 'ta', 'te', 'yı', 'yi', 'ı', 'i', 'ki', 'dan', 'den', 'ye kadar']);
const MONTHS = ['ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran', 'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık'];
const MONTH_SUFFIX = new Set(['', 'ta', 'da', 'te', 'de', 'ın', 'in', 'un', 'ün', 'ında', 'inde', 'unda', 'ünde', 'a', 'e', 'ya', 'ye']);

// Gün bölümleri → [anahtar, varsayılan saat]
const PERIODS = {
  sabah: 'sabah', sabahleyin: 'sabah', sabaha: 'sabah', sabahki: 'sabah', 'sabahın': 'sabah',
  'öğle': 'oglen', 'öğlen': 'oglen', 'öğleyin': 'oglen', 'öğlene': 'oglen', 'öğleye': 'oglen',
  ikindi: 'ikindi', ikindiye: 'ikindi', ikindide: 'ikindi',
  'akşam': 'aksam', 'akşamleyin': 'aksam', 'akşama': 'aksam', 'akşamüstü': 'aksamustu', 'akşamüzeri': 'aksamustu', 'akşamki': 'aksam', 'akşamın': 'aksam',
  gece: 'gece', geceleyin: 'gece', geceye: 'gece', 'gecenin': 'gece'
};
const PERIOD_DEFAULT = { sabah: 9, oglen: 12, ogleden: 15, ikindi: 16, aksamustu: 18, aksam: 20, gece: 22 };

// Dolgu sözcükleri: kenarlardan temizlenir
const EDGE_FILLERS = new Set(['dair', 'ilgili', 'hakkında', 'saat', 'bana', 'beni', 'bunu', 'şunu', 'lütfen', 'kur', 'de', 'da', 've', 'için', 'olarak', 'sonra', 'tarihinde', 'hatırlatıcı', 'hatırlatma', 'hatırlatması', 'alarm', 'kadar', 'ile', 'ki', 'mi', 'mı']);
// Tek başına bir yan cümle oluşturduklarında atılan rica sözcükleri ("bana bunu hatırlatır mısın")
const META_WORDS = new Set(['bana', 'beni', 'bunu', 'şunu', 'onu', 'bunları', 'lütfen', 'unutma', 'unutmayayım', 'unutturma', 'sakın', 'tamam', 'olur', 'mu', 'mı', 'mi', 'mü', 'musun', 'mısın', 'misin', 'de', 'da', 'ki', 've', 'yap', 'kur', 'alarm', 'not', 'al', 'et', 'eder', 'edebilir', 'etsene', 'hadi', 'acaba', 'benim', 'için', 'teşekkürler', 'sağol', 'sağ', 'ol']);
// Her yerden silinen sözcükler
const ANY_FILLERS = new Set(['hatırlat', 'hatırlatır', 'hatırlatsana', 'hatırlatırmısın', 'hatırlatırsın', 'hatırlatıver', 'mısın', 'misin', 'lütfen', 'hatırlatıcı', 'hatırlatıcısı', 'hatırlatma', 'hatırlatmayı', 'unutturma', 'kur']);

/* ── Yardımcılar ───────────────────────────────────────────── */
function lower(s) { return String(s).toLocaleLowerCase(TR); }

/** Bir sözcüğü karşılaştırma için normalleştirir. */
function norm(raw) {
  let s = lower(raw);
  s = s.replace(/[’‘'`´"“”«»]/g, '');          // kesme ve tırnaklar
  s = s.replace(/^[(\[{,;!?¡¿…-]+/, '').replace(/[)\]},;!?…]+$/, '');
  s = s.replace(/\.+$/, '');                      // sondaki nokta
  return s;
}

/** Ekli sözcükten kök + ek ayırır (kök sözlükte varsa). */
function splitSuffix(tok, dict) {
  if (Object.prototype.hasOwnProperty.call(dict, tok)) return { base: tok, suffix: '' };
  for (const suf of NUM_SUFFIXES) {
    if (tok.length > suf.length && tok.endsWith(suf)) {
      const base = tok.slice(0, -suf.length);
      if (Object.prototype.hasOwnProperty.call(dict, base)) return { base, suffix: suf };
    }
  }
  return null;
}

const ALLNUM = Object.assign({}, UNITS, TENS, { 'yarım': 0.5 });

/**
 * i konumundaki sözcüklerden bir sayı okur.
 * Desteklenen: "7", "14:30", "7de", "yedi", "yedide", "on iki", "onikide", "yirmi beş", "yarım".
 * Dönüş: { val, min (varsa dakika), len, suffix, word (sözcükle mi yazıldı), colon }
 */
function readNumber(T, i) {
  const t = T[i];
  if (!t) return null;
  const n = t.n;
  // Rakam: 7, 14:30, 14.30, 7de, 14:00te, 1,5
  let m = n.match(/^(\d{1,2})(?:([:.,])(\d{1,2}))?([a-zçğıöşü]*)$/);
  if (m) {
    const r = { val: +m[1], len: 1, suffix: m[4] || '', word: false, sep: m[2] || '', lead0: m[1].length === 2 && m[1][0] === '0' };
    if (m[3] !== undefined) { r.min = m[3].length === 2 ? +m[3] : null; r.frac = +('0.' + m[3]); }
    return r;
  }
  // Sözcük: önce iki sözcüklü bileşik (on iki, yirmi beş)
  const a = splitSuffix(n, ALLNUM);
  if (a && TENS[a.base] && !a.suffix && T[i + 1]) {
    const b = splitSuffix(T[i + 1].n, UNITS);
    if (b) return { val: TENS[a.base] + UNITS[b.base], len: 2, suffix: b.suffix, word: true };
  }
  if (a) return { val: ALLNUM[a.base], len: 1, suffix: a.suffix, word: true };
  // Bitişik bileşik: onbir, yirmibeş, onikide
  for (const ten of Object.keys(TENS)) {
    if (n.startsWith(ten) && n.length > ten.length) {
      const b = splitSuffix(n.slice(ten.length), UNITS);
      if (b) return { val: TENS[ten] + UNITS[b.base], len: 1, suffix: b.suffix, word: true };
    }
  }
  return null;
}

function isBucuk(tok) { return tok && /^buçu(k|ğ)(ta|a|u|tan)?$/.test(tok.n); }
function bucukSuffix(tok) { const m = tok.n.match(/^buçu(?:k|ğ)(ta|a|u|tan)?$/); return m ? (m[1] || '') : ''; }

function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()); }
function atTime(day, h, m) { return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0); }

/* ── Ana fonksiyon ─────────────────────────────────────────── */
export function parse(metin, simdi) {
  const now = simdi instanceof Date ? new Date(simdi.getTime()) : new Date(simdi == null ? Date.now() : simdi);
  const text = String(metin == null ? '' : metin)
    .replace(/\s+/g, ' ')
    .replace(/(\d)\s*([:.])\s*(\d{2})\b/g, '$1$2$3') // "14 : 30" → "14:30"
    .trim();
  const T = text ? text.split(' ').map(raw => ({ raw, n: norm(raw), used: false })) : [];
  const use = (i, len) => { for (let k = i; k < i + len && k < T.length; k++) T[k].used = true; };
  const free = i => T[i] && !T[i].used;

  let relMs = null;          // dakika/saat cinsinden göreli süre
  let leadMin = 0;           // "15 dakika önce (de) hatırlat" → önceden uyarı (dakika)
  let relDays = null;        // gün/hafta/ay cinsinden göreli süre
  let date = null;           // { kind: 'offset'|'weekday'|'abs'|'monthEnd', ... }
  let period = null;         // sabah | oglen | ogleden | ikindi | aksam | aksamustu | gece
  let clock = null;          // { h, m }
  let midnight = false;      // "gece yarısı"

  /* ── 1) Göreli süreler: "20 dk sonra", "bir buçuk saat sonra", "yarım saat içinde", "bir saate" ── */
  const UNIT_RE = /^(saniye|sn|dakika|dakka|dak|dk|saat|sa|gün|hafta|ay)(ya|ye|a|e|lık|lik)?$/;
  const unitOf = w => {
    const m = w.match(UNIT_RE); if (!m) return null;
    const u = m[1];
    const k = (u === 'saniye' || u === 'sn') ? 'sn' : (u === 'saat' || u === 'sa') ? 'saat' : (u === 'gün' || u === 'hafta' || u === 'ay') ? u : 'dk';
    return { unit: k, dative: m[2] === 'a' || m[2] === 'e' || m[2] === 'ya' || m[2] === 'ye' };
  };
  for (let i = 0; i < T.length; i++) {
    if (!free(i)) continue;
    let j = i, total = { ms: 0, days: 0 }, parts = 0, terminal = false;
    while (j < T.length) {
      let qty = null, qlen = 0;
      const tok = T[j];
      // "20dk", "2saat" bitişik yazım
      const glued = tok.n.match(/^(\d+(?:[.,]\d+)?)(dk|dakika|sa|saat|gün)(ya|ye|a|e)?$/);
      if (glued) {
        const u = unitOf(glued[2] + (glued[3] || ''));
        const q = parseFloat(glued[1].replace(',', '.'));
        addDur(total, q, u.unit); parts++; j++;
        if (u.dative) { terminal = true; break; }
        continue;
      }
      if (tok.n === 'çeyrek') { qty = 0.25; qlen = 1; }
      else {
        const num = readNumber(T, j);
        if (num && !num.suffix && num.val > 0 && (!num.sep || num.sep === '.' || num.sep === ',')) {
          qty = num.sep ? num.val + (num.frac || 0) : num.val; qlen = num.len;
          if (num.word && num.val === 0.5) qty = 0.5; // yarım
          if (isBucuk(T[j + qlen]) && !bucukSuffix(T[j + qlen])) { qty += 0.5; qlen++; }
        }
      }
      if (qty == null) break;
      const ut = T[j + qlen] && unitOf(T[j + qlen].n);
      if (!ut) break;
      // "saat 2" (saat kalıbı) ile karışmasın: sayı + birim sırası şart
      addDur(total, qty, ut.unit); parts++;
      j += qlen + 1;
      if (ut.dative) { terminal = true; break; }
      // "1 saat 20 dakika sonra" gibi zincirleme
    }
    if (!parts) continue;
    const nx = T[j] && T[j].n;
    if (!terminal && (nx === 'sonra' || nx === 'içinde' || nx === 'içerisinde' || nx === 'sonrası' || nx === 'zarfında')) { terminal = true; j++; }
    if (!terminal && nx === 'geçince') { terminal = true; j++; }
    // "15 dakika önce", "yarım saat önceden", "1 gün evvel" → süre değil, önceden uyarı
    if (!terminal && (nx === 'önce' || nx === 'önceden' || nx === 'evvel' || nx === 'evvelden')) {
      use(i, j - i + 1);
      leadMin = Math.round((total.ms + total.days * 86400000) / 60000);
      i = j;
      continue;
    }
    if (!terminal) continue;
    use(i, j - i);
    if (total.ms) relMs = (relMs || 0) + total.ms;
    if (total.days) relDays = (relDays || 0) + total.days;
    i = j - 1;
  }
  function addDur(acc, q, unit) {
    if (unit === 'sn') acc.ms += q * 1000;
    else if (unit === 'dk') acc.ms += q * 60000;
    else if (unit === 'saat') acc.ms += q * 3600000;
    else if (unit === 'gün') acc.days += Math.round(q);
    else if (unit === 'hafta') acc.days += Math.round(q * 7);
    else if (unit === 'ay') acc.days += Math.round(q * 30);
  }

  /* ── 2) Tarihler ── */
  for (let i = 0; i < T.length; i++) {
    if (!free(i)) continue;
    const n = T[i].n, n1 = T[i + 1] && free(i + 1) ? T[i + 1].n : '';
    if (n === 'bugün' || n === 'bugun') { date = { kind: 'offset', days: 0, today: true }; use(i, 1); continue; }
    if (n === 'yarından' && n1 === 'sonra') { date = { kind: 'offset', days: 2 }; use(i, 2); continue; }
    if (n === 'yarın' || n === 'yarin') { date = { kind: 'offset', days: 1 }; use(i, 1); continue; }
    if (n === 'öbürgün' || n === 'öbür' && (n1 === 'gün' || n1 === 'güne')) { date = { kind: 'offset', days: 2 }; use(i, n === 'öbürgün' ? 1 : 2); continue; }
    if (n === 'ertesi' && (n1 === 'gün' || n1 === 'güne')) { date = { kind: 'offset', days: 2 }; use(i, 2); continue; }
    // "haftaya salı", "gelecek hafta cuma", "haftaya"
    let nextWeek = false, k = i;
    if (n === 'haftaya') { nextWeek = true; k = i + 1; }
    else if ((n === 'gelecek' || n === 'önümüzdeki' || n === 'sonraki') && n1 === 'hafta') { nextWeek = true; k = i + 2; }
    else if (n === 'bu' && n1) { k = i + 1; }
    const wd = T[k] && free(k) ? weekdayOf(T[k].n) : null;
    if (wd != null) {
      let len = k - i + 1;
      if (T[k + 1] && /^gün(ü|ün|e|ünde)?$/.test(T[k + 1].n)) len++;
      date = { kind: 'weekday', wd, nextWeek };
      use(i, len); continue;
    }
    if (n === 'bu' && n1 && PERIODS[n1]) { date = { kind: 'offset', days: 0, today: true }; use(i, 1); continue; }
    if (nextWeek) { date = { kind: 'offset', days: 7 }; use(i, k - i); continue; }
    // "ayın 20'si", "ayın 20sinde", "ayın sonunda"
    if (n === 'ayın' && T[i + 1]) {
      if (/^son(u|unda|una)$/.test(n1)) { date = { kind: 'monthEnd' }; use(i, 2); continue; }
      const num = readNumber(T, i + 1);
      if (num && !num.word && num.val >= 1 && num.val <= 31) { date = { kind: 'abs', d: num.val, m: null }; use(i, 2); continue; }
    }
    // "3 Aralık", "3 aralıkta", "3 Aralık 2027"
    const num = readNumber(T, i);
    if (num && num.val >= 1 && num.val <= 31 && num.min == null && !num.suffix && T[i + 1]) {
      const mo = monthOf(T[i + 1].n);
      if (mo != null) {
        let len = 2, y = null;
        const ym = T[i + 2] && T[i + 2].n.match(/^(20\d\d)([a-zçğıöşü]*)$/);
        if (ym) { y = +ym[1]; len = 3; }
        date = { kind: 'abs', d: num.val, m: mo, y }; use(i, len); continue;
      }
    }
    // "15/12", "15/12/2026", "15.12" (soneksiz ve "saat" öncesi değilse tarih)
    const dm = n.match(/^(\d{1,2})([./-])(\d{1,2})(?:\2(\d{2,4}))?([a-zçğıöşü]*)$/);
    if (dm) {
      const d = +dm[1], mo = +dm[3], sep = dm[2];
      const prevSaat = i > 0 && T[i - 1].n === 'saat';
      const looksDate = sep === '/' || sep === '-' || dm[4] || (!dm[5] && !prevSaat && mo >= 1 && mo <= 12 && !(T[i + 1] && /^(buçuk|sonra)/.test(T[i + 1].n)));
      if (looksDate && d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
        let y = dm[4] ? +dm[4] : null; if (y != null && y < 100) y += 2000;
        date = { kind: 'abs', d, m: mo - 1, y }; use(i, 1); continue;
      }
    }
  }
  function weekdayOf(w) {
    for (const [name, idx] of WEEKDAYS) {
      if (w.startsWith(name) && WD_SUFFIX.has(w.slice(name.length))) return idx;
    }
    return null;
  }
  function monthOf(w) {
    for (let k = 0; k < MONTHS.length; k++) {
      if (w.startsWith(MONTHS[k]) && MONTH_SUFFIX.has(w.slice(MONTHS[k].length))) return k;
    }
    return null;
  }

  /* ── 3) Gün bölümleri ve saatler ── */
  // Bir sayının saat olarak okunması (buçuk dahil). Dönüş: { h, m, len } | null
  const readClock = (i, needSuffix) => {
    const num = readNumber(T, i);
    if (!num || !free(i)) return null;
    if (num.word && num.val === 0.5) { // "yarımda" = 12:30
      if (LOC.has(num.suffix) || !needSuffix) return { h: 12, m: 30, len: num.len, suffix: num.suffix };
      return null;
    }
    let h = num.val, m = 0, len = num.len, suffix = num.suffix;
    if (num.sep === ':' || num.sep === '.') {
      if (num.min == null) return null;
      m = num.min;
    } else if (num.sep) return null;
    // "yedi buçukta", "7 buçukta"
    if (!suffix && num.min == null && isBucuk(T[i + len]) && free(i + len)) {
      suffix = bucukSuffix(T[i + len]); m = 30; len++;
    } else if (num.word && !suffix && T[i + len] && free(i + len) && !num.sep) {
      // "saat on dört otuzda" → dakika sözcükle
      const mm = readNumber(T, i + len);
      if (mm && mm.word && mm.val >= 10 && mm.val < 60 && (mm.val % 10 === 0 || mm.len === 2) && needSuffix === false) {
        m = mm.val; suffix = mm.suffix; len += mm.len;
      }
    }
    if (needSuffix && !LOC.has(suffix) && num.sep !== ':') return null;
    if (h > 24 || m > 59 || !Number.isInteger(h)) return null;
    if (h === 24) h = 0;
    // ayrık yazılmış ek: "15:00 de"
    if (!suffix && T[i + len] && free(i + len) && LOC.has(T[i + len].n)) len++;
    return { h, m, len, suffix, literal: !!num.lead0 && num.sep === ':' };
  };

  for (let i = 0; i < T.length; i++) {
    if (!free(i)) continue;
    const n = T[i].n, n1 = T[i + 1] ? T[i + 1].n : '';
    // "gece yarısı"
    if (n === 'gece' && /^yarısı(na|nda)?$/.test(n1)) { midnight = true; period = 'gece'; use(i, 2); continue; }
    // "öğleden sonra"
    if (n === 'öğleden' && n1 === 'sonra') { period = 'ogleden'; use(i, 2); tryClockAfter(i + 2); continue; }
    if (PERIODS[n]) {
      // "öğle yemeği", "akşam namazı": sözcük görevin parçası, yine de gün bölümü bilgisini al
      if (/^(yemeğ|yemek|namaz|ara(sı|sında)?$|mesai|vardiya|haber|yürüyüş|kahvaltı)/.test(n1)) { if (!period) period = PERIODS[n]; continue; }
      period = PERIODS[n]; use(i, 1); tryClockAfter(i + 1); continue;
    }
    // "saat 14:00", "saat yedide", "saat 3"
    if (n === 'saat' || n === 'saatte' || n === 'saati') {
      if (tryGeceVar(i + 1, i)) continue;
      const c = readClock(i + 1, false);
      if (c) { clock = { h: c.h, m: c.m, literal: c.literal }; use(i, 1 + c.len); i += c.len; continue; }
    }
    // "dokuzu çeyrek geçe", "ona çeyrek var"
    if (tryGeceVar(i, i)) continue;
    // "14:30", "14:30da", "7de", "yedide"
    const num = readNumber(T, i);
    if (num && (num.sep === ':' || ((num.sep === '.') && (LOC.has(num.suffix) || (i > 0 && T[i - 1].n === 'saat'))) || LOC.has(num.suffix) || isBucuk(T[i + num.len]) && (LOC.has(bucukSuffix(T[i + num.len]))))) {
      const c = readClock(i, num.sep !== ':');
      if (c && clock == null) { clock = { h: c.h, m: c.m, literal: c.literal }; use(i, c.len); i += c.len - 1; continue; }
    }
  }
  function tryClockAfter(i) {
    if (clock) return;
    let k = i;
    if (T[k] && free(k) && T[k].n === 'saat') k++;
    if (tryGeceVar(k, i)) return;
    const c = readClock(k, false);
    if (c) { clock = { h: c.h, m: c.m, literal: c.literal }; use(i, k - i + c.len); }
  }
  // "X-i Y geçe" ve "X-e Y var/kala"
  function tryGeceVar(i, from) {
    const hn = readNumber(T, i);
    if (!hn || !free(i) || hn.sep) return false;
    let k = i + hn.len, mins = null, mlen = 0;
    if (T[k] && T[k].n === 'çeyrek') { mins = 15; mlen = 1; }
    else { const mn = readNumber(T, k); if (mn && !mn.suffix && !mn.sep && mn.val > 0 && mn.val < 60) { mins = mn.val; mlen = mn.len; } }
    if (mins == null || !T[k + mlen]) return false;
    const w = T[k + mlen].n;
    if (w === 'geçe' && (ACC.has(hn.suffix) || !hn.suffix)) {
      clock = { h: hn.val % 24, m: mins }; use(from, k + mlen + 1 - from); return true;
    }
    if ((w === 'var' || w === 'kala') && (DAT.has(hn.suffix) || !hn.suffix)) {
      clock = { h: (hn.val + 23) % 24, m: 60 - mins }; use(from, k + mlen + 1 - from); return true;
    }
    return false;
  }

  /* ── 4) Zamanı hesapla ── */
  let zaman, saatBelirtildiMi = true, rolled = false, guven;
  const today = startOfDay(now);

  if (relMs != null && relDays == null && !date) {
    // Tam dakikaya yuvarla: zamanlayıcı dakika başında çalışır, ekranda yazan dakika = bildirimin geleceği dakika
    zaman = roundToMinute(now.getTime() + relMs, now.getTime());
    guven = 0.95;
  } else {
    // Gün tabanı
    let day = today, implicitToday = true, kind = 'today';
    if (relDays != null) { day = addDays(today, relDays); implicitToday = false; kind = 'rel'; }
    if (date) {
      if (date.kind === 'offset') { day = addDays(today, date.days); implicitToday = !!date.today || date.days === 0; kind = date.days ? 'offset' : 'today'; }
      else if (date.kind === 'weekday') {
        let diff = (date.wd - now.getDay() + 7) % 7;
        if (date.nextWeek) {
          // haftaya: bir sonraki takvim haftası (Pazartesi başlangıçlı)
          const mondayIdx = d => (d + 6) % 7;
          diff = 7 - mondayIdx(now.getDay()) + mondayIdx(date.wd);
        }
        day = addDays(today, diff); implicitToday = false; kind = date.nextWeek ? 'nextweek' : 'weekday';
      } else if (date.kind === 'abs') {
        const y = date.y || now.getFullYear();
        const mo = date.m == null ? now.getMonth() : date.m;
        day = new Date(y, mo, Math.min(date.d, new Date(y, mo + 1, 0).getDate()));
        implicitToday = false; kind = date.m == null ? 'monthday' : (date.y ? 'absy' : 'abs');
      } else if (date.kind === 'monthEnd') {
        day = new Date(now.getFullYear(), now.getMonth() + 1, 0); implicitToday = false; kind = 'monthend';
      }
    }
    if (relMs != null) { // "3 gün sonra" + "2 saat sonra" birleşimi gibi nadir durumlar
      zaman = new Date(day.getTime() + (now.getTime() - today.getTime()) + relMs);
      guven = 0.8;
    } else {
      let h, m;
      if (midnight) { h = 0; m = 0; day = addDays(day, 1); }
      else if (clock) {
        ({ h, m } = clock);
        const r = clock.literal ? { h } : resolveHour(h, period, implicitToday);
        h = r.h; if (r.nextDay) day = addDays(day, 1);
      } else if (period) {
        h = PERIOD_DEFAULT[period]; m = 0;
        saatBelirtildiMi = period === 'oglen';
      } else { h = 9; m = 0; saatBelirtildiMi = false; }
      zaman = atTime(day, h, m);

      // Geçmişte kaldıysa ileri at
      if (zaman.getTime() <= now.getTime()) {
        if (clock && !clock.literal && !period && implicitToday && clock.h >= 7 && clock.h <= 11) {
          const pm = atTime(day, clock.h + 12, clock.m); // önce akşam dene
          if (pm.getTime() > now.getTime()) zaman = pm; else { zaman = addDays(zaman, 1); rolled = true; }
        } else if (implicitToday || kind === 'offset' && date && date.days === 0) { zaman = addDays(zaman, 1); rolled = true; }
        else if (kind === 'weekday') zaman = addDays(zaman, 7);
        else if (kind === 'abs') zaman = new Date(zaman.getFullYear() + 1, zaman.getMonth(), zaman.getDate(), zaman.getHours(), zaman.getMinutes());
        else if (kind === 'monthday') zaman = new Date(zaman.getFullYear(), zaman.getMonth() + 1, zaman.getDate(), zaman.getHours(), zaman.getMinutes());
      }
      guven = clock || midnight ? 0.9 : (date || relDays != null) ? 0.65 : period ? 0.6 : 0.25;
    }
  }

  /* ── 5) Görev metni ── */
  // Yan cümlelere böl (. , ; ! ? sonrası); yalnızca rica sözcüklerinden oluşanları at:
  // "Su içmem gerekiyor. Bana bunu hatırlat." → "Su içmem gerekiyor"
  // (Sözcükler indeksle izlenir: arayüz her sözcüğün türünü — zaman / görev / dolgu — bilerek vurgular.)
  const clauses = [[]];
  T.forEach((t, i) => {
    if (!t.used) clauses[clauses.length - 1].push(i);
    if (/[.,;!?…]["'’”]*$/.test(t.raw) && clauses[clauses.length - 1].length) clauses.push([]);
  });
  const REQ = /^hatırla/;   // hatırlat, hatırla, hatırlar (Whisper bazen "hatırlat"ı "hatırlar" yazar), hatırlatır mısın…
  const isMeta = i => { const n = T[i].n; return META_WORDS.has(n) || REQ.test(n) || n === ''; };
  let keep = [].concat(...clauses.filter(c => c.length && !c.every(isMeta)));
  keep = keep.filter(i => !ANY_FILLERS.has(T[i].n) && !REQ.test(T[i].n));
  const edge = i => EDGE_FILLERS.has(T[i].n) || T[i].n === '';
  while (keep.length && edge(keep[0])) keep.shift();
  while (keep.length && edge(keep[keep.length - 1])) keep.pop();
  const kept = new Set(keep);
  const turler = T.map((t, i) => t.used ? 'zaman' : kept.has(i) ? 'görev' : 'dolgu');
  // Uygulama sana sesleniyormuş gibi yaz: "kulaklığımı alacağımı hatırlat" → "Kulaklığını al"
  const asked = T.some(t => !t.used && REQ.test(t.n));
  const words = toSecondPerson(keep.map(i => T[i].raw), asked);
  let gorev = words.join(' ').replace(/^[\s,.;:–—-]+|[\s,.;:!?–—-]+$/g, '').replace(/\s+([,;])/g, '$1').trim();
  if (gorev) gorev = gorev.charAt(0).toLocaleUpperCase(TR) + gorev.slice(1);
  if (!gorev) gorev = 'Hatırlatıcı';
  if (gorev.length > 200) gorev = gorev.slice(0, 200).trim();

  return {
    zaman,
    görev: gorev,
    saatBelirtildiMi,
    güven: Math.round(guven * 100) / 100,
    yarinaAtildi: rolled,
    sözcükTürleri: turler,
    öncedenDk: leadMin > 0 && leadMin <= 7 * 1440 ? leadMin : 0,
    varsayilanSaat: !saatBelirtildiMi ? pad2(zaman.getHours()) + ':' + pad2(zaman.getMinutes()) : null
  };

  // 12 saat kuralı
  function resolveHour(h, per, implicit) {
    if (h >= 13) return { h };
    switch (per) {
      case 'sabah': return { h: h === 12 ? 0 : h };
      case 'oglen': return { h: h === 12 ? 12 : h <= 5 ? h + 12 : h };
      case 'ogleden': case 'ikindi': case 'aksamustu': return { h: h < 12 ? h + 12 : h };
      case 'aksam': return h === 12 ? { h: 0, nextDay: true } : { h: h < 12 ? h + 12 : h };
      case 'gece':
        if (h === 12 || h === 0) return { h: 0, nextDay: true };
        if (h <= 5) return implicit ? { h } : { h, nextDay: true };
        return { h: h + 12 >= 24 ? h : h + 12 };
      default:
        if (h === 12 || h === 0) return { h };
        if (h >= 1 && h <= 6) return { h: h + 12 };
        return { h }; // 7–11: sabah (geçmişse yukarıda akşama çevrilir)
    }
  }
}

function pad2(n) { return String(n).padStart(2, '0'); }

/* ── Görev metnini ikinci tekil kişiye çevirme ──
   1) Son fiil emir kipine döner:  arayacağım → ara · içmem gerekiyor → iç · içmemi hatırlat → iç · almayı unutma → al
   2) "Benim" ekleri "senin"e döner: annemi → anneni · kulaklığımı → kulaklığını · toplantım var → toplantın var */
const NOMINAL = ['acağımızı', 'eceğimizi', 'acağımıza', 'eceğimize', 'acağımı', 'eceğimi', 'acağıma', 'eceğime', 'acağını', 'eceğini', 'maya', 'meye', 'masını', 'mesini', 'mamızı', 'memizi', 'mamı', 'memi', 'mayı', 'meyi'];
const FUTURE1 = ['malıyım', 'meliyim', 'malıyız', 'meliyiz', 'acağım', 'eceğim', 'acağız', 'eceğiz'];
const NEED1 = ['mamız', 'memiz', 'mam', 'mem'];
const NEED_WORDS = new Set(['lazım', 'lazim', 'gerek', 'gerekiyor', 'gerekli', 'şart']);
const SOFT = { gid: 'git', ed: 'et', did: 'dit', tad: 'tat', güd: 'güt' };
const PRONOUN2 = { benim: 'senin', beni: 'seni', bende: 'sende', benden: 'senden', benimle: 'seninle', bizim: 'sizin', bizi: 'sizi' };
// Sonu zaten "-m" ile biten (iyelik olmayan) sözcükler: bunlara ve çekimlerine dokunulmaz
const POSS_EXCEPT = ['akşam', 'program', 'tamam', 'tam', 'hem', 'kim', 'resim', 'isim', 'film', 'kalem', 'gram', 'kilogram', 'devam', 'bayram', 'adam', 'selam', 'sistem', 'problem', 'ödem', 'yem', 'dam', 'çim', 'kum', 'durum', 'kurum', 'tüm', 'hüküm', 'doğum', 'ölüm', 'bölüm', 'çözüm', 'giyim', 'yatırım', 'kullanım', 'hekim', 'bilim', 'ilim', 'albüm', 'forum', 'hamam', 'imam', 'haram', 'kadim', 'madem', 'gizem', 'ekim', 'kasım', 'katım', 'üzüm', 'yağım', 'islam', 'rom', 'ham', 'dem', 'gem', 'cem', 'kerem', 'erdem', 'kazım', 'hakim', 'muhtem', 'sınav', 'alım', 'satım', 'kayım', 'gerçek',
  'sunum', 'seçim', 'ölçüm', 'yapım', 'bakım', 'tüketim', 'üretim', 'eğitim', 'iletişim', 'gelişim', 'değişim', 'yorum', 'anlatım', 'gemi', 'kimi', 'yemi', 'kimse', 'mum', 'ilham', 'mesaj', 'prim', 'rejim', 'dram', 'drum', 'pijama', 'sinema', 'tema', 'dilim', 'kesim', 'birim', 'görüşüm', 'algım', 'nizam', 'kalım', 'vazgeçim', 'teslim', 'muayene'];
const FRONT = new Set(['e', 'i', 'ö', 'ü']), ROUND = new Set(['o', 'u', 'ö', 'ü']);
/** Ek ünlüsü kendinden önceki ünlüyle uyumlu mu? (iyelik + hâl ekinde zorunlu: anneme ✓, sinema ✗) */
function harmonic(prev, v) {
  if (FRONT.has(prev) !== FRONT.has(v)) return false;
  if ('ıiuü'.includes(v)) return ROUND.has(prev) === ROUND.has(v);
  return true;
}
const CASE_ONLY = /^(ı|i|u|ü|a|e|da|de|ta|te|dan|den|tan|ten|la|le|ın|in|un|ün|ya|ye|yı|yi|yla|yle|ki|lar|ler|ları|leri|ları|lara|lere)?$/;
const splitTail = w => { const m = String(w).match(/^(.*?)([.,!?;:…]*)$/); return [m[1], m[2]]; };

/** Fiil ekini kaldırıp emir kökünü döndürür; ek yoksa null. */
function verbStem(word, suffixes) {
  const [body, tail] = splitTail(word);
  const low = lower(body);
  for (const suf of suffixes) {
    if (low.length > suf.length + 1 && low.endsWith(suf)) {
      let stem = body.slice(0, body.length - suf.length);
      const ls = lower(stem);
      if (SOFT[ls]) stem = SOFT[ls];
      else if (/[aeıioöuü]y$/.test(ls)) stem = stem.slice(0, -1);     // arayacağım → ara, yıkayacağımı → yıka
      if (stem.length < 2) return null;
      return stem + tail;
    }
  }
  return null;
}
export function toImperative(word) { return verbStem(word, NOMINAL) || word; }

/** Birinci tekil iyelik ekini ikinciye çevirir: annemi → anneni, kulaklığımı → kulaklığını. */
function possessive2(word) {
  if (/['’]/.test(word)) return word;                     // özel ad: Ahmet'le, Ayşe'ye
  const [body, tail] = splitTail(word);
  const low = lower(body);
  if (PRONOUN2[low]) { const r = PRONOUN2[low]; return (body[0] !== low[0] ? r[0].toLocaleUpperCase(TR) + r.slice(1) : r) + tail; }
  if (low.length < 3 || /\d/.test(low)) return word;
  // İstisna sözcüğün kendisi ya da yalnızca hâl/çoğul eki almış biçimi (akşama, programı) değişmez; iyelikli biçimi (kalemimi) değişir
  if (POSS_EXCEPT.some(r => low.startsWith(r) && CASE_ONLY.test(low.slice(r.length)))) return word;
  const m = low.match(/^(.*[aeıioöuü])m(ı|i|u|ü|a|e|da|de|ta|te|dan|den|tan|ten|la|le|ın|in|un|ün|(?:ler|lar)(?:e|a|i|ı|in|ın|de|da|den|dan|le|la)?)?$/);
  if (!m) return word;
  const prevV = m[1][m[1].length - 1];
  if (m[2]) { const sv = m[2].match(/[aeıioöuü]/)[0]; if (!harmonic(prevV, sv)) return word; }
  const k = m[1].length;                                   // değişecek "m"nin yeri
  return body.slice(0, k) + (body[k] === 'M' ? 'N' : 'n') + body.slice(k + 1) + tail;
}

export function toSecondPerson(words, asked) {
  const w = words.slice();
  if (!w.length) return w;
  let verbAt = -1;
  const n = () => w.length;
  const normLast = () => norm(w[n() - 1]);
  // a) "su içmem gerekiyor" → "su iç"
  if (n() >= 2 && NEED_WORDS.has(normLast())) {
    const v = verbStem(w[n() - 2], NEED1);
    if (v) { w.pop(); w[n() - 1] = v; verbAt = n() - 1; }
  }
  // b) "annemi arayacağım" → "annemi ara"
  if (verbAt < 0) { const v = verbStem(w[n() - 1], FUTURE1); if (v) { w[n() - 1] = v; verbAt = n() - 1; } }
  // c) "ekmek almayı unutma" → "ekmek al"
  if (verbAt < 0 && n() >= 2 && normLast() === 'unutma') {
    const v = verbStem(w[n() - 2], NOMINAL);
    if (v) { w.pop(); w[n() - 1] = v; verbAt = n() - 1; }
  }
  // d) "kulaklığımı alacağımı hatırlat" → "kulaklığımı al"
  if (verbAt < 0 && asked) { const v = verbStem(w[n() - 1], NOMINAL); if (v) { w[n() - 1] = v; verbAt = n() - 1; } }
  return w.map((x, i) => i === verbAt ? x : possessive2(x));
}

/** En yakın tam dakikaya yuvarlar; sonuç "şimdi"den önce ya da ona eşit olursa bir dakika ileri alır. */
export function roundToMinute(ms, nowMs) {
  let r = Math.round(ms / 60000) * 60000;
  if (nowMs != null && r <= nowMs) r += 60000;
  return new Date(r);
}

/* ── Arayüz yardımcıları (istemci de kullanır) ──────────────── */
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

/** "Bugün", "Yarın", "Cuma, 27 Kasım" */
export function dayLabel(d, now) {
  now = now || new Date();
  const diff = Math.round((startOfDay(d) - startOfDay(now)) / 86400000);
  if (diff === 0) return 'Bugün';
  if (diff === 1) return 'Yarın';
  if (diff === -1) return 'Dün';
  const base = GUNLER[d.getDay()] + ', ' + d.getDate() + ' ' + AYLAR[d.getMonth()];
  return d.getFullYear() !== now.getFullYear() ? base + ' ' + d.getFullYear() : base;
}
/** Önceden uyarı süresinin okunuşu: 10 → "10 dk", 60 → "1 saat", 90 → "1,5 saat", 1440 → "1 gün" */
export function leadLabel(m) {
  if (m % 1440 === 0) return (m / 1440) + ' gün';
  if (m % 60 === 0) return (m / 60) + ' saat';
  if (m > 60 && m % 30 === 0) return String(m / 60).replace('.', ',') + ' saat';
  return m + ' dk';
}
export function hhmm(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
export function fullDate(d) { return GUNLER[d.getDay()] + ', ' + d.getDate() + ' ' + AYLAR[d.getMonth()]; }

/* Göreve göre otomatik emoji + renk (istemci kartları ve sunucu bildirimleri ortak kullanır) */
const CATEGORIES = [
  ['ilac',      '💊', '#FF5CAA', /(^|\s)(ilaç|ilac|hap|vitamin|şurup|iğne)/],
  ['doktor',    '🩺', '#2EE6C9', /(^|\s)(doktor|dişçi|diş|hastane|muayene|tahlil|eczane|klinik)/],
  ['ucus',      '✈️', '#5AB8FF', /(^|\s)(uçak|uçuş|havalimanı|havaalanı|uçağ|check-in)/],
  ['arama',     '📞', '#3DFFB0', /(^|\s)(ara$|ara\s|aran|aray|arama|telefon|tel\s|görüntülü)/],
  ['toplanti',  '👥', '#9B7BFF', /(^|\s)(toplantı|görüşme|meeting|sunum|buluş|zoom|teams|mülakat)/],
  ['spor',      '🏋️', '#FF9F43', /(^|\s)(spor|koşu|yoga|pilates|antrenman|salon|yürüyüş|gym|fitness|yüzme)/],
  ['yemek',     '🍽️', '#FFC857', /(^|\s)(yemek|kahvaltı|akşam yemeği|öğle yemeği|restoran|pişir|fırın|çay|kahve)/],
  ['su',        '💧', '#19D3FF', /(^|\s)(su\s|su$|sula|bardak su)/],
  ['alisveris', '🛒', '#B8F35A', /(^|\s)(alışveriş|market|süt|ekmek|manav|bakkal|sipariş|kargo)/]
];
const DEFAULT_CATEGORY = { key: 'genel', emoji: '🔔', color: '#A9B4FF' };
export function categoryOf(text) {
  const t = lower(text) + ' ';
  for (const [key, emoji, color, re] of CATEGORIES) if (re.test(t)) return { key, emoji, color };
  return DEFAULT_CATEGORY;
}
export function emojiFor(text) { return categoryOf(text).emoji; }
