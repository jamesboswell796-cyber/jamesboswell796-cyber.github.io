const CACHE_NAME = 'quick-notes-menubarx-v0.4.0';
const APP_SHELL = [
  './',
  './index.html',
  './menubarx.html',
  './menubarx.css',
  './menubarx.js',
  './app.js',
  './app-core.js',
  './manifest.webmanifest',
  '../css/writing.css',
  '../icons/icon48.png',
  '../icons/icon128.png',
  '../js/appearance.js',
  '../js/autosave.js',
  '../js/backup-service.js',
  '../js/backup.js',
  '../js/draft-cache.js',
  '../js/export.js',
  '../js/file-handles.js',
  '../js/markdown.js',
  '../js/model.js',
  '../js/note-discovery.js',
  '../js/note-markdown.js',
  '../js/safety-snapshots.js',
  '../js/storage.js',
  '../js/web-storage.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }))
  );
});
