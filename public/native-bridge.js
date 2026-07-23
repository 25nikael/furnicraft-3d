/**
 * Native bridge — makes the app work when its assets are bundled INSIDE the
 * Android APK (Capacitor with no server.url), served from https://localhost.
 *
 * It is a strict no-op everywhere else:
 *   - normal web (production / dev server): window.Capacitor is undefined
 *   - remote-native (Capacitor with server.url): origin === the backend
 * In both of those the relative /api paths and the Express-served routes work
 * as-is, so nothing here activates.
 *
 * Bundled-native breaks two things this file fixes:
 *   1. /api/* is relative, so it would resolve to https://localhost (no backend
 *      there). We rewrite those calls to the deployed backend. CORS is enabled
 *      server-side and auth is a Bearer token, so cross-origin is fine.
 *   2. '/landing' and '/admin' are extensionless routes that only exist because
 *      Express maps them; as bundled files they are landing.html / admin.html.
 *      We expose window.fcHref() to map them and rewrite in-page links.
 *
 * Must load BEFORE any app script and before the service-worker registration.
 */
(function () {
  var BACKEND = 'https://furnicraft-3d-t77u.onrender.com';

  function nativePlatform() {
    var C = window.Capacitor;
    if (!C) return false;
    if (typeof C.isNativePlatform === 'function') return C.isNativePlatform();
    return !!(C.platform && C.platform !== 'web');
  }

  // Bundled iff we are a native app that is NOT already being served from the
  // backend origin. (Guards against the dev server on localhost:3000, where
  // Capacitor is absent, so nativePlatform() is false and we never rewrite.)
  var bundled = nativePlatform() && location.origin !== BACKEND;

  // Always defined so call sites can use them unconditionally.
  window.FC_BUNDLED = bundled;
  window.API_BASE = bundled ? BACKEND : '';
  window.fcHref = function (p) {
    if (!bundled || typeof p !== 'string') return p;
    var m = /^\/([^?#]*)([?#].*)?$/.exec(p);
    if (!m) return p;                       // not a root-relative path — leave it
    var base = m[1] || 'index', rest = m[2] || '';
    if (base.indexOf('api') === 0) return BACKEND + p;   // an API path, not a page
    if (!/\.[a-z0-9]+$/i.test(base)) base += '.html';    // add .html to routes
    return '/' + base + rest;
  };

  if (!bundled) return;   // ← everything below is bundled-native only

  // 1. Route /api/* fetches to the backend; leave bundled asset requests local.
  if (typeof window.fetch === 'function') {
    var _fetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        if (typeof input === 'string') {
          if (input.indexOf('/api') === 0) input = BACKEND + input;
        } else if (input && input.url && input.url.indexOf(location.origin + '/api') === 0) {
          input = new Request(BACKEND + input.url.slice(location.origin.length), input);
        }
      } catch (e) { /* fall through with the original input */ }
      return _fetch(input, init);
    };
  }

  // 2. Rewrite in-page links to extensionless routes once the DOM is ready.
  function fixLinks() {
    var as = document.querySelectorAll('a[href^="/"]');
    for (var i = 0; i < as.length; i++) {
      var h = as[i].getAttribute('href');
      if (!h || h.indexOf('/api') === 0) continue;
      if (/^\/[^?#]*\.[a-z0-9]+([?#]|$)/i.test(h)) continue;  // already has an extension
      as[i].setAttribute('href', window.fcHref(h));
    }
  }
  if (document.readyState !== 'loading') fixLinks();
  else document.addEventListener('DOMContentLoaded', fixLinks);
})();
