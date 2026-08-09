'use strict';

// Dedicated worker for TIFF decoding (UTIF.js) — P4 §36. UTIF.decode/
// decodeImage/toRGBA8 are pure-JS and CPU-heavy for large scans, with no
// internal worker of its own (unlike heic2any/browser-image-compression).
// This worker does only the decode; canvas compositing + JPEG encoding stay
// on the main thread (fast, and canvas isn't available in a classic worker).
var libUrl = null;
try {
  libUrl = new URL(self.location.href).searchParams.get('lib');
} catch (e) {
  /* malformed URL — importScripts below will throw a clearer error */
}
if (libUrl) {
  importScripts(libUrl);
}

self.onmessage = function (e) {
  var buffer = e.data;
  try {
    var ifds = UTIF.decode(buffer);
    if (!ifds || ifds.length === 0) {
      throw new Error('Could not read TIFF file. The file may be corrupted.');
    }
    UTIF.decodeImage(buffer, ifds[0]);
    var rgba = UTIF.toRGBA8(ifds[0]);
    var width = ifds[0].width;
    var height = ifds[0].height;
    // Transfer the RGBA buffer back rather than copy it — it can be tens of
    // MB for a large scan.
    self.postMessage({ ok: true, rgba: rgba, width: width, height: height }, [rgba.buffer]);
  } catch (err) {
    self.postMessage({
      ok: false,
      error: (err && err.message) || 'Failed to decode TIFF file.'
    });
  }
};
