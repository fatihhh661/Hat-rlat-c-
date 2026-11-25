// Arayüz testi: gerçek Chromium, iPhone 13 (390×844) emülasyonu. Konsol hatası, akışlar, hareket azaltma, ekran görüntüleri.
// Çalıştır: node test/ui.test.mjs   (önce: node tools/build.mjs)
import { createRequire } from 'node:module';
import { start } from '../tools/serve.mjs';
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const PORT = 8799, URL0 = `http://localhost:${PORT}/`;
const SHOT = n => new URL(`./screens/${n}.png`, import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (name, cond, info = '') => { if (cond) { pass++; console.log('✅', name); } else { fail++; console.log('❌', name, info); } };
const wait = ms => new Promise(r => setTimeout(r, ms));

const server = await start(PORT);
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const errors = [];
// Ana ekrandan açılan PWA tam ekran çalışır: 390×844 (Safari çubukları yok)
const iphone = { ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 } };

async function newPage(opts = {}) {
  const base = opts.desktop ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 } : iphone;
  const ctx = await browser.newContext({ ...base, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', reducedMotion: opts.reduced ? 'reduce' : 'no-preference', permissions: ['microphone'] });
  if (opts.onboarded) await ctx.addInitScript(() => { if (!localStorage.getItem('anımsa.settings')) localStorage.setItem('anımsa.settings', JSON.stringify({ onboarded: true })); });
  if (opts.fakeSpeech) await ctx.addInitScript(() => {
    window.SpeechRecognition = window.webkitSpeechRecognition = class {
      start() {
        const words = 'yarın sabah 9\'da toplantı'.split(' '); let i = 0;
        this._t = setInterval(() => {
          i++; const t = words.slice(0, i).join(' ');
          const res = [{ transcript: t }]; res.isFinal = i === words.length;
          this.onresult && this.onresult({ results: [res] });
          if (i >= words.length) clearInterval(this._t);
        }, 450);
      }
      stop() { clearInterval(this._t); setTimeout(() => this.onend && this.onend(), 30); }
      abort() { this.stop(); }
    };
  });
  if (opts.noSpeech) await ctx.addInitScript(() => { delete window.webkitSpeechRecognition; delete window.SpeechRecognition; });
  if (opts.iosSafariTab) await ctx.addInitScript(() => { delete window.Notification; delete window.PushManager; });
  if (opts.noGUM) await ctx.addInitScript(() => { try { Object.defineProperty(navigator, 'mediaDevices', { value: undefined }); } catch (e) {} });
  if (opts.init) await ctx.addInitScript(opts.init);
  if (opts.routes) for (const [pat, fn] of opts.routes) await ctx.route(pat, fn);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${opts.tag || 'sayfa'}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[${opts.tag || 'sayfa'}] pageerror: ${e.message}`));
  await page.goto(URL0, { waitUntil: 'load' });
  return { ctx, page };
}

try {
  /* ── 1) İlk açılış: tanıtım ── */
  {
    const { ctx, page } = await newPage({ tag: 'tanıtım', iosSafariTab: true });
    await wait(1600);
    ok('Tanıtım ilk açılışta görünüyor', await page.isVisible('#onb'));
    await page.screenshot({ path: SHOT('01-tanitim-1') });
    await page.click('#onbNext'); await wait(1900);
    ok('Safari\'de (ana ekran dışı) "Ana ekrana ekle" rehberi gösteriliyor', await page.evaluate(() => getComputedStyle(document.querySelector('[data-step="1"]')).display !== 'none' && document.querySelector('.step.on') !== null));
    await page.screenshot({ path: SHOT('02-tanitim-ana-ekran') });
    await page.click('#onbNext'); await wait(900);
    const perm = await page.textContent('#permMsg');
    ok('Bildirim adımı: ana ekran dışında dürüst açıklama', /ana ekrandan açılan/.test(perm), perm);
    await page.screenshot({ path: SHOT('03-tanitim-bildirim') });
    await page.click('#onbSkip'); await wait(700);
    ok('Tanıtım kapanıyor ve kaydediliyor', await page.evaluate(() => document.getElementById('onb').hidden && JSON.parse(localStorage.getItem('anımsa.settings')).onboarded === true));
    await page.screenshot({ path: SHOT('04-ana-bos') });
    ok('Boş durum metni', (await page.textContent('#hero')).includes('Henüz hatırlatıcı yok'));
    ok('Selamlama Türkçe', /Günaydın|İyi günler|İyi akşamlar|İyi geceler/.test(await page.textContent('#greet')));
    let typed = false; for (let i = 0; i < 10 && !typed; i++) { typed = (await page.textContent('#ph')).length > 3; await wait(200); }
    ok('Daktilo yer tutucu yazıyor', typed);
    await ctx.close();
  }

  /* ── 2) Yazarak ekleme akışı ── */
  {
    const { ctx, page } = await newPage({ onboarded: true, tag: 'yazma' });
    await wait(500);
    await page.click('#input');
    await page.keyboard.type('Saat 23:45\'te Ahmet aranacak', { delay: 8 });
    await wait(450);
    const pv = await page.textContent('#preview');
    ok('Canlı önizleme: "Anladığım: 23:45 • Ahmet aranacak"', /Anladığım:\s*(Yarın )?23:45 • Ahmet aranacak/.test(pv), pv);
    await page.screenshot({ path: SHOT('05-canli-onizleme') });
    ok('Metin varken görünür gönder düğmesi çıkıyor', await page.evaluate(() => document.getElementById('sendBtn').classList.contains('show')));
    await page.evaluate(() => document.getElementById('input').blur());   // klavye kapalı senaryosu
    await page.click('#sendBtn');
    await wait(1100);
    ok('Gönder düğmesi (klavye kapalıyken) onay kartını açıyor', await page.evaluate(() => document.getElementById('sheet').classList.contains('open')));
    ok('Onay kartında görev metni', (await page.inputValue('#taskInput')) === 'Ahmet aranacak');
    ok('Saat seçici doğru değerde', (await page.inputValue('#timeInput')) === '23:45');
    ok('"Ne kadar kaldı" satırı', /sonra|kaldı/.test(await page.textContent('#leftTxt')));
    await page.screenshot({ path: SHOT('06-onay-karti') });
    await page.click('#saveBtn');
    await wait(250);
    ok('Kaydet: buton onay işaretine dönüşüyor', await page.evaluate(() => document.getElementById('saveBtn').classList.contains('done')));
    await wait(1400);
    ok('Kaydettikten sonra yazı kutusu tamamen temizleniyor (vurgu katmanı, gönder düğmesi, önizleme)', await page.evaluate(() => document.getElementById('input').value === '' && document.getElementById('hlIn').textContent === '' && !document.getElementById('input').classList.contains('hl-on') && !document.getElementById('sendBtn').classList.contains('show') && !document.getElementById('preview').classList.contains('show') && !document.getElementById('ph').hidden));
    ok('Hatırlatıcı localStorage\'a kaydedildi', await page.evaluate(() => JSON.parse(localStorage.getItem('anımsa.reminders')).some(r => r.text === 'Ahmet aranacak')));
    ok('Sıradaki hatırlatıcı kartında görünüyor', (await page.textContent('#hero')).includes('Ahmet aranacak'));
    await page.screenshot({ path: SHOT('07-kayit-sonrasi') });

    // Saat belirtilmeyen cümle → sarı uyarı
    await page.fill('#input', 'süt al');
    await page.keyboard.press('Enter'); await page.press('#input', 'Enter').catch(() => {});
    await wait(1000);
    const note = await page.textContent('#timeNote');
    ok('Saat yoksa uyarı: "Saat belirtmedin, 09:00 koydum"', note.includes('Saat belirtmedin, 09:00 koydum') && await page.evaluate(() => document.getElementById('timeBox').classList.contains('warn')), note);
    await page.screenshot({ path: SHOT('08-saat-yok-uyarisi') });
    await page.click('#cancelBtn'); await wait(500);

    // Boş gönderim → sallanma, kart açılmaz
    await page.fill('#input', ''); await page.press('#input', 'Enter'); await wait(300);
    ok('Boş metinle gönderim kart açmıyor', !(await page.evaluate(() => document.getElementById('sheet').classList.contains('open'))));

    // Hızlı çip: görev yazılıyken doğrudan kart açar
    await page.fill('#input', 'fırına bak'); await page.click('[data-chip="10 dk sonra"]'); await wait(900);
    ok('Hızlı çip: görev + "10 dk sonra" ile kart açılıyor', (await page.inputValue('#taskInput')) === 'Fırına bak' && /(9|10|11) dakika sonra/.test(await page.textContent('#leftTxt')));
    await page.click('#saveBtn'); await wait(1500);

    // Zengin liste
    await page.evaluate(() => {
      const A = window.__animsa, n = Date.now(), H = 3600000;
      const add = (text, at, extra = {}) => A.state.reminders.push({ id: crypto.randomUUID(), text, at, createdAt: n - 2 * H, synced: true, done: false, ...extra });
      const t9 = new Date(); t9.setDate(t9.getDate() + 1); t9.setHours(9, 0, 0, 0);
      add('Su iç', n + 25 * 60000);
      add('Doktor randevusu', n + 3 * H + 14 * 60000);
      add('Toplantı: haftalık rapor', t9.getTime());
      add('İlacını iç', n + 26 * H);
      add('Uçuş için check-in yap', n + 4 * 24 * H);
      add('Spor salonu', n + 9 * 24 * H);
      add('Annemi ara', n - 3 * H, { done: true });
      add('Çamaşırı çıkar', n - 26 * H, { done: true });
      localStorage.setItem('anımsa.reminders', JSON.stringify(A.state.reminders));
      A.render();
    });
    await wait(900);
    await page.screenshot({ path: SHOT('09-liste') });
    ok('Bölüm başlıkları (Bugün/Yarın/Bu hafta/Daha sonra)', await page.evaluate(() => { const t = Array.from(document.querySelectorAll('#list .sec-h')).map(h => h.textContent); return ['Yarın', 'Bu hafta', 'Daha sonra'].every(x => t.includes(x)); }));
    ok('Otomatik emoji (🩺 💊 ✈️ 🏋️ 👥)', await page.evaluate(() => { const e = Array.from(document.querySelectorAll('#list .emoji')).map(x => x.textContent).join(''); return ['🩺', '💊', '✈️', '🏋️', '👥'].every(x => e.includes(x)); }));
    ok('<1 saat kalan kartta pembe halka + dönen kenar ışığı', await page.evaluate(() => !!document.querySelector('.ring-sm.c-pink') && !!document.querySelector('.glow-edge')));
    await page.evaluate(() => document.getElementById('scroller').scrollTo(0, 9999)); await wait(400);
    await page.screenshot({ path: SHOT('10-liste-alt') });
    await page.evaluate(() => document.getElementById('scroller').scrollTo(0, 0));

    // Kaydırarak silme
    const before = await page.evaluate(() => window.__animsa.state.reminders.length);
    await page.evaluate(() => { document.querySelector('#list .card-wrap').scrollIntoView({ block: 'center' }); }); await wait(300);
    const box = await page.locator('#list .card-wrap .card').first().boundingBox();
    await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(box.x + box.width - 20 - i * 24, box.y + box.height / 2); await wait(8); }
    await page.mouse.up();
    await wait(900);
    ok('Sola hızlı kaydırma kartı siliyor', (await page.evaluate(() => window.__animsa.state.reminders.length)) === before - 1);

    // Geçmiş sekmesi
    await page.click('#tabPast'); await wait(600);
    ok('Geçmiş sekmesi: üstü çizili soluk kartlar', await page.evaluate(() => document.querySelectorAll('#pastList .card.past').length >= 2));
    await page.screenshot({ path: SHOT('11-gecmis') });
    await page.click('#tabUp'); await wait(300);

    // Ayarlar
    await page.click('#settingsBtn'); await wait(700);
    ok('Ayarlar paneli açılıyor, bildirim rozeti var', await page.evaluate(() => document.getElementById('panel').classList.contains('open')) && (await page.textContent('#notifBadge')).length > 0);
    ok('Sürüm ve derleme kodu görünüyor (1.0.0 · xxxxxxx)', /^1\.0\.0 · [0-9a-f]{7}$/.test(await page.textContent('#ver')));
    await page.screenshot({ path: SHOT('12-ayarlar') });
    await page.click('#wipeBtn'); await wait(100);
    ok('"Tüm verileri sil" iki aşamalı onay istiyor', (await page.textContent('#wipeBtn')) === 'Emin misin?' && (await page.evaluate(() => window.__animsa.state.reminders.length)) > 0);
    await page.click('#panelClose'); await wait(600);

    // Alarm / erteleme
    await page.evaluate(() => { const A = window.__animsa; const r = { id: crypto.randomUUID(), text: 'Fırını kapat', at: Date.now() - 30000, createdAt: Date.now() - 3600000, synced: true, done: false }; A.state.reminders.push(r); A.openAlarm(r); });
    await wait(800);
    await page.screenshot({ path: SHOT('13-alarm-erteleme') });
    await page.click('#snooze10'); await wait(700);
    ok('"10 dk ertele" zamanı 10 dk ileri alıyor', await page.evaluate(() => { const r = window.__animsa.state.reminders.find(x => x.text === 'Fırını kapat'); return r && Math.abs(r.at - Date.now() - 600000) <= 31000 && r.at % 60000 === 0 && !!r.snoozedFrom; }));
    await ctx.close();
  }

  /* ── 3a) Mikrofon (iPhone): kayıt + Whisper ── */
  {
    const { ctx, page } = await newPage({ onboarded: true, tag: 'mikrofon-kayit' });
    let sentType = null, sentBody = null;
    await page.route('**/api/transcribe', r => { sentType = r.request().headers()['content-type']; sentBody = r.request().postDataBuffer(); r.continue(); });
    await wait(700);
    await page.click('#orb'); await wait(900);
    const mic = await page.evaluate(() => window.__animsa.mic);
    ok('iPhone: kayıt yolu seçildi, gerçek mikrofon + ses analizörü çalışıyor, örnekler toplanıyor', mic && mic.mode === 'record' && mic.analyser && mic.chunks > 0 && mic.rate > 0, JSON.stringify(mic));
    ok('iPhone: dinleme sahnesi açık, küre seviyeye göre canlanıyor', await page.evaluate(() => document.getElementById('listen').classList.contains('open') && parseFloat(document.getElementById('bigOrb').style.getPropertyValue('--lvl')) > 0));
    await page.screenshot({ path: SHOT('14-dinleme') });
    // Sessizlik algılanıp kayıt kendiliğinden bitmiş olabilir; hâlâ dinliyorsa ✓'ye bas
    await page.evaluate(() => { if (window.__animsa.mic) document.getElementById('listenDone').click(); });
    await wait(2200);
    const wavOk = sentBody && sentBody.toString('ascii', 0, 4) === 'RIFF' && sentBody.toString('ascii', 8, 12) === 'WAVE' && sentBody.readUInt32LE(24) === 16000 && sentBody.readUInt16LE(22) === 1 && sentBody.readUInt16LE(34) === 16;
    ok('Kayıt 16 kHz, mono, 16-bit WAV olarak gönderildi', sentType === 'audio/wav' && wavOk && sentBody.length > 16000, `${sentType} ${sentBody && sentBody.length}`);
    ok('Whisper metni → onay kartı: "Toplantı", yarın 09:00', (await page.inputValue('#taskInput')) === 'Toplantı' && (await page.inputValue('#timeInput')) === '09:00' && (await page.textContent('#dateTxt')) === 'Yarın');
    await page.screenshot({ path: SHOT('15-sesten-onay-karti') });
    ok('Mikrofon, ses bağlamı ve animasyonlar kapatıldı', await page.evaluate(() => !document.getElementById('listen').classList.contains('open') && document.querySelectorAll('.ripple').length === 0));
    await ctx.close();
  }
  {
    // Cloudflare'de AI bağlaması unutulduysa: açık yönlendirme
    const { ctx, page } = await newPage({ onboarded: true, tag: 'mikrofon-ai-yok', routes: [['**/api/transcribe', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'ai_missing', message: 'x' }) })]] });
    await wait(600);
    await page.click('#orb'); await wait(900);
    await page.evaluate(() => { if (window.__animsa.mic) document.getElementById('listenDone').click(); });
    await wait(2000);
    const hint = await page.textContent('#hint');
    ok('AI bağlaması yoksa: "Workers AI bağlaması ekle" yönlendirmesi', hint.includes('"AI" adlı Workers AI bağlaması'), hint);
    await page.screenshot({ path: SHOT('16-mikrofon-ai-yok') });
    await ctx.close();
  }
  {
    // Mikrofon izni reddedildiğinde: hangi ayarın değişeceği açıkça söyleniyor
    const { ctx, page } = await newPage({ onboarded: true, tag: 'mikrofon-izin', init: () => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    } });
    await wait(500);
    await page.click('#orb'); await wait(1400);
    const hint = await page.textContent('#hint');
    ok('Mikrofon izni reddedilince: Ayarlar › Safari › Mikrofon yolu + hata adı', hint.includes('Ayarlar › Safari › Mikrofon') && hint.includes('NotAllowedError'), hint);
    await ctx.close();
  }
  {
    // İzin dışı hata (örn. kısıt): sade ayarlarla ikinci deneme başarılı olmalı
    const { ctx, page } = await newPage({ onboarded: true, tag: 'mikrofon-ikinci', init: () => {
      const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); let n = 0;
      navigator.mediaDevices.getUserMedia = c => (++n === 1 ? Promise.reject(Object.assign(new Error('x'), { name: 'OverconstrainedError' })) : orig(c));
    } });
    await wait(500);
    await page.click('#orb'); await wait(1200);
    const mic = await page.evaluate(() => window.__animsa.mic);
    ok('İlk deneme hata verirse sade ayarlarla ikinci deneme mikrofonu açıyor', mic && mic.analyser, JSON.stringify(mic));
    await page.click('#listenCancel').catch(() => {});
    await ctx.close();
  }
  /* ── 3b) Mikrofon (diğer tarayıcılar): tarayıcı tanıması, canlı yazı ── */
  {
    const { ctx, page } = await newPage({ desktop: true, onboarded: true, fakeSpeech: true, tag: 'mikrofon-tarayici' });
    await wait(500);
    await page.click('#orb'); await wait(1500);
    ok('Tarayıcı tanıması: metin canlı akıyor', (await page.textContent('#listenText')).length > 0);
    await wait(500);
    await page.click('#listenDone'); await wait(1600);
    ok('Tarayıcı tanıması → onay kartı: "Toplantı", yarın 09:00', (await page.inputValue('#taskInput')) === 'Toplantı' && (await page.inputValue('#timeInput')) === '09:00');
    await ctx.close();
  }
  {
    // Tanıma hiç yanıt vermiyor, stop() de onend tetiklemiyor
    const { ctx, page } = await newPage({ desktop: true, onboarded: true, noGUM: true, tag: 'mikrofon-takili', init: () => {
      window.SpeechRecognition = window.webkitSpeechRecognition = class { start() {} stop() {} abort() {} };
    } });
    await wait(400);
    await page.click('#orb'); await wait(1200);
    await page.click('#listenDone'); await wait(2400);
    ok('✓ tuşu: tanıma yanıt vermese de dinleme ekranı kapanıyor (takılmıyor)', !(await page.evaluate(() => document.getElementById('listen').classList.contains('open'))));
    ok('Tanıma çalışmazsa açık Türkçe yönlendirme gösteriliyor', (await page.textContent('#hint')).includes('klavyedeki 🎤'), await page.textContent('#hint'));
    await page.click('#orb'); await wait(300);
    ok('Bir kez çalışmadıysa küre doğrudan klavye diktesine yönlendiriyor', !(await page.evaluate(() => document.getElementById('listen').classList.contains('open'))) && await page.evaluate(() => document.activeElement.id === 'input'));
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage({ desktop: true, onboarded: true, noGUM: true, tag: 'mikrofon-bekci', init: () => {
      window.SpeechRecognition = window.webkitSpeechRecognition = class { start() {} stop() {} abort() {} };
    } });
    await wait(400);
    await page.click('#orb'); await wait(7600);
    ok('Hiç ses gelmezse dinleme 6 sn sonra kendiliğinden kapanıyor', !(await page.evaluate(() => document.getElementById('listen').classList.contains('open'))));
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage({ desktop: true, onboarded: true, noSpeech: true, noGUM: true, tag: 'mikrofon-yok' });
    await wait(400);
    await page.click('#orb'); await wait(300);
    const hint = await page.textContent('#hint');
    ok('Ne tanıma ne mikrofon varsa: hata yok, klavye ipucu', hint.includes('Klavyedeki 🎤 simgesine dokunarak konuşabilirsin.') && await page.evaluate(() => document.activeElement.id === 'input'));
    await wait(3200);
    ok('İpucu 3 sn sonra kayboluyor', !(await page.evaluate(() => document.getElementById('hint').classList.contains('show'))));
    await ctx.close();
  }

  /* ── 3c) Atmosfer, yazarken vurgu, renkli kartlar ── */
  {
    const { ctx, page } = await newPage({ onboarded: true, tag: 'gorsel' });
    await wait(500);
    const phases = {};
    for (const [h, want] of [[8, 'sabah'], [13, 'oglen'], [19, 'aksam'], [1, 'gece']]) {
      await page.evaluate(h => window.__animsa.setHour(h), h);
      phases[want] = await page.evaluate(() => ({ phase: document.documentElement.dataset.phase, a1: document.documentElement.style.getPropertyValue('--a1').trim(), greet: document.getElementById('greet').textContent }));
    }
    ok('Atmosfer: 08 sabah, 13 öğlen, 19 akşam, 01 gece', phases.sabah.phase === 'sabah' && phases.oglen.phase === 'oglen' && phases.aksam.phase === 'aksam' && phases.gece.phase === 'gece', JSON.stringify(phases));
    ok('Atmosfer: her evrede farklı renk', new Set(Object.values(phases).map(p => p.a1)).size === 4);
    ok('Selamlama evreye uyuyor (Günaydın / İyi günler / İyi akşamlar / İyi geceler)', phases.sabah.greet === 'Günaydın' && phases.oglen.greet === 'İyi günler' && phases.aksam.greet === 'İyi akşamlar' && phases.gece.greet === 'İyi geceler');
    ok('Atmosfer geçişi yumuşak (09:00 karışımı sabah ile öğlen arasında değil, 11:30 arada)', await page.evaluate(() => { const A = window.__animsa.atmosAt; return A(9).a1 === A(8).a1 && A(11.5).a1 !== A(8).a1 && A(11.5).a1 !== A(13).a1; }));
    await page.click('#input'); await page.keyboard.type("yarın sabah 9'da toplantı hatırlat", { delay: 5 });
    await wait(200);
    const hl = await page.evaluate(() => ({ z: Array.from(document.querySelectorAll('#hlIn .hz')).map(e => e.textContent).join(' '), g: Array.from(document.querySelectorAll('#hlIn .hg')).map(e => e.textContent).join(' '), d: Array.from(document.querySelectorAll('#hlIn .hd')).map(e => e.textContent).join(' '), same: document.getElementById('hlIn').textContent === document.getElementById('input').value, on: document.getElementById('input').classList.contains('hl-on') }));
    ok('Yazarken vurgu: zaman gradyanlı, görev beyaz, dolgu soluk; katman metni kutuyla birebir aynı', hl.z === "yarın sabah 9'da" && hl.g === 'toplantı' && hl.d === 'hatırlat' && hl.same && hl.on, JSON.stringify(hl));
    await page.fill('#input', ''); await page.dispatchEvent('#input', 'input'); await wait(100);
    ok('Kutu boşalınca vurgu katmanı temizleniyor', await page.evaluate(() => document.getElementById('hlIn').textContent === '' && !document.getElementById('input').classList.contains('hl-on')));
    await page.evaluate(() => { const A = window.__animsa, n = Date.now(); [['Hero', 30], ['İlacını iç', 120], ['Annemi ara', 180], ['Kurs', 240]].forEach(([t, m]) => A.state.reminders.push({ id: crypto.randomUUID(), text: t, at: n + m * 60000, createdAt: n, synced: true, done: false })); A.render(); });
    await wait(300);
    const tints = await page.evaluate(() => Array.from(document.querySelectorAll('#list .card-wrap')).map(w => [w.dataset.cat, w.style.getPropertyValue('--tint')]));
    ok('Renkli kartlar: ilaç pembe, arama yeşil, diğer varsayılan', JSON.stringify(tints) === JSON.stringify([['ilac', '#FF5CAA'], ['arama', '#3DFFB0'], ['genel', '#A9B4FF']]), JSON.stringify(tints));
    await ctx.close();
  }

  /* ── 4) Bozuk veri dayanıklılığı ── */
  {
    const { ctx, page } = await newPage({ tag: 'bozuk-veri', init: () => { localStorage.setItem('anımsa.reminders', '{bozuk'); localStorage.setItem('anımsa.settings', '[1,2'); localStorage.setItem('anımsa.uid', '42'); } });
    await wait(800);
    ok('Bozuk localStorage verisinde uygulama çökmüyor (sıfırdan başlıyor)', (await page.textContent('#hero')).includes('Henüz hatırlatıcı yok') || await page.isVisible('#onb'));
    await ctx.close();
  }

  /* ── 5) Hareket azaltma ── */
  {
    const { ctx, page } = await newPage({ onboarded: true, reduced: true, tag: 'hareket-azaltma' });
    await wait(800);
    const r = await page.evaluate(() => ({
      aurora: getComputedStyle(document.querySelector('.aurora')).animationName,
      orb: getComputedStyle(document.querySelector('#orb .orb-core')).animationName,
      starsBlank: (() => { const c = document.getElementById('stars'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return false; return true; })(),
      sheetTransition: getComputedStyle(document.getElementById('sheet')).transitionProperty
    }));
    ok('Hareket azaltma: aurora ve küre animasyonları kapalı', r.aurora === 'none' && r.orb === 'none', JSON.stringify(r));
    ok('Hareket azaltma: yıldız parçacıkları çizilmiyor', r.starsBlank);
    ok('Hareket azaltma: kart geçişi yalnızca solma (opacity)', r.sheetTransition === 'opacity', r.sheetTransition);
    await page.fill('#input', 'yarın 10:00 diş hekimi'); await page.press('#input', 'Enter'); await wait(500);
    ok('Hareket azaltmada onay kartı yine açılıyor', await page.evaluate(() => getComputedStyle(document.getElementById('sheet')).opacity === '1'));
    await page.screenshot({ path: SHOT('17-hareket-azaltma') });
    await ctx.close();
  }

  /* ── 6) Kare hızı (başsız Chromium, yalnızca kabaca) ── */
  {
    const { ctx, page } = await newPage({ onboarded: true, tag: 'fps' });
    await wait(500);
    const fps = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2); }; requestAnimationFrame(f); }));
    const low = await page.evaluate(() => new Promise(r => setTimeout(() => r(document.body.classList.contains('low-power')), 2500)));
    console.log(`   ↳ ana ekran kare hızı ≈ ${fps.toFixed(0)} fps (GPU'suz başsız Chromium, yazılımla çizim; iPhone'u temsil etmez)`);
    ok('Kare hızı düşükse düşük güç kipi devreye giriyor (parçacıklar kapanır)', fps >= 45 ? true : low, `fps=${fps}, low-power=${low}`);
    const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
    ok('Service worker kaydoldu ve etkin', sw);
    await ctx.close();
  }
} catch (e) {
  fail++; console.log('❌ Test betiği hata verdi:', e);
}

// Bilerek 503 döndürdüğümüz test sayfasındaki ağ hatası beklenen bir durumdur
const realErrors = errors.filter(e => !(e.startsWith('[mikrofon-ai-yok]') && /status of 503/.test(e)));
ok('Hiçbir sayfada console hatası yok', realErrors.length === 0, '\n   ' + realErrors.join('\n   '));
await browser.close();
server.close();
console.log(`\nArayüz: ${pass}/${pass + fail} geçti`);
process.exit(fail ? 1 : 0);
