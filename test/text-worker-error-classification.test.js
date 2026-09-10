import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDom } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Same technique as test/pdf-lib-worker-text.test.js: strip the top-level
// 'use strict' directive so eval'd top-level function declarations land on
// dom.window instead of an isolated eval scope. No `converter` query param
// on the default jsdom URL, so the file's own `if (converterUrl)
// importScripts(...)` guard never fires — the worker file loads cleanly
// with no real Worker/importScripts environment needed.
function loadWorker(relPath) {
  const dom = createDom();
  const src = fs
    .readFileSync(path.join(ROOT, 'static', 'js', 'workers', relPath), 'utf8')
    .replace(/^\s*(['"])use strict\1;\s*\n/, '');
  dom.window.eval(src);
  return dom;
}

// errorPayload() is what text-converter-worker.js/text-diff-worker.js post
// back across the postMessage boundary for a failed conversion — this is
// the exact logic that was fixed after a code-review finding: pdf-lib's own
// validation errors extend Error without overriding .name (stays 'Error'),
// but one of its bundled decoders throws a bare descriptive string instead
// of an Error at all, and the worker's own "converter script failed to
// load" guard must NOT read as a user-input rejection.
describe.each(['text-converter-worker.js', 'text-diff-worker.js'])(
  '%s — errorPayload',
  (workerFile) => {
    it('classifies a plain Error as validation_error and keeps its message', () => {
      const dom = loadWorker(workerFile);
      const payload = dom.window.errorPayload(
        new Error('CSV must have at least a header row and one data row.'),
        'fallback'
      );
      expect(payload).toEqual({
        ok: false,
        error: 'CSV must have at least a header row and one data row.',
        errorType: 'validation_error'
      });
    });

    it('classifies a bare string throw as validation_error and preserves the exact text', () => {
      const dom = loadWorker(workerFile);
      const payload = dom.window.errorPayload('The input is not a PNG file!', 'fallback');
      expect(payload).toEqual({
        ok: false,
        error: 'The input is not a PNG file!',
        errorType: 'validation_error'
      });
    });

    it("classifies a named error (e.g. this worker's own ConverterLoadError) as conversion_error", () => {
      const dom = loadWorker(workerFile);
      const err = new Error('Converter not loaded.');
      err.name = 'ConverterLoadError';
      const payload = dom.window.errorPayload(err, 'fallback');
      expect(payload.errorType).toBe('conversion_error');
      expect(payload.error).toBe('Converter not loaded.');
    });

    it('classifies TypeError and a missing error as conversion_error, using the fallback message when there is none', () => {
      const dom = loadWorker(workerFile);
      expect(dom.window.errorPayload(new TypeError('boom'), 'fallback').errorType).toBe(
        'conversion_error'
      );
      expect(dom.window.errorPayload(undefined, 'fallback')).toEqual({
        ok: false,
        error: 'fallback',
        errorType: 'conversion_error'
      });
    });
  }
);

// The "converter script failed to load" guard itself — reachable via
// self.onmessage when importScripts() silently didn't define
// self.convertText (bad hashed URL, CSP block, CDN hiccup). Must not
// misreport as the user's fault.
describe('text-converter-worker.js — missing-converter guard', () => {
  it('posts a conversion_error, not validation_error, when self.convertText is not a function', () => {
    const dom = loadWorker('text-converter-worker.js');
    const posted = [];
    dom.window.postMessage = (msg) => posted.push(msg);
    dom.window.onmessage({ data: { text: 'hello' } });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({
      ok: false,
      error: 'Converter not loaded.',
      errorType: 'conversion_error'
    });
  });
});

describe('text-diff-worker.js — missing-converter guard', () => {
  it('posts a conversion_error, not validation_error, when self.convertText is not a function', () => {
    const dom = loadWorker('text-diff-worker.js');
    const posted = [];
    dom.window.postMessage = (msg) => posted.push(msg);
    dom.window.onmessage({ data: { textA: 'a', textB: 'b' } });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({
      ok: false,
      error: 'Converter not loaded.',
      errorType: 'conversion_error'
    });
  });
});
