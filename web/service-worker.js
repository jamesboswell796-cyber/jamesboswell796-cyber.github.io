const CACHE_NAME = 'quick-notes-menubarx-v0.3.0';
const APP_SHELL = [
  './',
  './index.html',
  './menubarx.html',
  './menubarx.css',
  './menubarx.js',
  './manifest.webmanifest',
  '../css/writing.css',
  '../css/editor.css',
  '../icons/icon48.png',
  '../icons/icon128.png',
  '../js/appearance.js',
  '../js/autosave.js',
  '../js/backup-service.js',
  '../js/backup.js',
  '../js/draft-cache.js',
  '../js/edit-history.js',
  '../js/editor.js',
  '../js/export.js',
  '../js/file-handles.js',
  '../js/markdown-toolbar.js',
  '../js/markdown.js',
  '../js/model.js',
  '../js/note-discovery.js',
  '../js/note-edit-session.js',
  '../js/note-markdown.js',
  '../js/note-order-interaction.js',
  '../js/pip-manager.js',
  '../js/rich-editor.js',
  '../js/runtime-context.js',
  '../js/safety-snapshots.js',
  '../js/sidebar-controller.js',
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
