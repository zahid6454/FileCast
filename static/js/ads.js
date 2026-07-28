// Requests one AdSense fill per <ins class="adsbygoogle"> on the page, and
// collapses the slots that never fill.
//
// AdSense's documented snippet is an INLINE <script> per unit
// (`(adsbygoogle = window.adsbygoogle || []).push({})`). Inline script is
// forbidden site-wide (ledger P6/P7 — `script-src 'self'`, never
// 'unsafe-inline'), so this mirrors the analytics.js pattern instead: the
// vendor loader is an allowlisted external src and this file is self-hosted, so
// `script-src 'self' + pagead2` holds with no inline anything.
//
// base.html loads this DEFERRED, unlike analytics.js. The <ins> elements must
// already be in the DOM when it runs; non-deferred it finds zero units and
// silently pushes nothing. Do not copy analytics.js's non-deferred loading here
// — that exists so Sentry.init catches early errors, which ads do not need.
(function () {
  'use strict';

  // How long to wait before assuming a unit that has reported NOTHING never
  // will. Only silent units reach this: a real response sets data-ad-status and
  // is handled by the observer the instant it lands, however late that is.
  //
  // 🔴 Do NOT reintroduce "collapse anything with no height yet" on a short
  // timer. That conflates BLOCKED with NOT LOADED YET, and the two need
  // opposite handling. `ads.js` is deferred, so its clock starts at
  // DOMContentLoaded, while the vendor loader is async and may not even have
  // executed by then — on a slow connection the ad round-trip routinely
  // outlives a 2s timer. Collapsing there hides a slot that then fills anyway:
  // revenue lost precisely on slow connections, and an impression served into a
  // display:none box is the shape Google's policy treats as non-viewable.
  var SILENT_UNIT_TIMEOUT_MS = 10000;

  var units = document.querySelectorAll('ins.adsbygoogle');
  if (!units.length) return;

  window.adsbygoogle = window.adsbygoogle || [];
  for (var i = 0; i < units.length; i++) {
    // A blocked or failed loader leaves adsbygoogle as a plain array whose push
    // is harmless, but an ad blocker can also replace it with a stub that
    // throws. Either way a failed request must not break the page — the unit
    // just stays silent, and the timeout below collapses it.
    try {
      window.adsbygoogle.push({});
    } catch (e) {
      /* blocked or failed */
    }
  }

  function slotOf(ins) {
    return ins.closest ? ins.closest('.ad-slot') : null;
  }

  // Google sets data-ad-status on the <ins> when the response lands: 'filled'
  // or 'unfilled'. That is the authoritative signal, and it is the only one
  // that distinguishes "no ad for you" from "not yet".
  function applyStatus(ins) {
    var slot = slotOf(ins);
    if (!slot) return;
    var status = ins.getAttribute('data-ad-status');
    if (status === 'unfilled') {
      slot.style.display = 'none'; // no layout reserved for nothing
    } else if (status === 'filled') {
      // Restore: a late fill must survive the silent-unit timeout having
      // already hidden the slot. This is what makes the timeout safe.
      slot.style.display = '';
    }
  }

  // Left connected for the page's lifetime on purpose — two units per page, and
  // disconnecting would forfeit the late-fill restore above.
  if (typeof MutationObserver === 'function') {
    var observer = new MutationObserver(function (records) {
      for (var r = 0; r < records.length; r++) applyStatus(records[r].target);
    });
    for (i = 0; i < units.length; i++) {
      observer.observe(units[i], {
        attributes: true,
        attributeFilter: ['data-ad-status']
      });
    }
  }

  // Catch a status that was already set before the observer attached.
  for (i = 0; i < units.length; i++) applyStatus(units[i]);

  // The ad-blocker case, and only it: the loader never ran, so nothing will
  // ever set data-ad-status. This audience skews privacy-conscious (see
  // api/data/fingerprint.py), so a blocked ad is common and a permanent blank
  // 90/280px box is the wrong default. Height is consulted only as a reason NOT
  // to collapse — if something rendered without reporting a status, leave it be.
  setTimeout(function () {
    for (var j = 0; j < units.length; j++) {
      var ins = units[j];
      if (ins.getAttribute('data-ad-status') || ins.offsetHeight !== 0) continue;
      var slot = slotOf(ins);
      if (slot) slot.style.display = 'none';
    }
  }, SILENT_UNIT_TIMEOUT_MS);
})();
