import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createDom } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Same technique as test/pdf-lib-worker-text.test.js: strip the top-level
// 'use strict' directive so eval'd top-level function declarations land on
// dom.window.
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

// addPage([width, height]) is avoided here: the array literal is created in
// this test file's own (Node) realm, not dom.window's — pdf-lib's own
// PDFPage/Array type-check inside addPage() rejects a cross-realm Array.
// addPage() with no args (default Letter size) plus setSize() sidesteps that.
async function makeOnePagePdf(dom, width, height) {
  const doc = await dom.window.PDFLib.PDFDocument.create();
  doc.addPage().setSize(width, height);
  return doc.save();
}

describe('pdf-lib-worker.js — watermark position/angle (drag-to-position + free rotation)', () => {
  it('defaults to page-center, 45deg when the trailing args are omitted (4-arg call)', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const bytes = await makeOnePagePdf(dom, 200, 300);

    const drawTextSpy = vi.spyOn(dom.window.PDFLib.PDFPage.prototype, 'drawText');
    await dom.window.watermark(bytes, 'AB', 0.3, 40);

    const opts = drawTextSpy.mock.calls[0][1];
    expect(opts.y).toBeCloseTo(150); // 50% of pageHeight 300
    expect(opts.rotate.angle).toBeCloseTo(45);
  });

  it('honors custom xPercent/yPercent/angleDegrees', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const bytes = await makeOnePagePdf(dom, 200, 300);

    const drawTextSpy = vi.spyOn(dom.window.PDFLib.PDFPage.prototype, 'drawText');
    await dom.window.watermark(bytes, 'AB', 0.3, 40, 25, 75, 90);

    const opts = drawTextSpy.mock.calls[0][1];
    expect(opts.y).toBeCloseTo(225); // 75% of pageHeight 300
    expect(opts.rotate.angle).toBeCloseTo(90);
  });

  it('centers x on the xPercent anchor the same way regardless of angle', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const bytes = await makeOnePagePdf(dom, 200, 300);
    const doc = await dom.window.PDFLib.PDFDocument.load(bytes);
    const font = await doc.embedFont(dom.window.PDFLib.StandardFonts.HelveticaBold);
    const textWidth = font.widthOfTextAtSize('AB', 40);

    const drawTextSpy = vi.spyOn(dom.window.PDFLib.PDFPage.prototype, 'drawText');
    await dom.window.watermark(bytes, 'AB', 0.3, 40, 25, 50, 0);

    const opts = drawTextSpy.mock.calls[0][1];
    // x = (25/100)*200 - textWidth/2
    expect(opts.x).toBeCloseTo(50 - textWidth / 2);
  });
});
