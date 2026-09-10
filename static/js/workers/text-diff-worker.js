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

// Mirrors fc-util.js's FC.classifyError — duplicated rather than imported
// since this worker's script URL is hashed by the build's asset pipeline, so
// there is no stable path to importScripts() it from here. A converter
// throws a plain Error for an expected input-validation rejection (or, in
// one edge case elsewhere in this codebase, a bare descriptive string);
// anything else is an unanticipated crash.
function errorPayload(err, fallback) {
  var isValidation = typeof err === 'string' || (err && err.name === 'Error');
  var message = typeof err === 'string' && err ? err : (err && err.message) || fallback;
  return {
    ok: false,
    error: message,
    errorType: isValidation ? 'validation_error' : 'conversion_error'
  };
}

self.onmessage = function (e) {
  var data = e.data || {};
  var textA = data.textA || '';
  var textB = data.textB || '';
  try {
    if (typeof self.convertText !== 'function') {
      // Not a plain Error: importScripts() above silently failing (bad
      // hashed URL, CSP block, CDN hiccup) is an infra/deploy problem, not a
      // user-input rejection — must not classify as validation_error.
      var notLoaded = new Error('Converter not loaded.');
      notLoaded.name = 'ConverterLoadError';
      throw notLoaded;
    }
    var result = self.convertText(textA, textB);
    self.postMessage({ ok: true, result: result });
  } catch (err) {
    self.postMessage(errorPayload(err, 'Comparison failed.'));
  }
};
