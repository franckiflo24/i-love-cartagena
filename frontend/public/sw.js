// v3 — 2026-07-10 force refresh after major data cleanup (817→782)
const APP_VERSION = '3.0.0';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() =>
        self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(c => c.postMessage({ type: 'SW_UPDATED', version: APP_VERSION }));
        })
      )
  );
});

self.addEventListener('fetch', (e) => e.respondWith(fetch(e.request)));
