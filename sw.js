// FamilySOS service worker
// Purpose: cache the app "shell" (HTML/CSS/JS files) so the app opens instantly
// and still loads even with a poor connection. It does NOT cache live data
// like alerts or family info — that always comes fresh from Firestore.

const CACHE_NAME = 'familysos-shell-v5';

const SHELL_FILES = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/auth.js',
  '/js/family.js',
  '/js/sos.js',
  '/js/alerts.js',
  '/js/contacts.js',
  '/js/firebase-config.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// On install: download and cache the shell files.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

// On activate: remove any old cache versions left over from a previous deploy.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// On fetch: serve shell files from cache first (fast, works offline).
// Everything else (Firestore calls, etc.) goes straight to the network as normal.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only apply our cache-first strategy to same-origin GET requests for shell files.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).catch(() => {
          // If offline and not cached, fall back to the main page shell.
          return caches.match('/index.html');
        })
      );
    })
  );
});
