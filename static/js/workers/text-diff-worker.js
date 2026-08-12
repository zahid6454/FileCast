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
    self.postMessage({ ok: false, error: (err && err.message) || 'Comparison failed.' });
  }
};
