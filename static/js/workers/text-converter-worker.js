'use strict';

// Generic worker for the text-input converters (json-to-csv, csv-to-json,
// json-to-xml, xml-to-json, json-to-yaml, yaml-to-json, html-to-markdown,
// markdown-to-html) — these used to run window.convertText(text) directly on
// the main thread (shared-text.js), unlike the PDF tools which were already
// moved off-thread (P4 §36). A multi-MB CSV/JSON/XML input near the tool's
// max_file_size_bytes could visibly freeze the tab; this fixes that the same
// way pdf-lib-worker.js does.
//
// The specific converter's URL is passed as a query param on this worker's
// own script URL (identical trick to pdf-lib-worker.js's `lib` param) so one
// worker file serves all 8 converters without the build needing a per-tool
// worker variant.
//
// Every converter file does `window.convertText = ...` — there is no
// `window` global in a worker (only `self`), so importScripts would throw a
// bare ReferenceError before defining anything. Aliasing window to self
// FIRST means `window.convertText = fn` resolves to `self.convertText = fn`
// (window IS self here), letting all 8 converter files run completely
// unmodified — same files, same contract, same test coverage, just loaded
// off the main thread. (Several of them use DOMParser, which is available
// in worker scope regardless.)
self.window = self;
var converterUrl = null;
try {
  converterUrl = new URL(self.location.href).searchParams.get('converter');
} catch (e) {
  /* malformed URL — importScripts below will throw a clearer error */
}
if (converterUrl) {
  importScripts(converterUrl);
}

// Mirrors fc-util.js's FC.errorMessage/FC.errorTypeFromError — duplicated
// rather than imported since this worker's script URL is hashed by the
// build's asset pipeline (see templates/base.html's assets.get()), so there
// is no stable path to importScripts() it from here. A converter throws a
// plain Error for an expected input-validation rejection (or, in one edge
// case elsewhere in this codebase, a bare descriptive string); anything else
// is an unanticipated crash.
function errorPayload(err, fallback) {
  var message = typeof err === 'string' && err ? err : (err && err.message) || fallback;
  var errorType =
    typeof err === 'string'
      ? 'validation_error'
      : err && err.name === 'Error'
        ? 'validation_error'
        : 'conversion_error';
  return { ok: false, error: message, errorType: errorType };
}

self.onmessage = function (e) {
  var text = (e.data && e.data.text) || '';
  try {
    if (typeof self.convertText !== 'function') {
      throw new Error('Converter not loaded.');
    }
    // Wrapped in Promise.resolve() rather than assumed synchronous — Hash
    // Generator's SHA-256 support (crypto.subtle.digest) is inherently
    // async, unlike every other converter here. A plain value resolves
    // through this identically to before, so the other 12 converters are
    // unaffected.
    Promise.resolve(self.convertText(text)).then(
      function (result) {
        self.postMessage({ ok: true, result: result });
      },
      function (err) {
        self.postMessage(errorPayload(err, 'Conversion failed.'));
      }
    );
  } catch (err) {
    self.postMessage(errorPayload(err, 'Conversion failed.'));
  }
};
