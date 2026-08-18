'use strict';

// Dedicated worker for AVIF decode/encode (@saschazar/wasm-avif, a libavif/
// AOM build compiled to WebAssembly) — Build Action Plan PR 7. Real-browser
// timing during development showed multi-second encodes at high quality on a
// 6MP image, so this — unlike heic2any/browser-image-compression, which
// already offload themselves — genuinely needs a dedicated worker to keep the
// main thread responsive, the same reasoning tiff-worker.js documents for
// UTIF. One worker instance handles exactly one job then is terminated by the
// caller, so no request/response id matching is needed.
//
// Both the JS glue and the .wasm binary are content-hashed by build.py, so
// their URLs are passed as query params on the worker's own script URL (the
// same trick tiff-worker.js/pdf-lib-worker.js use for their own lib) rather
// than hardcoded. The glue's compiled-in default (`locateFile` returning the
// literal "wasm_avif.wasm" next to itself) would 404 once build.py renames
// both files — Module.locateFile below overrides that with the real hashed
// .wasm URL.
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

// AVIF_PIXEL_FORMAT from wasm_avif.d.ts: 1 = YUV444, 2 = YUV422, 3 = YUV420.
var AVIF_PIXEL_FORMAT_YUV444 = 1;
var AVIF_PIXEL_FORMAT_YUV420 = 3;

function loadModule() {
  return new Promise(function (resolve, reject) {
    var mod = {
      locateFile: function (path) {
        return /\.wasm$/.test(path) && wasmUrl ? wasmUrl : path;
      },
      onRuntimeInitialized: function () {
        resolve(mod);
      },
      onAbort: function (reason) {
        reject(new Error((reason && reason.message) || String(reason)));
      }
    };
    // eslint-disable-next-line no-undef -- global from importScripts(libUrl)
    wasm_avif(mod);
  });
}

function runDecode(buffer) {
  return loadModule().then(function (mod) {
    var input = new Uint8Array(buffer);
    var result = mod.decode(input, input.length, true);
    if (!result || result.error) {
      mod.free();
      throw new Error((result && result.error) || 'Could not decode this AVIF file.');
    }
    var dims = mod.dimensions();
    // `result` is a view into the module's own WASM heap — slice() a real
    // copy before free() reuses/invalidates that memory (confirmed during
    // development: reading `result` after free() returns stale/zeroed bytes).
    var rgba = result.slice();
    mod.free();
    return { ok: true, rgba: rgba.buffer, width: dims.width, height: dims.height };
  });
}

function runEncode(rgba, width, height, channels, quantizer) {
  return loadModule().then(function (mod) {
    var options = {
      minQuantizer: quantizer,
      maxQuantizer: quantizer,
      minQuantizerAlpha: quantizer,
      maxQuantizerAlpha: quantizer,
      tileRowsLog2: 0,
      tileColsLog2: 0,
      speed: 10
    };
    var chroma = quantizer <= 8 ? AVIF_PIXEL_FORMAT_YUV444 : AVIF_PIXEL_FORMAT_YUV420;
    var input = new Uint8Array(rgba);
    var result = mod.encode(input, width, height, channels, options, chroma);
    if (!result || result.error) {
      mod.free();
      throw new Error((result && result.error) || 'Could not encode this image as AVIF.');
    }
    var avif = result.slice();
    mod.free();
    return { ok: true, avif: avif.buffer };
  });
}

self.onmessage = function (e) {
  var data = e.data || {};
  var task;
  if (data.type === 'decode') {
    task = runDecode(data.buffer);
  } else if (data.type === 'encode') {
    task = runEncode(data.rgba, data.width, data.height, data.channels, data.quantizer);
  } else {
    task = Promise.reject(new Error('Unknown AVIF worker task.'));
  }

  task
    .then(function (msg) {
      var transfer = msg.rgba ? [msg.rgba] : msg.avif ? [msg.avif] : [];
      self.postMessage(msg, transfer);
    })
    .catch(function (err) {
      self.postMessage({ ok: false, error: (err && err.message) || 'AVIF conversion failed.' });
    });
};
