(function () {
  'use strict';

  // Auto-detects direction, same pattern as base64-encode-decode.js: if the
  // input contains a percent-encoded sequence and decodes cleanly, decode
  // it; otherwise encode it. A plain string with no "%XX" sequences at all
  // has nothing to decode, so it's encoded by default.
  var PERCENT_ENCODED_RE = /%[0-9A-Fa-f]{2}/;

  window.convertText = function (text) {
    if (PERCENT_ENCODED_RE.test(text)) {
      try {
        return { text: decodeURIComponent(text), filename: 'decoded.txt' };
      } catch (e) {
        // Malformed percent-encoding (e.g. a stray "%" that isn't part of a
        // real escape sequence) — fall through and encode the raw input.
      }
    }
    return { text: encodeURIComponent(text), filename: 'encoded.txt' };
  };
})();
