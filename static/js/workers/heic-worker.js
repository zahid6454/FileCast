'use strict';

// Dedicated worker for HEIC/HEIF decode via libheif-js 1.23.2
// (github.com/catdad-experiments/libheif-js) instead of heic2any. Pinning the
// version here since static/lib/ has no manifest/lockfile of its own — this
// PR exists because heic2any's staleness (last published March 2023) went
// unnoticed for years; leaving this replacement equally untraceable would
// repeat that exact blind spot. Check for a newer release when touching this
// file. Root cause of Sentry #7717636872: heic2any's vendored
// bundle (last published March 2023) builds its Embind error classes via
// `new Function(...)` at WASM module-init time — this repo's CSP never
// grants 'unsafe-eval' (only 'wasm-unsafe-eval', which covers compiling
// WebAssembly, not string-to-code eval/Function), so that call threw
// synchronously and heic2any's own worker never wires an `error` listener —
// the conversion just hung forever with no visible error. libheif-js's
// current build (verified: zero `new Function`/`eval` anywhere in the
// bundle, and confirmed live against a server enforcing this exact CSP) has
// moved past that. Same reasoning as avif-worker.js's header comment for
// @jsquash/avif over @saschazar/wasm-avif.
//
// Canvas compositing + PNG/JPEG/WebP encoding stay on the main thread, same
// as tiff-worker.js — this worker does only the decode.
var libUrl = null;
var wasmUrl = null;
try {
  var params = new URL(self.location.href).searchParams;
  libUrl = params.get('lib');
  wasmUrl = params.get('wasm');
} catch (e) {
  /* malformed URL — importScripts below will throw a clearer error */
}
if (libUrl) {
  importScripts(libUrl);
}

self.onmessage = function (e) {
  var buffer = e.data;
  try {
    if (!libUrl) throw new Error('HEIC decoder library URL is missing.');
    var mod = libheif(
      wasmUrl
        ? {
            locateFile: function (path) {
              return /\.wasm$/.test(path) && wasmUrl ? wasmUrl : path;
            }
          }
        : {}
    );
    Promise.resolve(mod)
      .then(function (m) {
        var decoder = new m.HeifDecoder();
        var images = decoder.decode(new Uint8Array(buffer));
        if (!images || images.length === 0) {
          throw new Error('Could not read HEIC file. The file may be corrupted.');
        }
        // A multi-image HEIC (burst-mode photos, live-photo pairs) decodes to
        // more than one entry here — only the first is ever converted. Not a
        // new limitation: heic2any's own converters made the identical choice
        // (`Array.isArray(result) ? result[0] : result`) before this file
        // existed, so this preserves prior behavior rather than changing it.
        var image = images[0];
        var width = image.get_width();
        var height = image.get_height();
        return new Promise(function (resolve, reject) {
          image.display(
            { data: new Uint8ClampedArray(width * height * 4), width: width, height: height },
            function (displayData) {
              if (!displayData) {
                reject(new Error('Could not decode this HEIC file.'));
                return;
              }
              self.postMessage(
                { ok: true, rgba: displayData.data.buffer, width: width, height: height },
                [displayData.data.buffer]
              );
              resolve();
            }
          );
        });
      })
      .catch(function (err) {
        self.postMessage({
          ok: false,
          error: (err && err.message) || 'Failed to decode HEIC file.'
        });
      });
  } catch (err) {
    self.postMessage({ ok: false, error: (err && err.message) || 'Failed to decode HEIC file.' });
  }
};
