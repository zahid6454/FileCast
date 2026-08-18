'use strict';

// Dedicated worker for AVIF decode/encode — Build Action Plan PR 7. Uses
// @jsquash/avif's two Emscripten builds (repackaged from Google's Squoosh
// app): avif_dec.js/.wasm for decode, avif_enc.js/.wasm for encode. Only the
// one the current task needs is loaded, so an AVIF-to-X page never pays for
// the (much larger) encoder and vice versa.
//
// This specific pair was chosen over an earlier, smaller candidate
// (@saschazar/wasm-avif) after that one turned out to construct its Embind
// method dispatchers via `new Function(...)` at module-init time — which
// CSP blocks under 'wasm-unsafe-eval' alone (confirmed against a real
// enforced-CSP server during review; 'wasm-unsafe-eval' only covers
// WebAssembly compilation, not string-to-code eval/Function, and this repo's
// CSP intentionally never carries 'unsafe-eval', full stop). jsquash's build
// uses a newer Emscripten/Embind toolchain whose invoker functions are built
// as plain closures instead, with zero eval/Function anywhere — verified by
// grepping the vendored file. Both avif_dec.js/avif_enc.js ship from npm as
// ES modules (`import.meta.url` + `export default Module`); the two lines
// that matter are patched out at vendor time so they load as classic scripts
// via importScripts() below, the same as every other worker lib in this
// codebase — see the header comment in static/lib/avif_dec.js/avif_enc.js
// for exactly what changed from the npm package.
//
// Real-browser timing during development showed multi-second encodes at
// high quality on a 6MP image, so — unlike heic2any/browser-image-
// compression, which already offload themselves — this genuinely needs a
// dedicated worker to keep the main thread responsive, the same reasoning
// tiff-worker.js documents for UTIF. One worker instance handles exactly one
// job then is terminated by the caller, so no request/response id matching
// is needed.
var params = null;
try {
  params = new URL(self.location.href).searchParams;
} catch (e) {
  /* malformed URL — importScripts below will throw a clearer error */
}

var libLoaded = { decode: false, encode: false };

function ensureLib(kind) {
  if (libLoaded[kind]) return;
  var lib = params && params.get(kind === 'decode' ? 'declib' : 'enclib');
  if (!lib) throw new Error('AVIF ' + kind + ' library URL is missing.');
  importScripts(lib);
  libLoaded[kind] = true;
}

function loadDecoder() {
  ensureLib('decode');
  var wasmUrl = params.get('decwasm');
  return AvifDecoderModule({
    noInitialRun: true,
    locateFile: function (path) {
      return /\.wasm$/.test(path) && wasmUrl ? wasmUrl : path;
    }
  });
}

function loadEncoder() {
  ensureLib('encode');
  var wasmUrl = params.get('encwasm');
  return AvifEncoderModule({
    noInitialRun: true,
    locateFile: function (path) {
      return /\.wasm$/.test(path) && wasmUrl ? wasmUrl : path;
    }
  });
}

function runDecode(buffer) {
  return loadDecoder().then(function (mod) {
    var result = mod.decode(new Uint8Array(buffer), 8);
    if (!result) {
      throw new Error('Could not decode this AVIF file.');
    }
    // Defensive copy: several Emscripten/Embind builds hand back a view into
    // the module's own WASM heap rather than a standalone array (confirmed
    // necessary against a different AVIF WASM build during development,
    // where reading the result after the module's memory was reused
    // returned stale bytes) — slice() before the module/heap can be
    // reclaimed, regardless of which behavior this particular build has.
    var rgba = result.data.slice();
    return { ok: true, rgba: rgba.buffer, width: result.width, height: result.height };
  });
}

function runEncode(rgba, width, height, quality) {
  return loadEncoder().then(function (mod) {
    var options = {
      quality: quality,
      qualityAlpha: -1,
      denoiseLevel: 0,
      tileColsLog2: 0,
      tileRowsLog2: 0,
      speed: 8,
      subsample: 1, // 4:2:0 — this library's own default
      chromaDeltaQ: false,
      sharpness: 0,
      tune: 0, // AVIFTune.auto
      enableSharpYUV: false,
      bitDepth: 8,
      lossless: false
    };
    var result = mod.encode(new Uint8Array(rgba), width, height, options);
    if (!result) {
      throw new Error('Could not encode this image as AVIF.');
    }
    var avif = result.slice();
    return { ok: true, avif: avif.buffer };
  });
}

self.onmessage = function (e) {
  var data = e.data || {};
  var task;
  if (data.type === 'decode') {
    task = runDecode(data.buffer);
  } else if (data.type === 'encode') {
    task = runEncode(data.rgba, data.width, data.height, data.quality);
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
