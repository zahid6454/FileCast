(function () {
  'use strict';

  // Recognized by magic bytes rather than trusted from a claimed data: URL
  // mime type — a mislabeled or bare Base64 string (no data: prefix at all)
  // still needs a real extension/mime to download as a working image file.
  var SIGNATURES = [
    { mime: 'image/png', ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    { mime: 'image/jpeg', ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
    { mime: 'image/gif', ext: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] },
    { mime: 'image/bmp', ext: 'bmp', bytes: [0x42, 0x4d] }
    // WebP checked separately below (RIFF....WEBP, not a fixed prefix run).
  ];

  window.convertText = function (text) {
    var trimmed = text.trim();
    var payload = trimmed;

    var dataUrlMatch = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(trimmed);
    if (dataUrlMatch) {
      if (!dataUrlMatch[2]) {
        throw new Error('This data URL is not Base64-encoded (missing ";base64").');
      }
      payload = dataUrlMatch[3];
    }

    payload = payload.replace(/\s+/g, '');
    if (!payload) {
      throw new Error('Paste a Base64 image string or a data:image/...;base64,... URL.');
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
      throw new Error('This does not look like valid Base64 — check for stray characters.');
    }

    var bytes;
    try {
      bytes = base64ToBytes(payload);
    } catch (e) {
      throw new Error('Could not decode this Base64 string: ' + e.message);
    }

    var format = detectImageFormat(bytes);
    if (!format) {
      throw new Error(
        'The decoded data is not a recognized image format (PNG, JPEG, GIF, WebP, or BMP).'
      );
    }

    return {
      text: 'data:' + format.mime + ';base64,' + payload,
      filename: 'image.' + format.ext
    };
  };

  function base64ToBytes(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function detectImageFormat(bytes) {
    for (var i = 0; i < SIGNATURES.length; i++) {
      if (matchesSignature(bytes, SIGNATURES[i].bytes)) return SIGNATURES[i];
    }
    if (
      bytes.length >= 12 &&
      matchesSignature(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return { mime: 'image/webp', ext: 'webp' };
    }
    return null;
  }

  function matchesSignature(bytes, signature) {
    if (bytes.length < signature.length) return false;
    for (var i = 0; i < signature.length; i++) {
      if (bytes[i] !== signature[i]) return false;
    }
    return true;
  }
})();
