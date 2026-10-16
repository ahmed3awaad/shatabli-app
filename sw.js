// Offline shell for Shatabli. Only caches this site's own files;
// Supabase data always comes fresh from the network.
const CACHE = 'shatabli-app-v4';
const SHELL = ['./', 'index.html', 'styles.css', 'app.css', 'config.js', 'icons.js', 'legal.js', 'app.js', 'manifest.webmanifest',
  'img/logo.jpg', 'img/logo-full.jpg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
