'use strict';

// pdf.js (this vendored build) references `window.location` directly in its
// own worker-vs-fake-worker origin check, which only exists on the real page
// main thread — inside a Worker there is no `window`, only `self`, so that
// reference throws and silently drags pdf.js down its (here, broken — see
// below) fake-worker fallback path instead of spawning the nested real
// Worker it's otherwise fully able to. `self` IS a Worker's global object
// (equivalent to `window` on the main thread) and already has `location`, so
// aliasing `window` to `self` is enough for that check to pass and for pdf.js
// to take the normal nested-Worker path instead.
if (typeof window === 'undefined') {
  self.window = self;
}

// Dedicated worker for page-thumbnail rendering (Tool Preview/Interaction
// Redesign §1). Separate from pdf-lib-worker.js — that one runs exactly one
// job then is terminated (merge/split/rotate/etc.), this one stays alive for
// the whole "file picked, thumbnails render as you scroll" session and
// handles many render requests over its lifetime.
//
// pdf.js's own lib + worker URLs are passed as query params on this worker's
// own script URL, same trick pdf-lib-worker.js uses for pdf-lib — works for
// any hashed build without this file needing to know the asset path.
var libUrl = null;
var pdfWorkerUrl = null;
try {
  var params = new URL(self.location.href).searchParams;
  libUrl = params.get('lib');
  pdfWorkerUrl = params.get('workerLib');
} catch (e) {
  /* malformed URL — importScripts below will throw a clearer error */
}
if (libUrl) {
  importScripts(libUrl);
}
// pdf.js parses each document on its own internal worker (a nested Worker,
// spawned from inside this one — supported in every browser this site
// targets). Rendering itself (page.render() below, into an OffscreenCanvas)
// still happens right here, off the main thread either way.
if (pdfWorkerUrl && self.pdfjsLib) {
  self.pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

var pdfDoc = null;
// Every message is handled through one chain so a 'render' request can never
// run before the 'load' ahead of it has actually resolved pdfDoc, and two
// 'render' requests can't race each other's OffscreenCanvas use.
var chain = Promise.resolve();

self.onmessage = function (e) {
  var msg = e.data || {};
  chain = chain
    .then(function () {
      return handleMessage(msg);
    })
    .catch(function (err) {
      self.postMessage({
        ok: false,
        type: msg.op === 'load' ? 'loaded' : 'rendered',
        requestId: msg.requestId,
        pageIndex: msg.pageIndex,
        error: (err && err.message) || 'This PDF could not be previewed.'
      });
    });
};

function handleMessage(msg) {
  if (msg.op === 'load') {
    pdfDoc = null;
    return self.pdfjsLib.getDocument({ data: msg.file }).promise.then(function (doc) {
      pdfDoc = doc;
      self.postMessage({ ok: true, type: 'loaded', pageCount: doc.numPages });
    });
  }
  if (msg.op === 'render') {
    if (!pdfDoc) {
      throw new Error('This PDF could not be previewed.');
    }
    return pdfDoc.getPage(msg.pageIndex + 1).then(function (page) {
      var baseViewport = page.getViewport({ scale: 1 });
      var scale = msg.targetWidth / baseViewport.width;
      var viewport = page.getViewport({ scale: scale });
      var width = Math.max(1, Math.round(viewport.width));
      var height = Math.max(1, Math.round(viewport.height));
      var canvas = new OffscreenCanvas(width, height);
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
        var bitmap = canvas.transferToImageBitmap();
        page.cleanup();
        self.postMessage(
          {
            ok: true,
            type: 'rendered',
            requestId: msg.requestId,
            pageIndex: msg.pageIndex,
            bitmap: bitmap,
            // Unscaled page size, in PDF points — lets a caller (shared-page-proof.js)
            // convert its own worker.js-space x/y math into this bitmap's pixel
            // space via one scale factor (bitmap.width / pageWidthPt). Note:
            // pdf.js's viewport width/height already account for the page's own
            // /Rotate entry; pdf-lib's page.getSize() (what watermark()/
            // pageNumbers() actually draw against) does not — the two agree for
            // the overwhelming majority of real PDFs (no page-level /Rotate),
            // and diverge only for an already-rotated page, a known v1 gap.
            pageWidthPt: baseViewport.width,
            pageHeightPt: baseViewport.height
          },
          [bitmap]
        );
      });
    });
  }
  return Promise.resolve();
}
