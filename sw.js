const CACHE_NAME = 'marketscope-v13';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/src/styles.css',
  '/src/main.js',
  '/src/charts.js',
  '/src/analysis.js',
  '/src/search.js',
  '/src/strategy.js',
  '/src/market_pulse.js',
  '/src/rr_analysis.js',
  '/src/calendar.js',
  '/src/vix_term.js',
  '/src/stocks_econ.js',
  '/data/component_definitions.json'
];

// Install: cache static assets only (NOT the data JSON)
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: delete old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Fetch: Network-first for data files, cache-first for static assets
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Always go to network for data JSON and API calls
  if (url.pathname.includes('vix_decomposition_history.json') || 
      url.pathname.includes('market_calendar.json') || 
      url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Network-first for static assets: always try network, fallback to cache
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        // Update cache on success
        if (response.status === 200) {
          const respClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, respClone));
        }
        return response;
      })
      .catch(() => caches.match(e.request)) // If network fails, serve from cache
  );
});
