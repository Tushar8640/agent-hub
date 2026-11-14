// Service worker: caches the app shell so the PWA opens instantly and installs. API calls are never cached.
// Wrapped in a function so its names do not clash with app.ts (both compile as plain scripts).
(() => {
  interface SwEvent { waitUntil(p: Promise<unknown>): void }
  interface SwFetchEvent extends SwEvent { request: Request; respondWith(r: Promise<Response>): void }
  const sw = self as unknown as {
    addEventListener(type: 'install' | 'activate', fn: (e: SwEvent) => void): void;
    addEventListener(type: 'fetch', fn: (e: SwFetchEvent) => void): void;
    skipWaiting(): Promise<void>;
    clients: { claim(): Promise<void> };
    location: Location;
  };

  const CACHE = 'agent-hub-v1';
  const SHELL = ['/', '/index.html', '/app.js', '/style.css', '/icon.svg', '/manifest.webmanifest'];

  sw.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
    sw.skipWaiting();
  });

  sw.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
    sw.clients.claim();
  });

  // Network first (so updates show at once), cache as the offline fallback.
  sw.addEventListener('fetch', e => {
    const url = new URL(e.request.url);
    if (e.request.method !== 'GET' || url.origin !== sw.location.origin || url.pathname.startsWith('/api/')) return;
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
          return res;
        })
        .catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')).then(r => r || new Response('Offline', { status: 503 }))),
    );
  });
})();
