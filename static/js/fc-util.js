// Shared client-side converter helpers, exposed as window.FC.
//
// These five functions were previously duplicated verbatim across shared.js,
// shared-multi.js, and shared-text.js. Hoisting them into one place removes the
// drift risk (e.g. the fire-and-forget postConversion contract now lives once).
//
// Loaded (deferred) in base.html BEFORE shared.js and the shared-multi/shared-text
// handlers, so every consumer sees window.FC when its IIFE runs. Mirrors the
// filecast-config.js / tool-config.js pattern (an early, SRI'd, CSP-safe file).
(function () {
  'use strict';
  var FC = (window.FC = window.FC || {});

  FC.formatBytes = function (bytes) {
    if (bytes === 0) return '0 Bytes';
    var k = 1024;
    var sizes = ['Bytes', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  FC.trackEvent = function (name, params) {
    if (typeof gtag === 'function') {
      gtag('event', name, params);
    }
  };

  // Fire-and-forget conversion tracking (Phase 5 §5.4). Runs AFTER the download
  // is in hand, POSTs with the session cookie so the server can dual-write the
  // user's history, and — on a successful reply only — dispatches
  // `filecast:conversion` so auth.js can show "Saved ✓"/the banner from the
  // truthful `saved_to_history`. `notify=false` (failure path) POSTs for the
  // admin failure-rate but dispatches nothing. Any API outage is silent.
  FC.postConversion = function (payload, notify) {
    var apiBase = window.FILECAST && window.FILECAST.apiBase;
    if (!apiBase) return;
    fetch(apiBase.replace(/\/$/, '') + '/api/v1/conversions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (!notify) return;
        document.dispatchEvent(
          new CustomEvent('filecast:conversion', {
            detail: { saved: !!(d && d.saved_to_history) }
          })
        );
      })
      .catch(function () {
        /* silent — progressive enhancement */
      });
  };

  FC.getExtension = function (filename) {
    var parts = filename.split('.');
    return parts.length > 1 ? '.' + parts.pop().toLowerCase() : '';
  };

  FC.generateOutputFilename = function (originalName, outputExt) {
    var base = originalName.substring(0, originalName.lastIndexOf('.'));
    if (!base) base = originalName;
    return base + outputExt;
  };
})();
