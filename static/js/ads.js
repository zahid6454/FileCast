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
      /* blocked or failed — the slot just stays empty */
    }
  }
})();
