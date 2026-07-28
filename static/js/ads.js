// Requests one AdSense fill per <ins class="adsbygoogle"> on the page.
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

  // How long to give a unit before treating it as unfilled. Long enough that a
  // slow-but-successful fill is not hidden (see collapseUnfilled).
  var COLLAPSE_DELAY_MS = 2000;

  var units = document.querySelectorAll('ins.adsbygoogle');
  if (!units.length) return;

  window.adsbygoogle = window.adsbygoogle || [];
  for (var i = 0; i < units.length; i++) {
    // A blocked or failed loader leaves adsbygoogle as a plain array whose push
    // is harmless, but an ad blocker can also replace it with a stub that
    // throws. Either way a failed request must not break the page.
    try {
      window.adsbygoogle.push({});
    } catch (e) {
      /* blocked or failed — the slot just stays empty, and collapses below */
    }
  }

  // Collapse any slot that never filled, rather than leaving a reserved 90px or
  // 280px blank box. FileCast's audience skews privacy-conscious (see
  // api/data/fingerprint.py) so expect a higher-than-typical blocked share.
  //
  // Collapsing after a delay is itself a layout shift, but a one-time collapse
  // of an empty box beats a permanent gap. Do NOT collapse eagerly: a
  // slow-but-successful fill would be hidden.
  function collapseUnfilled() {
    var slots = document.querySelectorAll('.ad-slot');
    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      var ins = slot.querySelector('ins.adsbygoogle');
      if (!ins) continue;
      if (ins.getAttribute('data-ad-status') === 'unfilled' || ins.offsetHeight === 0) {
        slot.style.display = 'none';
      }
    }
  }

  setTimeout(collapseUnfilled, COLLAPSE_DELAY_MS);
})();
