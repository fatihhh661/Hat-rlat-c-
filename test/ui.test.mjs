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
  const ctx = await browser.newContext({ ...iphone, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', reducedMotion: opts.reduced ? 'reduce' : 'no-preference', permissions: ['microphone'] });
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
  if (opts.init) await ctx.addInitScript(opts.init);
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
    await page.keyboard.press('Enter');
    await wait(1100);
    ok('Enter onay kartını açıyor', await page.evaluate(() => document.getElementById('sheet').classList.contains('open')));
    ok('Onay kartında görev metni', (await page.inputValue('#taskInput')) === 'Ahmet aranacak');
    ok('Saat seçici doğru değerde', (await page.inputValue('#timeInput')) === '23:45');
    ok('"Ne kadar kaldı" satırı', /sonra|kaldı/.test(await page.textContent('#leftTxt')));
    await page.screenshot({ path: SHOT('06-onay-karti') });
    await page.click('#saveBtn');
    await wait(250);
    ok('Kaydet: buton onay işaretine dönüşüyor', await page.evaluate(() => document.getElementById('saveBtn').classList.contains('done')));
    await wait(1400);
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
    ok('Hızlı çip: görev + "10 dk sonra" ile kart açılıyor', (await page.inputValue('#taskInput')) === 'Fırına bak' && /10 dakika sonra|9 dakika sonra/.test(await page.textContent('#leftTxt')));
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
    ok('Sürüm numarası görünüyor', (await page.textContent('#ver')) === '1.0.0');
    await page.screenshot({ path: SHOT('12-ayarlar') });
    await page.click('#wipeBtn'); await wait(100);
    ok('"Tüm verileri sil" iki aşamalı onay istiyor', (await page.textContent('#wipeBtn')) === 'Emin misin?' && (await page.evaluate(() => window.__animsa.state.reminders.length)) > 0);
    await page.click('#panelClose'); await wait(600);

    // Alarm / erteleme
    await page.evaluate(() => { const A = window.__animsa; const r = { id: crypto.randomUUID(), text: 'Fırını kapat', at: Date.now() - 30000, createdAt: Date.now() - 3600000, synced: true, done: false }; A.state.reminders.push(r); A.openAlarm(r); });
    await wait(800);
    await page.screenshot({ path: SHOT('13-alarm-erteleme') });
    await page.click('#snooze10'); await wait(700);
    ok('"10 dk ertele" zamanı 10 dk ileri alıyor', await page.evaluate(() => { const r = window.__animsa.state.reminders.find(x => x.text === 'Fırını kapat'); return r && Math.abs(r.at - Date.now() - 600000) < 5000 && !!r.snoozedFrom; }));
    await ctx.close();
  }

  /* ── 3) Mikrofon: konuşma tanıma ── */
  {
    const { ctx, page } = await newPage({ onboarded: true, fakeSpeech: true, tag: 'mikrofon' });
    await wait(500);
    await page.click('#orb'); await wait(1500);
    ok('Dinleme sahnesi açılıyor, metin canlı akıyor', await page.evaluate(() => document.getElementById('listen').classList.contains('open')) && (await page.textContent('#listenText')).length > 0);
    ok('Ses seviyesi (AnalyserNode / nabız) küreyi canlandırıyor', await page.evaluate(() => parseFloat(document.getElementById('bigOrb').style.getPropertyValue('--lvl')) > 0));
    await page.screenshot({ path: SHOT('14-dinleme') });
    await wait(500);
    await page.click('#listenDone'); await wait(1600);
    ok('Konuşma bitince onay kartı: "Toplantı", yarın 09:00', (await page.inputValue('#taskInput')) === 'Toplantı' && (await page.inputValue('#timeInput')) === '09:00' && (await page.textContent('#dateTxt')) === 'Yarın');
    await page.screenshot({ path: SHOT('15-sesten-onay-karti') });
    ok('Mikrofon akışı ve animasyon döngüleri kapatıldı', await page.evaluate(() => !document.getElementById('listen').classList.contains('open') && document.querySelectorAll('.ripple').length === 0));
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage({ onboarded: true, noSpeech: true, tag: 'mikrofon-yok' });
    await wait(400);
    await page.click('#orb'); await wait(300);
    const hint = await page.textContent('#hint');
    ok('Konuşma tanıma yoksa: hata yok, klavye ipucu gösteriliyor', hint.includes('Klavyedeki 🎤 simgesine dokunarak konuşabilirsin.') && await page.evaluate(() => document.activeElement.id === 'input'));
    await page.screenshot({ path: SHOT('16-mikrofon-ipucu') });
    await wait(3200);
    ok('İpucu 3 sn sonra kayboluyor', !(await page.evaluate(() => document.getElementById('hint').classList.contains('show'))));
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

ok('Hiçbir sayfada console hatası yok', errors.length === 0, '\n   ' + errors.join('\n   '));
await browser.close();
server.close();
console.log(`\nArayüz: ${pass}/${pass + fail} geçti`);
process.exit(fail ? 1 : 0);
