import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDom } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Same technique as test/pdf-lib-worker-text.test.js: strip the top-level
// 'use strict' directive so eval'd top-level function declarations land on
// dom.window (real `use strict` eval semantics give them their own isolated
// scope instead) — the shipped file itself is untouched.
function evalStrippingUseStrict(dom, absPath) {
  const src = fs.readFileSync(absPath, 'utf8').replace(/^\s*(['"])use strict\1;\s*\n/, '');
  dom.window.eval(src);
}

// Real pdf-lib.min.js (not a mock) matters here — copyPages()/page counts/
// page order need to be genuinely correct, not just call-count assertions.
function loadPdfLibWorkerGlobals() {
  const dom = createDom();
  evalStrippingUseStrict(dom, path.join(ROOT, 'static', 'lib', 'pdf-lib.min.js'));
  evalStrippingUseStrict(dom, path.join(ROOT, 'static', 'js', 'workers', 'pdf-lib-worker.js'));
  return dom;
}

// addPage([width, height]) is avoided here: the array literal is created in
// this test file's own (Node) realm, not dom.window's — pdf-lib's own
// PDFPage/Array type-check inside addPage() rejects a cross-realm Array.
// addPage() with no args (default Letter size) plus setSize() sidesteps that.
async function makeNPagePdf(dom, n) {
  const doc = await dom.window.PDFLib.PDFDocument.create();
  for (let i = 0; i < n; i++) {
    doc.addPage().setSize(100, 100);
  }
  return doc.save();
}

describe('pdf-lib-worker.js — split (every page, regression baseline)', () => {
  it('still yields one part per page, each labeled "Page N", when groups is omitted', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const bytes = await makeNPagePdf(dom, 4);

    const result = await dom.window.split(bytes);

    expect(result.pageCount).toBe(4);
    expect(result.parts).toHaveLength(4);
    result.parts.forEach((part, i) => {
      expect(part.pageNum).toBe(i + 1);
      expect(part.label).toBe('Page ' + (i + 1));
    });
  });

  it('rejects a single-page PDF the same way as before', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const bytes = await makeNPagePdf(dom, 1);
    await expect(dom.window.split(bytes)).rejects.toThrow(/only one page/i);
  });
});

describe('pdf-lib-worker.js — split (v2 "at marked points" groups)', () => {
  it('groups pages per the given contiguous ranges, with correct page counts/order and labels', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const bytes = await makeNPagePdf(dom, 9);

    const result = await dom.window.split(bytes, [
      [0, 2],
      [3, 3],
      [4, 8]
    ]);

    expect(result.parts).toHaveLength(3);
    expect(result.parts.map((p) => p.label)).toEqual(['Pages 1-3', 'Page 4', 'Pages 5-9']);
    expect(result.parts.map((p) => p.pageNum)).toEqual([1, 4, 5]);

    const doc0 = await dom.window.PDFLib.PDFDocument.load(result.parts[0].bytes);
    expect(doc0.getPageCount()).toBe(3);
    const doc1 = await dom.window.PDFLib.PDFDocument.load(result.parts[1].bytes);
    expect(doc1.getPageCount()).toBe(1);
    const doc2 = await dom.window.PDFLib.PDFDocument.load(result.parts[2].bytes);
    expect(doc2.getPageCount()).toBe(5);
  });

  it('rejects groups with a gap', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const bytes = await makeNPagePdf(dom, 5);
    await expect(
      dom.window.split(bytes, [
        [0, 1],
        [3, 4]
      ])
    ).rejects.toThrow(/invalid split groups/i);
  });

  it('rejects groups with an overlap', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const bytes = await makeNPagePdf(dom, 5);
    await expect(
      dom.window.split(bytes, [
        [0, 2],
        [2, 4]
      ])
    ).rejects.toThrow(/invalid split groups/i);
  });

  it('rejects groups that leave a page uncovered at the end', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const bytes = await makeNPagePdf(dom, 5);
    await expect(dom.window.split(bytes, [[0, 2]])).rejects.toThrow(/invalid split groups/i);
  });

  it('rejects a group that starts out of order', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const bytes = await makeNPagePdf(dom, 5);
    await expect(
      dom.window.split(bytes, [
        [2, 4],
        [0, 1]
      ])
    ).rejects.toThrow(/invalid split groups/i);
  });
});
