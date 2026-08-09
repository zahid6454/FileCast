// Service worker registration (P3 §25 — offline support for local tools).
// Registered from '/' so its scope covers the whole origin, not just
// wherever this script happens to be served from. Runs after `load` so
// registration never competes with the page's own first-paint/first-input
// work, and is entirely progressive enhancement: a browser with no SW
// support, or a registration that fails (blocked storage, private
// browsing), leaves the site working exactly as it does today.
(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {
      /* silent — offline support is progressive enhancement, not a feature
         any page depends on to function */
    });
  });
})();
