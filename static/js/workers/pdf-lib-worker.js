'use strict';

// Dedicated worker for pdf-lib operations (merge/split/rotate) — P4 §36. These
// ran on the main thread via pdf-lib (pure JS, no internal worker of its own,
// unlike heic2any/browser-image-compression which already offload themselves).
// One worker instance handles exactly one job then is terminated by the caller,
// so no request/response id matching is needed.
//
// The lib URL is passed as a query param on the worker's own script URL (the
// same trick pdf.js's own workerSrc wiring uses one layer up) rather than
// hardcoded, so this file works for any hashed build of pdf-lib.min.js without
// the build needing to rewrite worker source.
var libUrl = null;
try {
  libUrl = new URL(self.location.href).searchParams.get('lib');
} catch (e) {
  /* malformed URL — importScripts below will throw a clearer error */
}
if (libUrl) {
  importScripts(libUrl);
}

function merge(files) {
  return PDFLib.PDFDocument.create()
    .then(function (mergedPdf) {
      var chain = Promise.resolve();
      files.forEach(function (bytes) {
        chain = chain
          .then(function () {
            return PDFLib.PDFDocument.load(bytes);
          })
          .then(function (doc) {
            return mergedPdf.copyPages(doc, doc.getPageIndices());
          })
          .then(function (pages) {
            pages.forEach(function (page) {
              mergedPdf.addPage(page);
            });
          });
      });
      return chain.then(function () {
        return mergedPdf.save();
      });
    })
    .then(function (bytes) {
      return { bytes: bytes };
    });
}

function split(bytes) {
  return PDFLib.PDFDocument.load(bytes).then(function (srcDoc) {
    var pageCount = srcDoc.getPageCount();
    if (pageCount < 2) {
      // Fail fast — matches the original main-thread check, done before any
      // per-page work rather than after (§36 completion note).
      throw new Error('This PDF has only one page. There is nothing to split.');
    }

    var chain = Promise.resolve();
    var parts = [];
    for (var i = 0; i < pageCount; i++) {
      (function (pageIdx) {
        chain = chain
          .then(function () {
            return PDFLib.PDFDocument.create();
          })
          .then(function (newDoc) {
            return newDoc.copyPages(srcDoc, [pageIdx]).then(function (pages) {
              newDoc.addPage(pages[0]);
              return newDoc.save();
            });
          })
          .then(function (partBytes) {
            parts.push({ bytes: partBytes, pageNum: pageIdx + 1 });
          });
      })(i);
    }
    return chain.then(function () {
      return { pageCount: pageCount, parts: parts };
    });
  });
}

function rotate(bytes, degrees) {
  return PDFLib.PDFDocument.load(bytes)
    .then(function (pdfDoc) {
      var pages = pdfDoc.getPages();
      pages.forEach(function (page) {
        var current = page.getRotation().angle;
        page.setRotation(PDFLib.degrees(current + degrees));
      });
      return pdfDoc.save();
    })
    .then(function (bytes) {
      return { bytes: bytes };
    });
}

function watermark(bytes, text, opacity, fontSize) {
  return PDFLib.PDFDocument.load(bytes)
    .then(function (pdfDoc) {
      return pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold).then(function (font) {
        var pages = pdfDoc.getPages();
        pages.forEach(function (page) {
          var size = page.getSize();
          var textWidth = font.widthOfTextAtSize(text, fontSize);
          page.drawText(text, {
            x: size.width / 2 - textWidth / 2,
            y: size.height / 2,
            size: fontSize,
            font: font,
            color: PDFLib.rgb(0.5, 0.5, 0.5),
            opacity: opacity,
            rotate: PDFLib.degrees(45)
          });
        });
        return pdfDoc.save();
      });
    })
    .then(function (bytes) {
      return { bytes: bytes };
    });
}

// position: one of bottom-center (default), bottom-left, bottom-right,
// top-center, top-left, top-right. format: "n" (default), "page-n" ("Page N"),
// or "page-of-total" ("Page N of TOTAL").
function pageNumbers(bytes, position, startNumber, format) {
  return PDFLib.PDFDocument.load(bytes)
    .then(function (pdfDoc) {
      return pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica).then(function (font) {
        var pages = pdfDoc.getPages();
        var lastNumber = startNumber + pages.length - 1;
        var fontSize = 10;
        var margin = 24;
        pages.forEach(function (page, i) {
          var num = startNumber + i;
          var label =
            format === 'page-of-total'
              ? 'Page ' + num + ' of ' + lastNumber
              : format === 'page-n'
                ? 'Page ' + num
                : String(num);
          var size = page.getSize();
          var textWidth = font.widthOfTextAtSize(label, fontSize);
          var x =
            position.indexOf('left') !== -1
              ? margin
              : position.indexOf('right') !== -1
                ? size.width - margin - textWidth
                : size.width / 2 - textWidth / 2;
          var y = position.indexOf('top') !== -1 ? size.height - margin : margin - fontSize / 3;
          page.drawText(label, {
            x: x,
            y: y,
            size: fontSize,
            font: font,
            color: PDFLib.rgb(0, 0, 0)
          });
        });
        return pdfDoc.save();
      });
    })
    .then(function (bytes) {
      return { bytes: bytes };
    });
}

