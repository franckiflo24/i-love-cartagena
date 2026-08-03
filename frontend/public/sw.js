// v4 — 2026-07-12 explore layout fix
const APP_VERSION = '3.1.0';

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

// v5 — Web Push (Master Plan 1.4). Payload: {title, body, url} only.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(self.registration.showNotification(d.title || 'AMO Cartagena', {
    body: d.body || '',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: { url: d.url || '/pasaporte' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/pasaporte';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if ('focus' in c) { c.navigate(url); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
