# Anımsa — Sesli & yazılı hatırlatıcı (iPhone PWA)

"Saat 14:00'te Ahmet aranacak" deyin ya da yazın; Anımsa saati ve görevi kendisi anlar, zamanı gelince telefon kilitliyken bile bildirim gönderir.

- **Kurulum:** [KURULUM.md](KURULUM.md). Tek dosya `worker.js`'i Cloudflare'e yapıştırmak yeterli.
- **Dağıtılacak dosya:** `worker.js` (derlenmiş, her şey içinde: arayüz, service worker, ikonlar, API, zamanlayıcı)

## Geliştirme

```
src/parser.js        Türkçe anlama motoru (kural tabanlı, internetsiz)
src/push.js          Web Push: VAPID JWT (ES256) + RFC 8291 aes128gcm şifreleme, kütüphanesiz
src/server.js        Worker: API uç noktaları, cron, statik dosyalar
src/client/          index.html, app.css, app.js, sw.js
src/icons/           Ana ekran ikonları (tools/icons.mjs ile üretilir)
tools/build.mjs      src/ → worker.js
tools/serve.mjs      Yerel sunucu (bellek içi KV): node tools/serve.mjs
test/                parser, push (kripto), worker (API+cron), ui (Playwright)
```

```
node tools/build.mjs                      # worker.js üret
TZ=Europe/Istanbul node test/parser.test.mjs
node test/push.test.mjs
node test/worker.test.mjs
node test/ui.test.mjs                     # ekran görüntüleri test/screens/
```

Ayrıştırıcı test tablosu: [test/parser-report.md](test/parser-report.md)
