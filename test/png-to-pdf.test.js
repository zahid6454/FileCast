import { describe, expect, it, vi } from 'vitest';
import { createDom, evalScript } from './helpers.js';

function mockPDFLib(win, { embedWidth = 100, embedHeight = 80 } = {}) {
  var pages = [];
  var embedPng = vi
    .fn()
    .mockResolvedValue({ scale: () => ({ width: embedWidth, height: embedHeight }) });
  var pdfDoc = {
    addPage: function (dims) {
      var page = { drawImage: vi.fn(), dims: dims };
      pages.push(page);
      return page;
    },
    embedPng: embedPng,
    save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))
  };
  win.PDFLib = { PDFDocument: { create: () => Promise.resolve(pdfDoc) } };
  return { pdfDoc: pdfDoc, pages: pages, embedPng: embedPng };
}

describe('png-to-pdf.js — window.convertFiles', () => {
  it('embeds a PNG and produces a one-page PDF', async () => {
    const dom = createDom();
    const { pages, embedPng } = mockPDFLib(dom.window);
    evalScript(dom, 'converters/png-to-pdf.js');

    const file = new dom.window.File([new Uint8Array(10)], 'graphic.png', { type: 'image/png' });
    const { blob, filename } = await dom.window.convertFiles([file]);

    expect(embedPng).toHaveBeenCalledTimes(1);
    expect(pages).toHaveLength(1);
    expect(pages[0].drawImage).toHaveBeenCalledTimes(1);
    expect(pages[0].dims).toEqual([100, 80]);
    expect(blob.type).toBe('application/pdf');
    expect(filename).toBe('images.pdf');
  });

  it('adds one page per file, in order, for multiple files', async () => {
    const dom = createDom();
    const { pages } = mockPDFLib(dom.window);
    evalScript(dom, 'converters/png-to-pdf.js');

    const files = [
      new dom.window.File([new Uint8Array(10)], 'a.png', { type: 'image/png' }),
      new dom.window.File([new Uint8Array(10)], 'b.png', { type: 'image/png' })
    ];
    await dom.window.convertFiles(files);

    expect(pages).toHaveLength(2);
  });
});
