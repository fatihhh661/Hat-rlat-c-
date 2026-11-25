// Tüm kaynakları tek dosya worker.js içine paketler. Çalıştır: node tools/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const VERSION = '1.0.0';
const r = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const b64 = p => readFileSync(new URL('../' + p, import.meta.url)).toString('base64');

// ES modül sözdizimini düz betiğe çevir
const stripModule = src => src
  .replace(/^import [^\n]*;\n/gm, '')
  .replace(/^export (async function|function|const|let|class) /gm, '$1 ');

// 1) İstemci betiği: ayrıştırıcı + uygulama
// Derleme kodu: kaynakların özeti. Ayarlarda görünür; telefonda hangi sürümün çalıştığı buradan anlaşılır.
const BUILD = createHash('sha256').update(['src/parser.js', 'src/push.js', 'src/server.js', 'src/client/app.js', 'src/client/app.css', 'src/client/index.html', 'src/client/sw.js'].map(r).join('\n')).digest('hex').slice(0, 7);
const clientJs = stripModule(r('src/parser.js')) + '\n' + r('src/client/app.js').replace('__VERSION__', `${VERSION} · ${BUILD}`);
if (/<\/script/i.test(clientJs)) throw new Error('İstemci JS içinde </script geçiyor');
const css = r('src/client/app.css');
const page = r('src/client/index.html')
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => clientJs);

// 2) Service worker: içerik özetinden önbellek sürümü
const hash = createHash('sha256').update(page).update(r('src/client/sw.js')).update(VERSION).digest('hex').slice(0, 10);
const sw = r('src/client/sw.js').replace('__HASH__', hash);

// 3) Manifest
const manifest = JSON.stringify({
  name: 'Anımsa', short_name: 'Anımsa', description: 'Söyle, unutma. Sesli ve yazılı hatırlatıcı.',
  lang: 'tr', dir: 'ltr', start_url: '/', scope: '/', id: '/', display: 'standalone', orientation: 'portrait',
  theme_color: '#05060F', background_color: '#05060F',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: '/icon-180.png', sizes: '180x180', type: 'image/png' }
  ]
}, null, 2);

const ASSETS = { html: page, sw, manifest, icon180: b64('src/icons/icon-180.png'), icon192: b64('src/icons/icon-192.png'), icon512: b64('src/icons/icon-512.png') };

// 4) Sunucu kodu
const server = stripModule(r('src/parser.js')) + '\n' + stripModule(r('src/push.js')) + '\n' + stripModule(r('src/server.js'));

const out = `/* ════════════════════════════════════════════════════════════════
   ANIMSA — Sesli & yazılı hatırlatıcı (iPhone PWA)  ·  sürüm ${VERSION} · derleme ${BUILD}
   Tek dosya Cloudflare Worker (module biçimi). Bu dosyayı Cloudflare
   panelindeki düzenleyiciye olduğu gibi yapıştırın.
   Gerekenler: "KV" adlı KV bağlaması + her dakika cron (* * * * *).
   Ayrıntılar: KURULUM.md
   Bu dosya tools/build.mjs ile src/ klasöründen üretilir; elle düzenlemeyin.
   ════════════════════════════════════════════════════════════════ */

${server}

/* ── Gömülü uygulama dosyaları (HTML, service worker, manifest, ikonlar) ── */
const ASSETS = ${JSON.stringify(ASSETS)};

export default makeWorker(ASSETS);
`;
writeFileSync(new URL('../worker.js', import.meta.url), out);
console.log(`derleme ${BUILD} · worker.js yazıldı: ${(out.length / 1024).toFixed(0)} KB (HTML ${(page.length / 1024).toFixed(0)} KB), önbellek ${hash}`);
