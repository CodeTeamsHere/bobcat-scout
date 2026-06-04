/* Bobcat Scout service worker — makes the app work fully offline after first load.
   Strategy: cache the app shell on install; serve same-origin GETs
   stale-while-revalidate (instant from cache, refreshed in the background).
   Cross-origin requests (e.g. the Google Apps Script submit) are left untouched. */

const CACHE = 'bobcat-scout-v7';
const ASSETS = [
  '.',
  'index.html',
  'styles.css',
  'app.js',
  'analytics.js',
  'config.json',
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
      .then((cache) => cache.addAll(ASSETS))
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
