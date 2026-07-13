// Parses the site-wide #filecast-config JSON data island into window.FILECAST.
// Mirrors tool-config.js exactly: the config ships as an inert
// <script type="application/json"> block (CSP-safe under `script-src 'self'`),
// and this external SRI'd script reads it — never an inline script.
//
// Loaded (deferred) BEFORE nav.js so nav.js sees window.FILECAST.apiBase, the
// single site-wide API origin for client JS (the announcement fetch today;
// conversion-tracking + ratings in later phases). Replaces the archived
// window.WORKER_API_URL hostname hack (ledger F2).
(function () {
  'use strict';
  window.FILECAST = window.FILECAST || {};
  var el = document.getElementById('filecast-config');
  if (!el) return;
  try {
    var parsed = JSON.parse(el.textContent);
    window.FILECAST.apiBase = parsed.api_base_url;
  } catch (e) {
    console.error('FileCast: failed to parse site config', e);
  }
})();
