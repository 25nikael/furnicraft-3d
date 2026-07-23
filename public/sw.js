/**
 * FurniCraft 3D service worker — app shell offline, projects online.
 *
 * Deliberate policy:
 *  - /api/* is NEVER touched. Projects, auth and AI must always hit the
 *    network, so a stale cached project can never overwrite newer cloud work
 *    or be mistaken for the live one.
 *  - Navigations are network-first with a cached fallback, so a deploy is
 *    picked up immediately when online but the app still launches offline.
 *  - Everything else (app HTML, icons, and the self-hosted /vendor libraries)
 *    is cache-first, which is what makes an offline launch work on the web PWA.
 *    The 3D libraries are now same-origin under /vendor (R61), so there is no
 *    cross-origin/opaque-response problem to work around anymore.
 *
 * (The Android APK is offline-first by bundling, not by this worker — it ships
 * all of /vendor inside the package. See native-bridge.js and MOBILE.md.)
 */
// Third-party origins that must always go straight to the network.
var BYPASS = ['accounts.google.com', 'apis.google.com'];
var CACHE = 'fc3d-shell-v2';
var SHELL = [
  '/',
  '/landing',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      // addAll is atomic — one 404 would abort the whole install, so add
      // individually and tolerate misses.
      .then(function (c) { return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); })); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                       // never cache writes

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // API traffic always goes straight to the network, uncached.
  if (url.origin === self.location.origin && url.pathname.indexOf('/api/') === 0) return;
  // Auth/identity SDKs must never be cached or intercepted.
  if (BYPASS.indexOf(url.hostname) !== -1) return;

  // Page loads: fresh when online, cached shell when not.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(function (resp) {
          var copy = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
          return resp;
        })
        .catch(function () {
          return caches.match(req).then(function (hit) { return hit || caches.match('/'); });
        })
    );
    return;
  }

  // Static assets, same-origin or CDN: cache-first, fill on first success.
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (resp) {
        // Only store real successes — an opaque/error response cached here
        // would poison the shell until the next version bump.
        if (resp && resp.ok) {
          var copy = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        }
        return resp;
      });
    })
  );
});
