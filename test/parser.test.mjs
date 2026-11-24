// Türkçe ayrıştırıcı testleri. Çalıştır: TZ=Europe/Istanbul node test/parser.test.mjs
// "Şimdi" sabit: Salı, 24 Kasım 2026, 14:00 (yerel saat)
import { parse } from '../src/parser.js';
import { writeFileSync } from 'node:fs';

const NOW = new Date(2026, 10, 24, 14, 0, 0, 0);
const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

// [cümle, beklenen zaman, beklenen görev, saatBelirtildiMi (varsayılan true)]
const CASES = [
  // — Şartnamede zorunlu olanlar —
  ['yarın sabah 9\'da toplantı', '2026-11-25 09:00', 'Toplantı'],
  ['akşam yedide eve git', '2026-11-24 19:00', 'Eve git'],
  ['20 dk sonra çamaşırı çıkar', '2026-11-24 14:20', 'Çamaşırı çıkar'],
  ['cuma saat 15.30\'da doktor', '2026-11-27 15:30', 'Doktor'],
  ['haftaya pazartesi 10\'da rapor', '2026-11-30 10:00', 'Rapor'],
  ['3 Aralık saat 10\'da kurs', '2026-12-03 10:00', 'Kurs'],
  ['gece 1\'de uyan', '2026-11-25 01:00', 'Uyan'],
  ['yarım saat sonra su iç', '2026-11-24 14:30', 'Su iç'],
  ['bir buçuk saat sonra fırını kapat', '2026-11-24 15:30', 'Fırını kapat'],
  ['öbür gün öğlen 12\'de Ahmet\'i ara', '2026-11-26 12:00', 'Ahmet\'i ara'],
  // — Saat biçimleri ve ekler —
  ['Saat 14:00\'te Ahmet aranacak', '2026-11-25 14:00', 'Ahmet aranacak'], // 14:00 tam şimdi → geçmiş sayılır, yarın
  ['Saat 16:00’da Ahmet aranacak', '2026-11-24 16:00', 'Ahmet aranacak'],
  ['saat 15.45te kargo gelecek', '2026-11-24 15:45', 'Kargo gelecek'],
  ['7\'de spor', '2026-11-24 19:00', 'Spor'],              // 7–11: sabah geçmiş → akşam
  ['ikide toplantı var', '2026-11-25 14:00', 'Toplantı var'], // 2 → 14:00 = şimdi → yarın
  ['üçte kahve molası', '2026-11-24 15:00', 'Kahve molası'],
  ['on ikide öğle yemeği', '2026-11-25 12:00', 'Öğle yemeği'],
  ['saat dörtte annemi ara', '2026-11-24 16:00', 'Annemi ara'],
  ['yedi buçukta yemek yap', '2026-11-24 19:30', 'Yemek yap'],
  ['saat 05:30\'da uçağa yetiş', '2026-11-25 05:30', 'Uçağa yetiş'],
  ['dokuzu çeyrek geçe dizi başlıyor', '2026-11-24 21:15', 'Dizi başlıyor'],
  ['beşe çeyrek var otobüs', '2026-11-24 16:45', 'Otobüs'],
  // — Göreli süreler —
  ['2 saat sonra ilacımı hatırlat', '2026-11-24 16:00', 'İlacımı'],
  ['iki buçuk saat sonra çocukları al', '2026-11-24 16:30', 'Çocukları al'],
  ['45 dakika sonra toplantıya katıl', '2026-11-24 14:45', 'Toplantıya katıl'],
  ['yarım saat içinde çıkmam lazım', '2026-11-24 14:30', 'Çıkmam lazım'],
  ['bir saate kadar maili gönder', '2026-11-24 15:00', 'Maili gönder'],
  ['1 saat 15 dakika sonra kek', '2026-11-24 15:15', 'Kek'],
  ['yirmi beş dakika sonra çayı demle', '2026-11-24 14:25', 'Çayı demle'],
  ['3 gün sonra faturayı öde', '2026-11-27 09:00', 'Faturayı öde', false],
  ['1 hafta sonra saat 11\'de diş kontrolü', '2026-12-01 11:00', 'Diş kontrolü'],
  ['çeyrek saat sonra fırına bak', '2026-11-24 14:15', 'Fırına bak'],
  // — Tarihler ve günler —
  ['bu akşam 20:00 film izle', '2026-11-24 20:00', 'Film izle'],
  ['bu akşam annemi ara', '2026-11-24 20:00', 'Annemi ara', false],
  ['yarın öğleden sonra 3\'te banka', '2026-11-25 15:00', 'Banka'],
  ['ertesi gün sabah 8 de koşu', '2026-11-26 08:00', 'Koşu'],
  ['yarından sonra saat 9\'da dişçi', '2026-11-26 09:00', 'Dişçi'],
  ['salı günü 10\'da sunum', '2026-12-01 10:00', 'Sunum'],       // bugün salı ama 10:00 geçti → haftaya
  ['salı 18\'de yoga', '2026-11-24 18:00', 'Yoga'],               // bugün salı, saat gelmedi → bugün
  ['bu cuma akşam 8\'de sinema', '2026-11-27 20:00', 'Sinema'],
  ['perşembeye kadar raporu bitir', '2026-11-26 09:00', 'Raporu bitir', false],
  ['15.12 kira öde', '2026-12-15 09:00', 'Kira öde', false],
  ['15/12 saat 13\'te noter', '2026-12-15 13:00', 'Noter'],
  ['ayın 28\'i elektrik faturası', '2026-11-28 09:00', 'Elektrik faturası', false],
  ['10 ocakta pasaport yenile', '2027-01-10 09:00', 'Pasaport yenile', false],
  ['gece 12\'de doğum günü mesajı at', '2026-11-25 00:00', 'Doğum günü mesajı at'],
  ['gece yarısı yedek al', '2026-11-25 00:00', 'Yedek al'],
  ['öğlen 1\'de yemek', '2026-11-25 13:00', 'Yemek'], // 13:00 geçti → yarın
  ['gece 11\'de ışıkları kapat', '2026-11-24 23:00', 'Işıkları kapat'],
  ['akşam 7 Mehmet\'le buluş', '2026-11-24 19:00', 'Mehmet\'le buluş'],
  // — Saat yok / dolgu sözcükleri —
  ['süt al', '2026-11-25 09:00', 'Süt al', false],
  ['lütfen bana yarın ilacımı içmemi hatırlat', '2026-11-25 09:00', 'İlacımı içmemi', false],
  ['hatırlatıcı kur yarın 10:00 İstanbul toplantısı', '2026-11-25 10:00', 'İstanbul toplantısı'],
  ['yarın sabah', '2026-11-25 09:00', 'Hatırlatıcı', false],
  ['İLAÇ İÇ yarın 08:00', '2026-11-25 08:00', 'İLAÇ İÇ'],
  ['ışıkları kapat 23:15', '2026-11-24 23:15', 'Işıkları kapat'],
];