function crop(bytes, margin) {
  return PDFLib.PDFDocument.load(bytes)
    .then(function (pdfDoc) {
      var pages = pdfDoc.getPages();
      pages.forEach(function (page) {
        var size = page.getSize();
        var m = Math.max(0, Math.min(margin, size.width / 2 - 1, size.height / 2 - 1));
        page.setCropBox(m, m, size.width - 2 * m, size.height - 2 * m);
      });
      return pdfDoc.save();
    })
    .then(function (bytes) {
      return { bytes: bytes };
    });
}

function flatten(bytes) {
  return PDFLib.PDFDocument.load(bytes)
    .then(function (pdfDoc) {
      var form = pdfDoc.getForm();
      if (form.getFields().length > 0) {
        form.flatten();
      }
      return pdfDoc.save();
    })
    .then(function (bytes) {
      return { bytes: bytes };
    });
}

// Best-effort PDF/A metadata tagging (adds the XMP identification block
// PDF/A readers look for), not full ISO 19005 conversion — no font-embedding
// verification, no ICC OutputIntent, no colour-space rewriting. The tool's
// own content pages say this plainly rather than implying full compliance.
function toPdfA(bytes, part) {
  return PDFLib.PDFDocument.load(bytes)
    .then(function (pdfDoc) {
      var conformance = part || '2B';
      var pdfaPart = conformance.slice(0, -1);
      var pdfaConformance = conformance.slice(-1);
      var now = new Date().toISOString();
      var instanceId = 'urn:uuid:' + generateUuidV4();
      var xmp =
        '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
        '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n' +
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
        '<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">\n' +
        '<pdfaid:part>' +
        pdfaPart +
        '</pdfaid:part>\n' +
        '<pdfaid:conformance>' +
        pdfaConformance +
        '</pdfaid:conformance>\n' +
        '</rdf:Description>\n' +
        '<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">\n' +
        '<xmp:ModifyDate>' +
        now +
        '</xmp:ModifyDate>\n' +
        '<xmp:MetadataDate>' +
        now +
        '</xmp:MetadataDate>\n' +
        '</rdf:Description>\n' +
        '<rdf:Description rdf:about="" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/">\n' +
        '<xmpMM:DocumentID>' +
        instanceId +
        '</xmpMM:DocumentID>\n' +
        '</rdf:Description>\n' +
        '</rdf:RDF>\n' +
        '</x:xmpmeta>\n' +
        '<?xpacket end="w"?>';
      var metadataStream = pdfDoc.context.stream(xmp, {
        Type: 'Metadata',
        Subtype: 'XML'
      });
      var metadataRef = pdfDoc.context.register(metadataStream);
      pdfDoc.catalog.set(PDFLib.PDFName.of('Metadata'), metadataRef);
      return pdfDoc.save();
    })
    .then(function (bytes) {
      return { bytes: bytes };
    });
}

function extractPages(bytes, pagesSpec) {
  return PDFLib.PDFDocument.load(bytes).then(function (srcDoc) {
    var indices = parsePageList(pagesSpec, srcDoc.getPageCount(), { verb: 'extract' });
    return PDFLib.PDFDocument.create()
      .then(function (newDoc) {
        return newDoc.copyPages(srcDoc, indices).then(function (pages) {
          pages.forEach(function (p) {
            newDoc.addPage(p);
          });
          return newDoc.save();
        });
      })
      .then(function (bytes) {
        return { bytes: bytes };
      });
  });
}

function removePages(bytes, pagesSpec) {
  return PDFLib.PDFDocument.load(bytes).then(function (srcDoc) {
    var pageCount = srcDoc.getPageCount();
    var toRemove = parsePageList(pagesSpec, pageCount, { verb: 'remove' });
    var removeSet = {};
    toRemove.forEach(function (i) {
      removeSet[i] = true;
    });
    var keepIndices = [];
    for (var i = 0; i < pageCount; i++) {
      if (!removeSet[i]) keepIndices.push(i);
    }
    if (keepIndices.length === 0) {
      throw new Error('Removing those pages would leave an empty PDF.');
    }
    return PDFLib.PDFDocument.create()
      .then(function (newDoc) {
        return newDoc.copyPages(srcDoc, keepIndices).then(function (pages) {
          pages.forEach(function (p) {
            newDoc.addPage(p);
          });
          return newDoc.save();
        });
      })
      .then(function (bytes) {
        return { bytes: bytes };
      });
  });
}

function organize(bytes, orderSpec) {
  return PDFLib.PDFDocument.load(bytes).then(function (srcDoc) {
    var order = parsePagePermutation(orderSpec, srcDoc.getPageCount());
    return PDFLib.PDFDocument.create()
      .then(function (newDoc) {
        return newDoc.copyPages(srcDoc, order).then(function (pages) {
          pages.forEach(function (p) {
            newDoc.addPage(p);
          });
          return newDoc.save();
        });
      })
      .then(function (bytes) {
        return { bytes: bytes };
      });
  });
}

// --- Page range parsing, shared by extract/remove/organize -----------------
// `spec` is 1-indexed as typed by the visitor; every returned index is
// 0-indexed for pdf-lib's copyPages().

