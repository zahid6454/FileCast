// Initializes GA4 and/or Sentry from config passed via data-* attributes on
// this script tag, instead of an inline <script>. This keeps the page
// compatible with a strict `script-src 'self'` CSP: the only executable
// scripts are self-hosted (this file) or the vendor CDNs already allowlisted
// in generate_headers() when the feature is enabled.
//
// Loaded with `defer`, immediately after the (also deferred) vendor SDK tag.
// `defer` scripts execute in document order, so this still runs right after
// Sentry's bundle regardless of which one finishes downloading first — see
// the loader comment in base.html for why that ordering is load-bearing.
(function () {
  'use strict';
  var self = document.currentScript;
  if (!self) return;

  var gaId = self.getAttribute('data-ga4-id');
  var sentryDsn = self.getAttribute('data-sentry-dsn');

  // GA4: standard gtag bootstrap (dataLayer is a queue, so ordering relative
  // to the async gtag.js library does not matter).
  if (gaId) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', gaId, { send_page_view: true });
  }

  // Sentry: only if the CDN SDK loaded (guarded so a blocked/failed CDN load
  // never throws).
  if (sentryDsn && window.Sentry && typeof window.Sentry.init === 'function') {
    window.Sentry.init({
      dsn: sentryDsn,
      environment: 'production',
      sampleRate: 0.5,
      beforeSend: function (event) {
        if (event.extra) {
          delete event.extra.fileName;
          delete event.extra.filePath;
        }
        return event;
      }
    });
  }
})();