let pass = 0;
const rows = [];
for (const [text, expTime, expTask, expSpec = true] of CASES) {
  let got, ok, err = '';
  try {
    got = parse(text, NOW);
    ok = fmt(got.zaman) === expTime && got.görev === expTask && got.saatBelirtildiMi === expSpec;
  } catch (e) { ok = false; err = String(e && e.stack || e); }
  if (ok) pass++;
  rows.push({ text, exp: `${expTime} • ${expTask}${expSpec ? '' : ' (saat yok)'}`, got: got ? `${fmt(got.zaman)} • ${got.görev}${got.saatBelirtildiMi ? '' : ' (saat yok)'}` : err, ok });
}

// Normalizasyon birim testleri
const extra = [
  ['tr-TR küçük harf: "İSTANBUL\'DA saat 10\'da"', parse('İSTANBUL\'DA YARIN saat 10\'da', NOW).görev === 'İSTANBUL\'DA'],
  ['boş metin çökmez', parse('', NOW).görev === 'Hatırlatıcı'],
  ['null çökmez', parse(null, NOW).görev === 'Hatırlatıcı'],
  ['güven alanı 0..1', (() => { const g = parse('20 dk sonra', NOW).güven; return g > 0.9 && g <= 1; })()],
  ['yarına atıldı işareti', parse('saat 10\'da', NOW).yarinaAtildi === false && parse('saat 13:00', NOW).yarinaAtildi === true],
];
for (const [name, ok] of extra) { rows.push({ text: name, exp: 'doğru', got: ok ? 'doğru' : 'YANLIŞ', ok }); if (ok) pass++; }

const total = rows.length;
const esc = s => String(s).replace(/\|/g, '\\|');
const md = ['| # | Cümle | Beklenen | Bulunan | Sonuç |', '|---|---|---|---|---|',
  ...rows.map((r, i) => `| ${i + 1} | ${esc(r.text)} | ${esc(r.exp)} | ${esc(r.got)} | ${r.ok ? '✅' : '❌'} |`)].join('\n');
writeFileSync(new URL('./parser-report.md', import.meta.url), `# Ayrıştırıcı test raporu\n\n"Şimdi": Salı, 24 Kasım 2026, 14:00\n\n${md}\n\n**${pass}/${total} geçti**\n`);
for (const r of rows) if (!r.ok) console.log('❌', r.text, '\n   beklenen:', r.exp, '\n   bulunan :', r.got);
console.log(`Ayrıştırıcı: ${pass}/${total} geçti`);
process.exit(pass === total ? 0 : 1);
