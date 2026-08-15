(function () {
  'use strict';

  // Async: SHA-256 uses the browser's own Web Crypto (crypto.subtle.digest),
  // which is inherently promise-based. text-converter-worker.js wraps
  // convertText()'s return value in Promise.resolve() specifically to allow
  // this — every other converter here still returns a plain object.
  window.convertText = function (text) {
    if (
      typeof crypto === 'undefined' ||
      !crypto.subtle ||
      typeof crypto.subtle.digest !== 'function'
    ) {
      throw new Error('SHA-256 hashing is not supported in this browser.');
    }

    var bytes = new TextEncoder().encode(text);
    var md5Hex = md5Hex_(bytes);

    return crypto.subtle.digest('SHA-256', bytes).then(function (digest) {
      var sha256Hex = bufferToHex(digest);
      return {
        text: 'MD5:     ' + md5Hex + '\nSHA-256: ' + sha256Hex + '\n',
        filename: 'hashes.txt'
      };
    });
  };

  function bufferToHex(buffer) {
    var bytes = new Uint8Array(buffer);
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  // --- MD5 (RFC 1321) -------------------------------------------------------
  // Web Crypto has no MD5 support (deliberately, it's cryptographically
  // broken) — still requested constantly for checksums/legacy compatibility,
  // so it's implemented by hand here, the same way this codebase hand-rolls
  // its YAML/XML parsers rather than reaching for a library.

  var MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];

  // K[i] = floor(abs(sin(i + 1)) * 2^32), computed rather than hand-copied —
  // the standard MD5 constant table, derived the same way the spec defines it.
  var MD5_K = (function () {
    var k = new Uint32Array(64);
    for (var i = 0; i < 64; i++) {
      k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
    }
    return k;
  })();

  function leftRotate(x, c) {
    return ((x << c) | (x >>> (32 - c))) >>> 0;
  }

  function md5Hex_(messageBytes) {
    var originalLength = messageBytes.length;
    var bitLength = originalLength * 8;

    var paddedLength = originalLength + 1;
    while (paddedLength % 64 !== 56) paddedLength++;
    paddedLength += 8;

    var msg = new Uint8Array(paddedLength);
    msg.set(messageBytes, 0);
    msg[originalLength] = 0x80;

    // Original bit length as a 64-bit little-endian integer. bitLength fits
    // safely in the low 32 bits for any input this tool's max_file_size
    // allows (well under 2^32 bits), so the high 4 bytes are always 0.
    var view = new DataView(msg.buffer);
    view.setUint32(paddedLength - 8, bitLength >>> 0, true);
    view.setUint32(paddedLength - 4, Math.floor(bitLength / 4294967296), true);

    var a0 = 0x67452301;
    var b0 = 0xefcdab89;
    var c0 = 0x98badcfe;
    var d0 = 0x10325476;

    for (var chunkStart = 0; chunkStart < paddedLength; chunkStart += 64) {
      var m = new Uint32Array(16);
      for (var j = 0; j < 16; j++) {
        m[j] = view.getUint32(chunkStart + j * 4, true);
      }

      var A = a0,
        B = b0,
        C = c0,
        D = d0;

      for (var i = 0; i < 64; i++) {
        var F, g;
        if (i < 16) {
          F = (B & C) | (~B & D);
          g = i;
        } else if (i < 32) {
          F = (D & B) | (~D & C);
          g = (5 * i + 1) % 16;
        } else if (i < 48) {
          F = B ^ C ^ D;
          g = (3 * i + 5) % 16;
        } else {
          F = C ^ (B | ~D);
          g = (7 * i) % 16;
        }
        F = (F + A + MD5_K[i] + m[g]) >>> 0;
        A = D;
        D = C;
        C = B;
        B = (B + leftRotate(F, MD5_S[i])) >>> 0;
      }

      a0 = (a0 + A) >>> 0;
      b0 = (b0 + B) >>> 0;
      c0 = (c0 + C) >>> 0;
      d0 = (d0 + D) >>> 0;
    }

    return (
      toLittleEndianHex(a0) + toLittleEndianHex(b0) + toLittleEndianHex(c0) + toLittleEndianHex(d0)
    );
  }

  function toLittleEndianHex(word) {
    var bytes = [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, (word >>> 24) & 0xff];
    return bytes
      .map(function (b) {
        return b.toString(16).padStart(2, '0');
      })
      .join('');
  }
})();
