'use strict';

// Dedicated worker for HEIC/HEIF decode via libheif-js (catdad-experiments)
// instead of heic2any. Root cause of Sentry #7717636872: heic2any's vendored
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
            locateFile: function () {
              return wasmUrl;
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
