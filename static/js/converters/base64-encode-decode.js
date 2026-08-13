(function () {
  'use strict';

  // Auto-detects direction the same way css-js-minifier.js auto-detects
  // CSS vs. JS: one tool, no mode toggle. If the trimmed input is
  // syntactically valid Base64 AND decodes to valid UTF-8 text, treat it as
  // a decode; anything else (including "valid-looking" Base64 that happens
  // to decode to garbage bytes) falls back to encoding it.
  var BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

  window.convertText = function (text) {
    var trimmed = text.trim();

    if (trimmed && trimmed.length % 4 === 0 && BASE64_RE.test(trimmed)) {
      try {
        var bytes = base64ToBytes(trimmed);
        var decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return { text: decoded, filename: 'decoded.txt' };
      } catch (e) {
        // Not actually valid UTF-8 text once decoded — fall through to encode.
      }
    }

    var encoded = bytesToBase64(new TextEncoder().encode(text));
    return { text: encoded, filename: 'encoded.txt' };
  };

  function base64ToBytes(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // btoa() only accepts Latin1 strings, so bytes are converted to a binary
  // string in chunks (avoids a "too many arguments" stack error from
  // String.fromCharCode.apply on large inputs) before encoding.
  function bytesToBase64(bytes) {
    var CHUNK = 0x8000;
    var binary = '';
    for (var i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }
})();
