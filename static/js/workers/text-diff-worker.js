'use strict';

// Dedicated worker for the two-input "diff" tool family (currently just
// json-diff) — kept separate from text-converter-worker.js rather than
// extending that file's single-`text` message contract, so the 8 existing
// one-input converters it already serves (and their tests) are untouched.
// Same converter-URL-as-query-param trick as text-converter-worker.js /
// pdf-lib-worker.js, and the same `self.window = self` alias so a converter
// file's `window.convertText = ...` assignment resolves in worker scope.
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
// build's asset pipeline, so there is no stable path to importScripts() it
// from here. A converter throws a plain Error for an expected
// input-validation rejection (or, in one edge case elsewhere in this
// codebase, a bare descriptive string); anything else is an unanticipated
// crash.
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
  var data = e.data || {};
  var textA = data.textA || '';
  var textB = data.textB || '';
  try {
    if (typeof self.convertText !== 'function') {
      throw new Error('Converter not loaded.');
    }
    var result = self.convertText(textA, textB);
    self.postMessage({ ok: true, result: result });
  } catch (err) {
    self.postMessage(errorPayload(err, 'Comparison failed.'));
  }
};
