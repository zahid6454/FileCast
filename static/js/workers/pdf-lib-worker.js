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
