/* ANIMSA — Service worker: push bildirimleri + çevrimdışı uygulama kabuğu */
'use strict';
const CACHE = 'animsa-__HASH__';
const SHELL = ['/', '/manifest.webmanifest', '/icon-180.png', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('animsa-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate' || url.pathname === '/') {
    // Ağ öncelikli: güncel sürüm gelsin, çevrimdışıysa önbellekten aç
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) { const c = await caches.open(CACHE); c.put('/', res.clone()); }
        return res;
      } catch (e) {
        return (await caches.match('/')) || new Response('<h1>Çevrimdışı</h1>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }
  if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(url.pathname).then(r => r || fetch(req)));
  }
});

/* Her push mutlaka görünür bir bildirim üretir (iOS zorunluluğu) */
self.addEventListener('push', event => {
  let data = null;
  try { data = event.data ? event.data.json() : null; } catch (e) { data = null; }
  const ok = data && typeof data === 'object' && typeof data.body === 'string';
  const title = ok && typeof data.title === 'string' && data.title.trim() ? data.title : '⏰ Hatırlatıcı';
  const opts = {
    body: ok ? data.body : 'Hatırlatıcı zamanı',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: ok && data.id ? 'animsa-' + data.id : 'animsa',
    renotify: true,
    silent: !!(ok && data.silent),
    timestamp: ok && Number.isFinite(data.at) ? data.at : Date.now(),
    data: { url: ok && typeof data.url === 'string' ? data.url : '/', id: ok ? data.id : null }
  };
  event.waitUntil((async () => {
    try { await self.registration.showNotification(title, opts); }
    catch (e) { await self.registration.showNotification('⏰ Hatırlatıcı', { body: 'Hatırlatıcı zamanı', icon: '/icon-192.png' }); }
    // Ana ekran simgesinde bekleyen bildirim sayısı (iOS 16.4+)
    try {
      const shown = self.registration.getNotifications ? await self.registration.getNotifications() : [];
      if (self.navigator.setAppBadge && opts.data.id !== 'test') await self.navigator.setAppBadge(Math.max(1, shown.filter(n => n.tag !== 'animsa-test').length));
    } catch (e) { /* desteklenmiyor */ }
    // Uygulama açıksa ekranda da zil göster
    try {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      wins.forEach(w => w.postMessage({ type: 'push', id: opts.data.id }));
    } catch (e) { /* yok */ }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const d = event.notification.data || {};
  const url = new URL(d.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        try { await w.focus(); } catch (e) { /* yok */ }
        w.postMessage({ type: 'open', id: d.id });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
