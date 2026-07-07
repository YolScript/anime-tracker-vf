// Service Worker for Anime Tracker VF - Offline Caching
const CACHE_NAME = 'anime-tracker-vf-v4';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './styles.css',
    './catalog.js',
    './app.js',
    './sync.js',
    './icon-512.png',
    './manifest.json'
];

// Install: Pre-cache core assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Pre-caching core assets');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

// Activate: Clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// Fetch: Cache-first strategy for local assets, network-first for API calls
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Never cache the APK download (binary file, direct network fetch)
    if (url.pathname.endsWith('.apk')) {
        return;
    }

    // Network-first for API calls (AniList GraphQL)
    if (url.hostname === 'graphql.anilist.co') {
        event.respondWith(
            fetch(event.request).catch(() => {
                return new Response(JSON.stringify({ data: null }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            })
        );
        return;
    }
    
    // Network-first for external resources (fonts, images)
    if (url.hostname !== location.hostname) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }
    
    // Cache-first for local assets
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                // Return cache but also update in background
                fetch(event.request).then((networkResponse) => {
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, networkResponse);
                    });
                }).catch(() => {});
                return cachedResponse;
            }
            return fetch(event.request).then((response) => {
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseClone);
                });
                return response;
            });
        })
    );
});