function parsePageList(spec, pageCount, opts) {
  opts = opts || {};
  var allowRanges = opts.allowRanges !== false;
  var verb = opts.verb || 'select';
  if (!spec || !spec.trim()) {
    throw new Error('Please enter which pages to ' + verb + ' (e.g. "1-3,5").');
  }
  var indices = [];
  var parts = spec.split(',');
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();
    if (!part) continue;
    var rangeMatch = allowRanges ? part.match(/^(\d+)\s*-\s*(\d+)$/) : null;
    if (rangeMatch) {
      var start = parseInt(rangeMatch[1], 10);
      var end = parseInt(rangeMatch[2], 10);
      if (start < 1 || end > pageCount || start > end) {
        throw new Error(
          'Page range "' + part + '" is not valid for this ' + pageCount + '-page PDF.'
        );
      }
      for (var p = start; p <= end; p++) indices.push(p - 1);
    } else if (/^\d+$/.test(part)) {
      var num = parseInt(part, 10);
      if (num < 1 || num > pageCount) {
        throw new Error('Page ' + num + ' does not exist in this ' + pageCount + '-page PDF.');
      }
      indices.push(num - 1);
    } else {
      throw new Error(
        '"' + part + '" is not a valid page number' + (allowRanges ? ' or range.' : '.')
      );
    }
  }
  if (indices.length === 0) {
    throw new Error('Please enter at least one valid page number.');
  }
  return indices;
}

function parsePagePermutation(spec, pageCount) {
  var indices = parsePageList(spec, pageCount, { allowRanges: false, verb: 'reorder' });
  if (indices.length !== pageCount) {
    throw new Error('Please list all ' + pageCount + ' pages exactly once, in the new order.');
  }
  var seen = {};
  for (var i = 0; i < indices.length; i++) {
    if (seen[indices[i]]) {
      throw new Error('Page ' + (indices[i] + 1) + ' is listed more than once.');
    }
    seen[indices[i]] = true;
  }
  return indices;
}

function generateUuidV4() {
  var bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  var hex = bytesToHex(bytes);
  return (
    hex.slice(0, 8) +
    '-' +
    hex.slice(8, 12) +
    '-' +
    hex.slice(12, 16) +
    '-' +
    hex.slice(16, 20) +
    '-' +
    hex.slice(20)
  );
}

// --- PDF Standard Security Handler (RC4, 40-bit, revision 2) ---------------
// ISO 32000-1 §7.6.3 "Adobe 4.0-compatible" encryption — hand-rolled the same
// way this codebase hand-rolls its other well-specified algorithms (MD5 here
// and in hash-generator.js, Code 128/QR in barcode-generator.js/
// qr-code-generator.js) rather than adding a third-party crypto dependency
// for a security-sensitive feature. Cross-checked against pypdf's reference
// implementation of the same ISO algorithms during development (O/U values
// byte-for-byte identical for fixed test vectors — see test/pdf-protect.test.js
// and test/pdf-unlock.test.js).
//
// pdf-lib itself has no encryption support (confirmed: no `encrypt` method
// anywhere in the vendored library) — this operates one level below pdf-lib's
// high-level API, directly on its PDFContext object graph (enumerating every
// indirect object, RC4-encrypting each string/stream with a key derived from
// that object's own number/generation per Algorithm 1), then hands pdf-lib's
// own writer a custom /Encrypt trailer entry it doesn't know how to produce
// itself but happily serializes if `context.trailerInfo.Encrypt` is set.
//
// `useObjectStreams: false` on save() is load-bearing, not a style choice:
// PDF's compressed object streams (Type 2 XRef, PDF 1.5+) store several
// objects inside one stream, and the spec encrypts that container stream as
// a whole rather than each object individually. Object-stream packing is
// decided lazily inside pdf-lib's own save(), after this file's encryption
// pass has already run per-object — so any object pdf-lib bundled afterward
// would ship with its strings pre-encrypted a second time, silently corrupt.
// Disabling object streams keeps every object individually addressable, the
// same shape this encryption pass already assumes.

var PDF_PASSWORD_PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a
]);

// Adobe's own "no restrictions" permission value for the Standard Security
// Handler — bits 3-6 (print/modify/copy/annotate) all set, reserved bits at
// their required values. Password-protecting a document here is purely about
// requiring a password to open it, not about restricting what an opener can
// do with it, so every tool built on this always requests full permissions.
var PDF_PERMISSIONS_ALL = -4;

function passwordToBytes(str) {
  var isLatin1 = true;
  for (var i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 0xff) {
      isLatin1 = false;
      break;
    }
  }
  if (isLatin1) {
    var bytes = new Uint8Array(str.length);
    for (var j = 0; j < str.length; j++) bytes[j] = str.charCodeAt(j);
    return bytes;
  }
  return new TextEncoder().encode(str);
}

function bytesToHex(bytes) {
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function concatBytes(chunks) {
  var total = 0;
  for (var i = 0; i < chunks.length; i++) total += chunks[i].length;
  var out = new Uint8Array(total);
  var offset = 0;
  for (var j = 0; j < chunks.length; j++) {
    out.set(chunks[j], offset);
    offset += chunks[j].length;
  }
  return out;
}

function padPassword(passwordBytes) {
  var out = new Uint8Array(32);
  var n = Math.min(passwordBytes.length, 32);
  out.set(passwordBytes.subarray(0, n), 0);
  if (n < 32) out.set(PDF_PASSWORD_PAD.subarray(0, 32 - n), n);
  return out;
}

function rc4(key, data) {
  var S = new Uint8Array(256);
  for (var i = 0; i < 256; i++) S[i] = i;
  var j = 0;
  for (i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xff;
    var tmp = S[i];
    S[i] = S[j];
    S[j] = tmp;
  }
  var out = new Uint8Array(data.length);
  var a = 0;
  var b = 0;
  for (var k = 0; k < data.length; k++) {
    a = (a + 1) & 0xff;
    b = (b + S[a]) & 0xff;
    tmp = S[a];
    S[a] = S[b];
    S[b] = tmp;
    out[k] = data[k] ^ S[(S[a] + S[b]) & 0xff];
  }
  return out;
}

// --- MD5 (RFC 1321), returning the raw 16-byte digest -----------------------
// Deliberately separate from hash-generator.js's own hand-rolled MD5 (which
// returns a hex string for display, not raw bytes, and is private to that
// module) rather than reaching across converter/worker boundaries.

var MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
];

