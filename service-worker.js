/* Bobcat Scout service worker — makes the app work fully offline after first load.
   Strategy: cache the app shell on install; serve same-origin GETs
   stale-while-revalidate (instant from cache, refreshed in the background).
   Cross-origin requests (e.g. the Google Apps Script submit) are left untouched. */

const CACHE = 'bobcat-scout-v33';
const ASSETS = [
  '.',
  'browser-check.js',
  'index.html',
  'styles.css',
  'app.js',
  'demo.js',
  'practice-data.js',
  'trainer-core.js',
  'practice-gen.js',
  'trainer.js',
  'trainer.css',
  'pit-form.js',
  'pit-core.js',
  'pit.js',
  'pit.css',
  'super-form.js',
  'super-core.js',
  'super.js',
  'super.css',
  'assign-core.js',
  'assign.js',
  'assign.css',
  'push-ui.js',
  'demo.css',
  'team-config.js',
  'scout-modes.js',
  'scout-lexicon.js',
  'generic-fill.js',
  'fix-core.js',
  'config.json',
  'assets/field-layout.jpg',
  'vendor/qrcode-generator.js',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' skips the browser's own HTTP cache, which could hand back the
      // previous version's files for a few minutes after an update.
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // don't intercept Apps Script / CDN calls

  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((resp) => {
            if (resp && resp.status === 200) cache.put(req, resp.clone());
            return resp;
          })
          .catch(() => cached);
        return cached || network;
      })
    )
  );
});

// Shift reminders (push-ui.js turns them on; worker/push.js sends them). The message is JSON:
// { title, body, tag, url }. The same tag replaces an earlier notification instead of stacking.
self.addEventListener('push', (event) => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch (e) { m = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(String(m.title || 'Bobcat Scout'), {
    body: String(m.body || ''),
    tag: m.tag ? String(m.tag) : 'bobcat-scout',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { url: typeof m.url === 'string' && m.url.charAt(0) === '/' ? m.url : '/' }
  }));
});

// Tapping the notification brings the app to the front (or opens it).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    })
  );
});
