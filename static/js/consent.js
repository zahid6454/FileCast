// Cookie consent gate for GA4 + AdSense.
//
// Neither vendor's network-contacting loader is referenced by a static
// <script src> in base.html. analytics.js's GA4 branch and ads.js both only
// push to a local queue array (window.dataLayer / window.adsbygoogle) —
// that's not a network request and sets no cookie. The queued entries sit
// inert until the real vendor script (gtag.js / adsbygoogle.js) loads and
// drains the queue, which is the moment _ga/_gid or DoubleClick cookies
// actually get set. This file decides whether that loading ever happens,
// gated on a stored consent decision.
//
// Config arrives as a JSON data island (#cookie-consent-config), the same
// pattern as filecast-config.js/tool-config.js — not document.currentScript,
// so this stays testable via a plain eval() harness with no real <script>
// element involved.
(function () {
  'use strict';

  var STORAGE_KEY = 'fc_cookie_consent';

  var configEl = document.getElementById('cookie-consent-config');
  if (!configEl) return;
  var config;
  try {
    config = JSON.parse(configEl.textContent);
  } catch (e) {
    return;
  }

  function injectVendorScript(src) {
    var s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.crossOrigin = 'anonymous';
    document.head.appendChild(s);
  }

  function loadConsentedScripts() {
    if (config.ga4_src) injectVendorScript(config.ga4_src);
    if (config.adsense_src) injectVendorScript(config.adsense_src);
  }

  var decision = null;
  try {
    decision = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    // Storage blocked (private mode / disabled) — treat as undecided, ask
    // again rather than silently defaulting either way.
  }

  if (decision === 'granted') {
    loadConsentedScripts();
    return;
  }
  if (decision === 'denied') {
    return;
  }

  var banner = document.getElementById('cookie-consent');
  if (!banner) return;
  banner.classList.remove('hidden');

  var acceptBtn = document.getElementById('cookie-consent__accept');
  var rejectBtn = document.getElementById('cookie-consent__reject');

  if (acceptBtn) {
    acceptBtn.addEventListener('click', function () {
      try {
        localStorage.setItem(STORAGE_KEY, 'granted');
      } catch (e) {}
      banner.classList.add('hidden');
      loadConsentedScripts();
    });
  }
  if (rejectBtn) {
    rejectBtn.addEventListener('click', function () {
      try {
        localStorage.setItem(STORAGE_KEY, 'denied');
      } catch (e) {}
      banner.classList.add('hidden');
    });
  }
})();