var MD5_K = (function () {
  var k = new Uint32Array(64);
  for (var i = 0; i < 64; i++) {
    k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
  }
  return k;
})();

function md5LeftRotate(x, c) {
  return ((x << c) | (x >>> (32 - c))) >>> 0;
}

function md5(messageBytes) {
  var originalLength = messageBytes.length;
  var bitLength = originalLength * 8;

  var paddedLength = originalLength + 1;
  while (paddedLength % 64 !== 56) paddedLength++;
  paddedLength += 8;

  var msg = new Uint8Array(paddedLength);
  msg.set(messageBytes, 0);
  msg[originalLength] = 0x80;

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
      B = (B + md5LeftRotate(F, MD5_S[i])) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  var out = new Uint8Array(16);
  var dv = new DataView(out.buffer);
  dv.setUint32(0, a0, true);
  dv.setUint32(4, b0, true);
  dv.setUint32(8, c0, true);
  dv.setUint32(12, d0, true);
  return out;
}

// Algorithm 3 (steps a-d): the RC4 key used to compute/verify O.
function computeOwnerKey(ownerPasswordBytes) {
  return md5(padPassword(ownerPasswordBytes)).subarray(0, 5);
}

// Algorithm 3 (steps e-h, revision 2: no 19-round re-encryption loop).
function computeOValue(ownerKey, userPasswordBytes) {
  return rc4(ownerKey, padPassword(userPasswordBytes));
}

// Algorithm 2 (revision 2: no metadata-unencrypted branch, no 50x loop).
function computeFileKey(userPasswordBytes, oValue, permissionsP, idBytes) {
  var pBytes = new Uint8Array(4);
  var pUnsigned = permissionsP >>> 0;
  pBytes[0] = pUnsigned & 0xff;
  pBytes[1] = (pUnsigned >>> 8) & 0xff;
  pBytes[2] = (pUnsigned >>> 16) & 0xff;
  pBytes[3] = (pUnsigned >>> 24) & 0xff;
  var input = concatBytes([padPassword(userPasswordBytes), oValue, pBytes, idBytes]);
  return md5(input).subarray(0, 5);
}

// Algorithm 4, revision 2.
function computeUValue(fileKey) {
  return rc4(fileKey, PDF_PASSWORD_PAD);
}

// Algorithm 1: per-object key, object/generation-extended then MD5'd. n=5
// (40-bit key) throughout since this handler is always V=1/R=2.
function computeObjectKey(fileKey, objectNumber, generationNumber) {
  var extra = new Uint8Array(5);
  extra[0] = objectNumber & 0xff;
  extra[1] = (objectNumber >>> 8) & 0xff;
  extra[2] = (objectNumber >>> 16) & 0xff;
  extra[3] = generationNumber & 0xff;
  extra[4] = (generationNumber >>> 8) & 0xff;
  var hash = md5(concatBytes([fileKey, extra]));
  return hash.subarray(0, Math.min(fileKey.length + 5, 16));
}

// Walks every indirect object in the document, RC4-encrypting (or, called
// again with the same key, decrypting — RC4 is its own inverse) each string
// and stream in place. Streams are normalized to a fresh PDFRawStream with
// pre-{en,de}crypted contents regardless of their original concrete type
// (PDFRawStream vs. a lazily-serialized PDFContentStream), so this doesn't
// need to know which internal representation pdf-lib chose for any given
// stream.
function transformDocumentObjects(context, fileKey) {
  var indirectObjects = context.enumerateIndirectObjects();
  for (var i = 0; i < indirectObjects.length; i++) {
    var ref = indirectObjects[i][0];
    var obj = indirectObjects[i][1];
    var objectKey = computeObjectKey(fileKey, ref.objectNumber, ref.generationNumber);
    if (obj instanceof PDFLib.PDFStream) {
      var newContents = rc4(objectKey, obj.getContents());
      transformDictStrings(obj.dict, objectKey);
      context.assign(ref, PDFLib.PDFRawStream.of(obj.dict, newContents));
    } else if (obj instanceof PDFLib.PDFDict) {
      transformDictStrings(obj, objectKey);
    } else if (obj instanceof PDFLib.PDFArray) {
      transformArrayStrings(obj, objectKey);
    } else if (obj instanceof PDFLib.PDFString || obj instanceof PDFLib.PDFHexString) {
      context.assign(ref, PDFLib.PDFHexString.of(bytesToHex(rc4(objectKey, obj.asBytes()))));
    }
  }
}

function transformDictStrings(dict, key) {
  var entries = dict.entries();
  for (var i = 0; i < entries.length; i++) {
    var k = entries[i][0];
    var v = entries[i][1];
    if (v instanceof PDFLib.PDFString || v instanceof PDFLib.PDFHexString) {
      dict.set(k, PDFLib.PDFHexString.of(bytesToHex(rc4(key, v.asBytes()))));
    } else if (v instanceof PDFLib.PDFDict) {
      transformDictStrings(v, key);
    } else if (v instanceof PDFLib.PDFArray) {
      transformArrayStrings(v, key);
    }
  }
}

