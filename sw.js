/* ═══════════════════════════════════════════════════════════
   ANTIGRAVITY — Service Worker
   Cache-first strategy for frames, stale-while-revalidate
   for static assets (HTML, CSS, JS, fonts)
   ═══════════════════════════════════════════════════════════ */

const CACHE_NAME = 'antigravity-v1';
const STATIC_CACHE = 'antigravity-static-v1';
const FRAME_CACHE = 'antigravity-frames-v1';

// Static assets to pre-cache on install
const STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
];

/* ── Install: pre-cache static assets ──────────────────── */
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

/* ── Activate: clean up old caches ─────────────────────── */
self.addEventListener('activate', (event) => {
    const validCaches = [STATIC_CACHE, FRAME_CACHE];
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => !validCaches.includes(k))
                    .map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

/* ── Fetch: route to appropriate strategy ──────────────── */
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Frame images → cache-first (immutable assets)
    if (url.pathname.includes('/frames/') && url.pathname.endsWith('.png')) {
        event.respondWith(cacheFirst(event.request, FRAME_CACHE));
        return;
    }

    // Static assets (same origin) → stale-while-revalidate
    if (url.origin === self.location.origin) {
        event.respondWith(staleWhileRevalidate(event.request, STATIC_CACHE));
        return;
    }

    // Everything else (fonts, CDN) → cache-first with network fallback
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
});

/* ── Cache-First Strategy ──────────────────────────────── */
async function cacheFirst(request, cacheName) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        return new Response('', { status: 408, statusText: 'Offline' });
    }
}

/* ── Stale-While-Revalidate Strategy ───────────────────── */
async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);

    // Always fetch fresh in background
    const fetchPromise = fetch(request).then((response) => {
        if (response.ok) {
            cache.put(request, response.clone());
        }
        return response;
    }).catch(() => cached);

    // Return cached immediately if available, otherwise wait for network
    return cached || fetchPromise;
}
