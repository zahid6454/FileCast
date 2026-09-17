import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createDom } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Same technique as test/pdf-lib-worker-text.test.js: strip the top-level
// 'use strict' directive so eval'd top-level function declarations land on
// dom.window. Real pdf-lib.min.js (not a mock) matters here because the
// shrink/truncate logic depends on real font.widthOfTextAtSize() measurements.
function evalStrippingUseStrict(dom, absPath) {
  const src = fs.readFileSync(absPath, 'utf8').replace(/^\s*(['"])use strict\1;\s*\n/, '');
  dom.window.eval(src);
}

function loadPdfLibWorkerGlobals() {
  const dom = createDom();
  evalStrippingUseStrict(dom, path.join(ROOT, 'static', 'lib', 'pdf-lib.min.js'));
  evalStrippingUseStrict(dom, path.join(ROOT, 'static', 'js', 'workers', 'pdf-lib-worker.js'));
  return dom;
}

// addPage([width, height]) is avoided here — see pdf-lib-worker-pages.test.js's
// makeOnePagePdf comment: the array literal is created in this test file's
// own (Node) realm, not dom.window's, and pdf-lib's own type-check inside
// addPage() rejects a cross-realm Array.
async function makeOnePagePdf(dom, width, height) {
  const doc = await dom.window.PDFLib.PDFDocument.create();
  doc.addPage().setSize(width, height);
  return doc.save();
}

describe('pdf-lib-worker.js — pageNumbers() Font/Size/Custom Text', () => {
  it('defaults to Helvetica 10pt when fontFamily/fontSize are omitted', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const bytes = await makeOnePagePdf(dom, 612, 792);
    const embedFontSpy = vi.spyOn(dom.window.PDFLib.PDFDocument.prototype, 'embedFont');
    const drawTextSpy = vi.spyOn(dom.window.PDFLib.PDFPage.prototype, 'drawText');

    await dom.window.pageNumbers(bytes, 'bottom-center', 1, 'n');

    expect(embedFontSpy).toHaveBeenCalledWith(dom.window.PDFLib.StandardFonts.Helvetica);
    expect(drawTextSpy).toHaveBeenCalledWith('1', expect.objectContaining({ size: 10 }));
  });

  it('embeds the selected StandardFont for a given fontFamily', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const bytes = await makeOnePagePdf(dom, 612, 792);
    const embedFontSpy = vi.spyOn(dom.window.PDFLib.PDFDocument.prototype, 'embedFont');

    await dom.window.pageNumbers(bytes, 'bottom-center', 1, 'n', 'TimesRomanBold', 12);

    expect(embedFontSpy).toHaveBeenCalledWith(dom.window.PDFLib.StandardFonts.TimesRomanBold);
  });

  it('draws the custom text unchanged, at the requested size, on every page when it fits', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const doc = await dom.window.PDFLib.PDFDocument.create();
    doc.addPage().setSize(612, 792);
    doc.addPage().setSize(612, 792);
    const bytes = await doc.save();
    const drawTextSpy = vi.spyOn(dom.window.PDFLib.PDFPage.prototype, 'drawText');

    await dom.window.pageNumbers(
      bytes,
      'bottom-left',
      1,
      'custom',
      'Helvetica',
      12,
      '10.1234/chap.01'
    );

    expect(drawTextSpy).toHaveBeenCalledTimes(2);
    drawTextSpy.mock.calls.forEach((call) => {
      expect(call[0]).toBe('10.1234/chap.01');
      expect(call[1].size).toBe(12);
    });
  });

  it('skips drawing on a page when custom text is blank', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const bytes = await makeOnePagePdf(dom, 612, 792);
    const drawTextSpy = vi.spyOn(dom.window.PDFLib.PDFPage.prototype, 'drawText');

    await dom.window.pageNumbers(bytes, 'bottom-center', 1, 'custom', 'Helvetica', 10, '');

    expect(drawTextSpy).not.toHaveBeenCalled();
  });

  it('shrinks the font size when the label is too wide for the page margin', async () => {
    const dom = loadPdfLibWorkerGlobals();
    // A narrow page (150pt wide) with a 24pt margin each side leaves only
    // 102pt for the label — too little for a 24pt-tall run of this text.
    const bytes = await makeOnePagePdf(dom, 150, 200);
    const drawTextSpy = vi.spyOn(dom.window.PDFLib.PDFPage.prototype, 'drawText');

    await dom.window.pageNumbers(
      bytes,
      'bottom-center',
      1,
      'custom',
      'Helvetica',
      24,
      'chapter-one'
    );

    expect(drawTextSpy).toHaveBeenCalledTimes(1);
    const [text, drawOpts] = drawTextSpy.mock.calls[0];
    expect(text).toBe('chapter-one'); // still whole — just drawn smaller
    expect(drawOpts.size).toBeLessThan(24);
    expect(drawOpts.font.widthOfTextAtSize(text, drawOpts.size)).toBeLessThanOrEqual(150 - 24 * 2);
  });

  it('truncates with an ellipsis when the label does not fit even at the floor size', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const bytes = await makeOnePagePdf(dom, 150, 200);
    const longText = 'a much longer custom label than this narrow page can ever hold';
    const drawTextSpy = vi.spyOn(dom.window.PDFLib.PDFPage.prototype, 'drawText');

    await dom.window.pageNumbers(bytes, 'bottom-center', 1, 'custom', 'Helvetica', 24, longText);

    const [text, drawOpts] = drawTextSpy.mock.calls[0];
    expect(text).not.toBe(longText);
    expect(text.endsWith('…')).toBe(true);
    expect(drawOpts.font.widthOfTextAtSize(text, drawOpts.size)).toBeLessThanOrEqual(150 - 24 * 2);
  });
});