function transformArrayStrings(arr, key) {
  for (var i = 0; i < arr.size(); i++) {
    var v = arr.get(i);
    if (v instanceof PDFLib.PDFString || v instanceof PDFLib.PDFHexString) {
      arr.set(i, PDFLib.PDFHexString.of(bytesToHex(rc4(key, v.asBytes()))));
    } else if (v instanceof PDFLib.PDFDict) {
      transformDictStrings(v, key);
    } else if (v instanceof PDFLib.PDFArray) {
      transformArrayStrings(v, key);
    }
  }
}

function protect(bytes, password) {
  if (!password) {
    return Promise.reject(new Error('Please enter a password.'));
  }
  return PDFLib.PDFDocument.load(bytes)
    .then(function (pdfDoc) {
      var passwordBytes = passwordToBytes(password);
      var ownerKey = computeOwnerKey(passwordBytes);
      var oValue = computeOValue(ownerKey, passwordBytes);
      var idBytes = new Uint8Array(16);
      crypto.getRandomValues(idBytes);
      var fileKey = computeFileKey(passwordBytes, oValue, PDF_PERMISSIONS_ALL, idBytes);
      var uValue = computeUValue(fileKey);

      var context = pdfDoc.context;
      transformDocumentObjects(context, fileKey);

      var encryptDict = context.obj({
        Filter: PDFLib.PDFName.of('Standard'),
        V: 1,
        R: 2,
        O: PDFLib.PDFHexString.of(bytesToHex(oValue)),
        U: PDFLib.PDFHexString.of(bytesToHex(uValue)),
        P: PDF_PERMISSIONS_ALL
      });
      context.trailerInfo.Encrypt = context.register(encryptDict);
      context.trailerInfo.ID = context.obj([
        PDFLib.PDFHexString.of(bytesToHex(idBytes)),
        PDFLib.PDFHexString.of(bytesToHex(idBytes))
      ]);

      return pdfDoc.save({ useObjectStreams: false });
    })
    .then(function (bytes) {
      return { bytes: bytes };
    });
}

function unlock(bytes, password) {
  return PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
    .then(function (pdfDoc) {
      var context = pdfDoc.context;
      var encryptRef = context.trailerInfo.Encrypt;
      if (!encryptRef) {
        throw new Error('This PDF is not password-protected.');
      }
      var encryptDict = context.lookup(encryptRef);
      if (
        encryptDict.get(PDFLib.PDFName.of('Filter')).decodeText() !== 'Standard' ||
        encryptDict.get(PDFLib.PDFName.of('V')).asNumber() > 2
      ) {
        throw new Error(
          'This PDF uses a newer or non-standard encryption method this tool cannot unlock yet.'
        );
      }
      var oValue = encryptDict.get(PDFLib.PDFName.of('O')).asBytes();
      var uValue = encryptDict.get(PDFLib.PDFName.of('U')).asBytes();
      var p = encryptDict.get(PDFLib.PDFName.of('P')).asNumber();
      var idArray = context.trailerInfo.ID;
      var idBytes = idArray ? idArray.get(0).asBytes() : new Uint8Array(0);

      var candidate = passwordToBytes(password || '');
      var fileKey = computeFileKey(candidate, oValue, p, idBytes);
      var computedU = computeUValue(fileKey);
      var matches = bytesToHex(computedU) === bytesToHex(uValue);

      if (!matches) {
        if (!password) {
          throw new Error('This PDF requires a password to unlock.');
        }
        throw new Error('Incorrect password.');
      }

      transformDocumentObjects(context, fileKey);
      delete context.trailerInfo.Encrypt;

      return pdfDoc.save({ useObjectStreams: false });
    })
    .then(function (bytes) {
      return { bytes: bytes };
    });
}

// --- TXT/Markdown to PDF (Build Action Plan PR 5) --------------------------
// Neither pdf-lib nor this file had any word-wrap/pagination logic before
// this — watermark()/pageNumbers() above only ever draw a single line. A
// plain-text or Markdown document needs real multi-line layout: measure
// each word with the embedded font, greedily fill lines up to the page's
// content width, and start a new page when the y cursor runs past the
// bottom margin.

var PAGE_SIZES = {
  letter: [612, 792],
  a4: [595.28, 841.89]
};

function pageDimensions(pageSize) {
  return PAGE_SIZES[pageSize] || PAGE_SIZES.letter;
}

