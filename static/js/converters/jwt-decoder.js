(function () {
  'use strict';

  // Decode-only — this tool never checks the signature, so it must never
  // claim or imply the token is valid/trusted. That's stated in the output
  // itself, not just in the page copy, so a copied result carries the same
  // warning wherever it's pasted.
  window.convertText = function (text) {
    var trimmed = text.trim();
    var parts = trimmed.split('.');

    if (parts.length !== 3) {
      throw new Error(
        'This does not look like a JWT — expected 3 dot-separated parts (header.payload.signature), found ' +
          parts.length +
          '.'
      );
    }

    var header = decodeSegment(parts[0], 'header');
    var payload = decodeSegment(parts[1], 'payload');

    var out =
      '// Header\n' +
      JSON.stringify(header, null, 2) +
      '\n\n// Payload\n' +
      JSON.stringify(payload, null, 2) +
      '\n\n// Signature — NOT verified by this tool (' +
      parts[2].length +
      ' base64url characters). Never trust these claims without server-side verification.\n' +
      parts[2];

    return { text: out, filename: 'jwt-decoded.txt' };
  };

  function decodeSegment(segment, label) {
    var json;
    try {
      json = base64UrlDecode(segment);
    } catch (e) {
      throw new Error('Could not decode the JWT ' + label + ': ' + e.message);
    }
    try {
      return JSON.parse(json);
    } catch (e) {
      throw new Error('The JWT ' + label + ' did not decode to valid JSON: ' + e.message);
    }
  }

  function base64UrlDecode(segment) {
    var base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
})();
