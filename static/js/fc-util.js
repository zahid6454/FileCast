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

  // Input size in KB for the history row. `file_size_kb` is an integer column, so
  // anything under 512 bytes used to round to 0 and the account page rendered a
  // successful conversion as "0 KB" (a 700-byte SVG, say). Floor a non-empty file
  // at 1 KB — "1 KB" is a rounding artefact, "0 KB" reads as a failed conversion.
  FC.sizeKb = function (bytes) {
    if (!bytes || bytes < 0) return 0;
    return Math.max(1, Math.round(bytes / 1024));
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

  // Fire-and-forget failure-detail reporting (POST /api/v1/errors) — public,
  // anonymous, rate-limited server-side. The admin panel's "Failures" stat
  // card (fed by postConversion above) only ever sees a bare per-tool-per-
  // day counter, so admins could see failures were happening but not *why*;
  // this feeds the separate "Recent errors" feed (admin/dom.js), which
  // already renders error_message/error_type/browser safely but had no
  // client caller until now. Call alongside postConversion(..., false) at
  // every conversion-failure site.
  FC.reportError = function (payload) {
    var apiBase = window.FILECAST && window.FILECAST.apiBase;
    if (!apiBase) return;
    fetch(apiBase.replace(/\/$/, '') + '/api/v1/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(function () {
      /* silent — progressive enhancement, matches postConversion */
    });
  };

  // Custom Sentry context for the conversion in flight (P2 §24). Called at
  // conversion_started from shared.js/shared-multi.js/shared-text.js, so an
  // uncaught error during THIS conversion (Sentry auto-captures those; nothing
  // here calls captureException directly) carries tool/file/mode alongside the
  // stack trace instead of triage starting from a bare exception. Browser
  // name/version needs no help — Sentry's own default integrations already
  // attach that. Guarded the same way analytics.js guards Sentry.init: a
  // blocked/failed CDN load must not throw here either.
  FC.setSentryContext = function (data) {
    if (window.Sentry && typeof window.Sentry.setContext === 'function') {
      window.Sentry.setContext('conversion', data);
    }
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

  // On Android, <input accept="image/*"> opens the OS Photo Picker, which
  // hands back a File backed by a short-lived content:// reference instead
  // of a plain local file. Reading that reference has been observed to fail
  // — net::ERR_UPLOAD_FILE_CHANGED — intermittently: the same file, same
  // code, succeeding or failing across separate picks with nothing else
  // different. Root-caused live (remote debugging a real device against
  // this exact file): shared.js's own thumbnail preview AND the active
  // converter's decode were both independently calling
  // URL.createObjectURL(file) on the SAME original File — two separate
  // reads of a reference that appears to only reliably support one. Fixing
  // either side alone still left the other racing it.
  //
  // FC.materializeFile is the single point every consumer (shared.js's
  // thumbnail, plus each converter's own preview/convert code) must go
  // through instead of touching the original File directly. Keyed by the
  // File object itself, so no matter how many separate listeners ask for
  // it, file.arrayBuffer() — which reads bytes directly rather than routing
  // through a blob: network fetch — runs exactly once; every caller shares
  // that one in-flight/resolved promise and gets back a plain in-memory
  // File, fully decoupled from the original picker reference from then on.
  var materializeCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  var MATERIALIZE_TIMEOUT_MS = 6000;
  var MATERIALIZE_RETRIES = 2; // transient permission-grant flakiness, not a bad file — worth a couple of quick retries

  function materializeOnce(file) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('Timed out reading file.'));
      }, MATERIALIZE_TIMEOUT_MS);

      file.arrayBuffer().then(
        function (buf) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(new File([buf], file.name, { type: file.type, lastModified: file.lastModified }));
        },
        function (err) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  function materializeWithRetry(file, attemptsLeft) {
    if (attemptsLeft === undefined) attemptsLeft = MATERIALIZE_RETRIES;
    return materializeOnce(file).catch(function (err) {
      if (attemptsLeft <= 0) return Promise.reject(err);
      return new Promise(function (resolve) {
        setTimeout(resolve, 500);
      }).then(function () {
        return materializeWithRetry(file, attemptsLeft - 1);
      });
    });
  }

  FC.materializeFile = function (file) {
    if (!materializeCache) return materializeWithRetry(file);
    var cached = materializeCache.get(file);
    if (!cached) {
      cached = materializeWithRetry(file);
      materializeCache.set(file, cached);
      // A failed attempt must not poison the cache forever — a later retry
      // (e.g. the user re-triggers Convert) should get a fresh attempt, not
      // an already-rejected promise replayed indefinitely.
      cached.catch(function () {
        if (materializeCache.get(file) === cached) materializeCache.delete(file);
      });
    }
    return cached;
  };
})();