// Breaks a single word wider than maxWidth into character-level pieces that
// each fit — otherwise one long URL or unbroken token would silently render
// past the right margin instead of wrapping.
function breakLongWord(word, font, fontSize, maxWidth) {
  var pieces = [];
  var piece = '';
  for (var i = 0; i < word.length; i++) {
    var candidate = piece + word[i];
    if (piece && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
      pieces.push(piece);
      piece = word[i];
    } else {
      piece = candidate;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

// Plain-text word wrap. Hard newlines in the source are preserved as line
// breaks (including blank lines, kept as empty output lines for paragraph
// spacing). A source line that already fits maxWidth as-is is drawn
// verbatim — byte for byte, indentation and internal multi-space alignment
// intact — rather than being run through the word-splitter, which would
// collapse every run of whitespace to a single space even when no wrapping
// was needed at all. Only a line that's actually too wide falls back to
// greedy word-wrapping (which does normalize whitespace between the words
// it re-joins — unavoidable once a line has to be broken at some point
// other than where the original whitespace was).
function wrapText(text, font, fontSize, maxWidth) {
  var rawLines = text.replace(/\r\n/g, '\n').split('\n');
  var out = [];
  rawLines.forEach(function (raw) {
    if (raw.trim() === '') {
      out.push('');
      return;
    }
    if (font.widthOfTextAtSize(raw, fontSize) <= maxWidth) {
      out.push(raw);
      return;
    }
    var words = raw.split(/\s+/).filter(function (w) {
      return w.length > 0;
    });
    var current = '';
    words.forEach(function (word) {
      var candidate = current ? current + ' ' + word : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        current = candidate;
        return;
      }
      if (current) {
        out.push(current);
        current = '';
      }
      if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) {
        current = word;
      } else {
        var pieces = breakLongWord(word, font, fontSize, maxWidth);
        for (var i = 0; i < pieces.length - 1; i++) out.push(pieces[i]);
        current = pieces[pieces.length - 1];
      }
    });
    if (current) out.push(current);
  });
  return out;
}

function txtToPdf(text, options) {
  options = options || {};
  if (!text || !text.trim()) {
    return Promise.reject(new Error('This file has no text to convert.'));
  }
  var pageSize = pageDimensions(options.pageSize);
  var fontSize = options.fontSize && options.fontSize > 0 ? options.fontSize : 11;
  var margin = 54;
  var maxWidth = pageSize[0] - margin * 2;
  var lineHeight = fontSize * 1.4;

  return PDFLib.PDFDocument.create()
    .then(function (pdfDoc) {
      return pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica).then(function (font) {
        var lines = wrapText(text, font, fontSize, maxWidth);
        var page = pdfDoc.addPage(pageSize);
        var y = pageSize[1] - margin;
        lines.forEach(function (line) {
          if (y - lineHeight < margin) {
            page = pdfDoc.addPage(pageSize);
            y = pageSize[1] - margin;
          }
          if (line) {
            page.drawText(line, {
              x: margin,
              y: y - fontSize,
              size: fontSize,
              font: font,
              color: PDFLib.rgb(0, 0, 0)
            });
          }
          y -= lineHeight;
        });
        return pdfDoc.save();
      });
    })
    .then(function (bytes) {
      return { bytes: bytes };
    });
}

// --- Markdown block/inline parsing ------------------------------------------
// A dedicated parser rather than reusing markdown-to-html.js's line-scanning
// state machine directly — that file emits an HTML string, not a structured
// block/run tree a PDF layout pass can walk. Same line-based approach and
// the same inline syntax support (bold/italic/code/strikethrough/links/
// images), retargeted to produce data instead of markup. Also duplicated
// (rather than shared) in converters/markdown-to-docx.js, matching this
// codebase's existing convention of self-contained converter/worker files.

// The URL inside a link/image's (...) is matched with one level of balanced
// nesting allowed — `[^()]+` alone truncates at the first `)`, which breaks
// on real-world URLs like Wikipedia's
// https://en.wikipedia.org/wiki/Foo_(bar) that contain their own parens.
var LINK_URL = '(?:[^()]|\\([^()]*\\))+';

// Alternation order is load-bearing: `***bold italic***` must be tried
// before `**bold**` before `*italic*`, or the longer marker never matches
// (a shorter alternative earlier in the list would consume its two/one
// leading asterisks first, at the same string position, since JS regex
// alternation picks the first alternative that matches at the current
// position, not the longest).
function parseInlineRuns(text) {
  var runs = [];
  var pos = 0;
  var re = new RegExp(
    '(`[^`]+`)|(\\*\\*\\*[^*]+\\*\\*\\*)|(\\*\\*[^*]+\\*\\*)|(__[^_]+__)|(\\*[^*]+\\*)|(_[^_]+_)|(~~[^~]+~~)|' +
      '(!\\[[^\\]]*\\]\\(' +
      LINK_URL +
      '\\))|(\\[[^\\]]+\\]\\(' +
      LINK_URL +
      '\\))',
    'g'
  );
  var match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > pos) {
      runs.push({ text: text.slice(pos, match.index), bold: false, italic: false, code: false });
    }
    var token = match[0];
    if (token.charAt(0) === '`') {
      runs.push({ text: token.slice(1, -1), bold: false, italic: false, code: true });
    } else if (token.indexOf('***') === 0) {
      runs.push({ text: token.slice(3, -3), bold: true, italic: true, code: false });
    } else if (token.indexOf('**') === 0) {
      runs.push({ text: token.slice(2, -2), bold: true, italic: false, code: false });
    } else if (token.indexOf('__') === 0) {
      runs.push({ text: token.slice(2, -2), bold: true, italic: false, code: false });
    } else if (token.indexOf('~~') === 0) {
      runs.push({ text: token.slice(2, -2), bold: false, italic: false, code: false });
    } else if (token.charAt(0) === '*') {
      runs.push({ text: token.slice(1, -1), bold: false, italic: true, code: false });
    } else if (token.charAt(0) === '_') {
      runs.push({ text: token.slice(1, -1), bold: false, italic: true, code: false });
    } else if (token.charAt(0) === '!') {
      var imgAlt = /!\[([^\]]*)\]/.exec(token);
      runs.push({
        text: '[Image: ' + (imgAlt ? imgAlt[1] : '') + ']',
        bold: false,
        italic: false,
        code: false
      });
    } else if (token.charAt(0) === '[') {
      var linkMatch = new RegExp('\\[([^\\]]+)\\]\\((' + LINK_URL + ')\\)').exec(token);
      runs.push({
        text: linkMatch[1] + ' (' + linkMatch[2] + ')',
        bold: false,
        italic: false,
        code: false
      });
    }
    pos = re.lastIndex;
  }
  if (pos < text.length) {
    runs.push({ text: text.slice(pos), bold: false, italic: false, code: false });
  }
  return runs;
}

