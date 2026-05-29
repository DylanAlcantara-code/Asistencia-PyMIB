// ═══════════════════════════════════════
//  service-worker.js — Offline caching
//  PyMIB Attendance System
// ═══════════════════════════════════════

const CACHE_NAME = 'pymib-attendance-v12';

// Files to cache for full offline support
const STATIC_ASSETS = [
  './',
  './index.html',
  './supervisor.html',
  './worker.html',
  './styles.css',
  './app.js',
  './qr.js',
  './qr-bundle.js',
  './scanner.js',
  './db.js',
  './sync.js',
  './manifest.json',
  './manifest-supervisor.json',
  './manifest-worker.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/pymib-logo.png',
  './vendor/qrcode.min.js',
  './vendor/html5-qrcode.min.js',
  'https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Share+Tech+Mono&family=Exo+2:wght@300;400;500;600;700&display=swap',
];

// ── INSTALL ───────────────────────────
self.addEventListener('install', (event) => {
  console.log('[PyMIB SW] Instalando Service Worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[PyMIB SW] Cacheando archivos estáticos...');
        // Cache each asset individually to avoid one failure breaking all
        return Promise.allSettled(
          STATIC_ASSETS.map(url =>
            cache.add(url).catch(err =>
              console.warn(`[PyMIB SW] No se pudo cachear: ${url}`, err)
            )
          )
        );
      })
      .then(() => {
        console.log('[PyMIB SW] Service Worker instalado ✓');
        return self.skipWaiting();
      })
  );
});

// ── ACTIVATE ──────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[PyMIB SW] Activando Service Worker...');
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => {
              console.log('[PyMIB SW] Eliminando cache antiguo:', key);
              return caches.delete(key);
            })
        )
      )
      .then(() => {
        console.log('[PyMIB SW] Service Worker activo ✓');
        return self.clients.claim();
      })
  );
});

// ── FETCH ─────────────────────────────
self.addEventListener('fetch', (event) => {
  // Don't intercept Google Apps Script requests
  if (event.request.url.includes('script.google.com')) {
    return;
  }

  // Don't intercept non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) {
          // Serve from cache; also update in background (stale-while-revalidate)
          const fetchPromise = fetch(event.request)
            .then(networkRes => {
              if (networkRes && networkRes.status === 200) {
                const cloned = networkRes.clone();
                caches.open(CACHE_NAME)
                  .then(cache => cache.put(event.request, cloned));
              }
              return networkRes;
            })
            .catch(() => null);

          return cached;
        }

        // Not cached — fetch from network and store
        return fetch(event.request)
          .then(networkRes => {
            if (!networkRes || networkRes.status !== 200 || networkRes.type === 'opaque') {
              return networkRes;
            }
            const cloned = networkRes.clone();
            caches.open(CACHE_NAME)
              .then(cache => cache.put(event.request, cloned));
            return networkRes;
          })
          .catch(() => {
            // Offline fallback for navigation requests
            if (event.request.mode === 'navigate') {
              const url = new URL(event.request.url);
              if (url.pathname.endsWith('/worker.html')) {
                return caches.match('./worker.html');
              }
              if (url.pathname.endsWith('/supervisor.html')) {
                return caches.match('./supervisor.html');
              }
              return caches.match('./index.html');
            }
            return new Response('Offline', { status: 503 });
          });
      })
  );
});

// ── BACKGROUND SYNC ───────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-attendance') {
    console.log('[PyMIB SW] Background sync triggered');
    // The main app handles actual sync logic
    // This just signals the client to try
    self.clients.matchAll().then(clients => {
      clients.forEach(client => client.postMessage({ type: 'SYNC_NOW' }));
    });
  }
});