function parseMarkdownBlocks(md) {
  var lines = md.replace(/\r\n/g, '\n').split('\n');
  var blocks = [];
  var i = 0;
  while (i < lines.length) {
    var line = lines[i];

    if (line.trim().indexOf('```') === 0) {
      var codeLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '```') {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip the closing fence (or run off the end for an unclosed block)
      blocks.push({ type: 'code', lines: codeLines });
      continue;
    }

    if (line.trim().charAt(0) === '>') {
      var quoteLines = [];
      while (i < lines.length && lines[i].trim().charAt(0) === '>') {
        quoteLines.push(lines[i].trim().substring(1).trim());
        i++;
      }
      blocks.push({ type: 'blockquote', runs: parseInlineRuns(quoteLines.join(' ')) });
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    var headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        runs: parseInlineRuns(headingMatch[2].trim())
      });
      i++;
      continue;
    }

    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim()) || /^___+$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    var ulMatch = line.match(/^\s*[-*+]\s+(.+)$/);
    if (ulMatch) {
      blocks.push({ type: 'listitem', ordered: false, runs: parseInlineRuns(ulMatch[1]) });
      i++;
      continue;
    }

    var olMatch = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (olMatch) {
      blocks.push({
        type: 'listitem',
        ordered: true,
        number: parseInt(olMatch[1], 10),
        runs: parseInlineRuns(olMatch[2])
      });
      i++;
      continue;
    }

    // One source line = one paragraph block, matching markdown-to-html.js's
    // own line-based model rather than merging consecutive lines.
    blocks.push({ type: 'paragraph', runs: parseInlineRuns(line) });
    i++;
  }
  return blocks;
}

// Tokenizes styled runs into words (splitting any over-wide word into
// character-level pieces via breakLongWord) and greedily packs them into
// lines no wider than maxWidth, tracking each word's font-appropriate
// x-advance for the draw pass.
//
// Each word tracks `spaceBefore` — whether real whitespace preceded it in
// the source — rather than assuming a space between every token. parseInlineRuns
// splits the original text at style boundaries (bold/italic/code spans), and
// those boundaries frequently have NO whitespace on either side (e.g.
// "**important**." — no space between the bold span and the period). Adding
// a space between every token regardless would print "important ." instead
// of "important.". A run's own leading/trailing whitespace (or a run that's
// pure whitespace, e.g. the plain-text gap between two adjacent styled
// spans) still correctly produces a real space, tracked via `spaceBeforeNext`
// carrying across empty/whitespace-only runs to whichever run's first real
// word comes next.
function wrapRuns(runs, fontSize, maxWidth, pickFont) {
  var tokens = [];
  var spaceBeforeNext = false;

  runs.forEach(function (run) {
    var font = pickFont(run);
    // Capturing group keeps whitespace runs as their own array entries,
    // alternating with word segments (some possibly '' at the ends).
    var parts = run.text.split(/(\s+)/);
    parts.forEach(function (part) {
      if (!part) return;
      if (/^\s+$/.test(part)) {
        if (tokens.length > 0) spaceBeforeNext = true;
        return;
      }
      var pieces =
        font.widthOfTextAtSize(part, fontSize) <= maxWidth
          ? [part]
          : breakLongWord(part, font, fontSize, maxWidth);
      pieces.forEach(function (piece, pieceIndex) {
        // Only the first piece of a hard-broken word carries the real
        // spaceBefore flag — the remaining pieces are mid-word character
        // breaks, never separated by a real space.
        tokens.push({
          text: piece,
          bold: run.bold,
          italic: run.italic,
          code: run.code,
          spaceBefore: pieceIndex === 0 && spaceBeforeNext
        });
        spaceBeforeNext = false;
      });
    });
  });

  var spaceWidth = pickFont({}).widthOfTextAtSize(' ', fontSize);
  var lines = [];
  var current = [];
  var currentWidth = 0;

  tokens.forEach(function (tok) {
    var font = pickFont(tok);
    var wordWidth = font.widthOfTextAtSize(tok.text, fontSize);
    var lead = current.length > 0 && tok.spaceBefore ? spaceWidth : 0;
    if (current.length > 0 && currentWidth + lead + wordWidth > maxWidth) {
      lines.push(current);
      current = [];
      currentWidth = 0;
      lead = 0; // first token on a new line never gets a leading space
    }
    tok.leadSpace = lead;
    tok.wordWidth = wordWidth;
    current.push(tok);
    currentWidth += lead + wordWidth;
  });
  if (current.length > 0) lines.push(current);
  return lines;
}

var HEADING_SIZES = { 1: 22, 2: 18, 3: 15, 4: 13, 5: 12, 6: 11 };

function markdownToPdf(text, options) {
  options = options || {};
  if (!text || !text.trim()) {
    return Promise.reject(new Error('This file has no content to convert.'));
  }
  var pageSize = pageDimensions(options.pageSize);
  var margin = 54;
  var maxWidth = pageSize[0] - margin * 2;

  return PDFLib.PDFDocument.create()
    .then(function (pdfDoc) {
      return Promise.all([
        pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica),
        pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold),
        pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaOblique),
        pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBoldOblique),
        pdfDoc.embedFont(PDFLib.StandardFonts.Courier)
      ]).then(function (fonts) {
        var regular = fonts[0],
          bold = fonts[1],
          italic = fonts[2],
          boldItalic = fonts[3],
          mono = fonts[4];

        function pickFont(run) {
          if (run.code) return mono;
          if (run.bold && run.italic) return boldItalic;
          if (run.bold) return bold;
          if (run.italic) return italic;
          return regular;
        }

        var page = pdfDoc.addPage(pageSize);
        var y = pageSize[1] - margin;

        function ensureSpace(neededHeight) {
          if (y - neededHeight < margin) {
            page = pdfDoc.addPage(pageSize);
            y = pageSize[1] - margin;
          }
        }

        function drawWrappedRuns(runs, opts) {
          opts = opts || {};
          var fontSize = opts.fontSize || 11;
          var indent = opts.indent || 0;
          var lineHeight = fontSize * 1.4;
          var lines = wrapRuns(runs, fontSize, maxWidth - indent, pickFont);
          lines.forEach(function (lineTokens) {
            ensureSpace(lineHeight);
            var x = margin + indent;
            lineTokens.forEach(function (tok) {
              x += tok.leadSpace;
              page.drawText(tok.text, {
                x: x,
                y: y - fontSize,
                size: fontSize,
                font: pickFont(tok),
                color: PDFLib.rgb(0, 0, 0)
              });
              x += tok.wordWidth;
            });
            y -= lineHeight;
          });
        }

        var blocks = parseMarkdownBlocks(text);

        blocks.forEach(function (block) {
          if (block.type === 'heading') {
            var size = HEADING_SIZES[block.level] || 12;
            var headingRuns = block.runs.map(function (r) {
              return { text: r.text, bold: true, italic: r.italic, code: r.code };
            });
            y -= size * 0.3;
            drawWrappedRuns(headingRuns, { fontSize: size });
            y -= size * 0.3;
          } else if (block.type === 'paragraph') {
            drawWrappedRuns(block.runs, { fontSize: 11 });
            y -= 6;
          } else if (block.type === 'listitem') {
            var prefix = block.ordered ? block.number + '. ' : String.fromCharCode(8226) + ' ';
            var itemRuns = [{ text: prefix, bold: false, italic: false, code: false }].concat(
              block.runs
            );
            drawWrappedRuns(itemRuns, { fontSize: 11, indent: 18 });
          } else if (block.type === 'blockquote') {
            var quoteRuns = block.runs.map(function (r) {
              return { text: r.text, bold: r.bold, italic: true, code: r.code };
            });
            drawWrappedRuns(quoteRuns, { fontSize: 11, indent: 18 });
            y -= 6;
          } else if (block.type === 'code') {
            var codeSize = 10;
            var codeLineHeight = codeSize * 1.3;
            block.lines.forEach(function (raw) {
              ensureSpace(codeLineHeight);
              if (raw) {
                page.drawText(raw, {
                  x: margin + 12,
                  y: y - codeSize,
                  size: codeSize,
                  font: mono,
                  color: PDFLib.rgb(0.15, 0.15, 0.15)
                });
              }
              y -= codeLineHeight;
            });
            y -= 6;
          } else if (block.type === 'hr') {
            ensureSpace(12);
            y -= 6;
            page.drawLine({
              start: { x: margin, y: y },
              end: { x: pageSize[0] - margin, y: y },
              thickness: 1,
              color: PDFLib.rgb(0.7, 0.7, 0.7)
            });
            y -= 10;
          }
        });

        return pdfDoc.save();
      });
    })
    .then(function (bytes) {
      return { bytes: bytes };
    });
}

self.onmessage = function (e) {
  var msg = e.data || {};
  var result;
  try {
    if (msg.op === 'merge') {
      result = merge(msg.files);
    } else if (msg.op === 'split') {
      result = split(msg.file);
    } else if (msg.op === 'rotate') {
      result = rotate(msg.file, msg.degrees);
    } else if (msg.op === 'watermark') {
      result = watermark(msg.file, msg.text, msg.opacity, msg.fontSize);
    } else if (msg.op === 'pageNumbers') {
      result = pageNumbers(msg.file, msg.position, msg.startNumber, msg.format);
    } else if (msg.op === 'crop') {
      result = crop(msg.file, msg.margin);
    } else if (msg.op === 'flatten') {
      result = flatten(msg.file);
    } else if (msg.op === 'toPdfA') {
      result = toPdfA(msg.file, msg.part);
    } else if (msg.op === 'extractPages') {
      result = extractPages(msg.file, msg.pages);
    } else if (msg.op === 'removePages') {
      result = removePages(msg.file, msg.pages);
    } else if (msg.op === 'organize') {
      result = organize(msg.file, msg.order);
    } else if (msg.op === 'protect') {
      result = protect(msg.file, msg.password);
    } else if (msg.op === 'unlock') {
      result = unlock(msg.file, msg.password);
    } else if (msg.op === 'txtToPdf') {
      result = txtToPdf(msg.text, { pageSize: msg.pageSize, fontSize: msg.fontSize });
    } else if (msg.op === 'markdownToPdf') {
      result = markdownToPdf(msg.text, { pageSize: msg.pageSize });
    } else {
      throw new Error('Unknown worker operation: ' + msg.op);
    }
  } catch (err) {
    self.postMessage({ ok: false, error: (err && err.message) || 'Worker error' });
    return;
  }

  result
    .then(function (payload) {
      self.postMessage({ ok: true, result: payload });
    })
    .catch(function (err) {
      self.postMessage({ ok: false, error: (err && err.message) || 'Worker error' });
    });
};
