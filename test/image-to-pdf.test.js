import { describe, expect, it, vi } from 'vitest';
import { createDom, evalScript, mockCanvas, mockImageLoad } from './helpers.js';

function mockPDFLib(win, { embedWidth = 100, embedHeight = 80 } = {}) {
  var pages = [];
  var embedPng = vi
    .fn()
    .mockResolvedValue({ scale: () => ({ width: embedWidth, height: embedHeight }) });
  var embedJpg = vi
    .fn()
    .mockResolvedValue({ scale: () => ({ width: embedWidth, height: embedHeight }) });
  var pdfDoc = {
    addPage: function (dims) {
      var page = { drawImage: vi.fn(), dims: dims };
      pages.push(page);
      return page;
    },
    embedPng: embedPng,
    embedJpg: embedJpg,
    save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))
  };
  win.PDFLib = { PDFDocument: { create: () => Promise.resolve(pdfDoc) } };
  return { pdfDoc: pdfDoc, pages: pages, embedPng: embedPng, embedJpg: embedJpg };
}

describe('image-to-pdf.js — window.convertFiles', () => {
  it('embeds a PNG directly (no canvas re-encode) and produces a one-page PDF', async () => {
    const dom = createDom();
    const { pages, embedPng, embedJpg } = mockPDFLib(dom.window);
    evalScript(dom, 'converters/image-to-pdf.js');

    const file = new dom.window.File([new Uint8Array(10)], 'graphic.png', { type: 'image/png' });
    const { blob, filename } = await dom.window.convertFiles([file]);

    expect(embedPng).toHaveBeenCalledTimes(1);
    expect(embedJpg).not.toHaveBeenCalled();
    expect(pages).toHaveLength(1);
    expect(pages[0].drawImage).toHaveBeenCalledTimes(1);
    expect(blob.type).toBe('application/pdf');
    expect(filename).toBe('images.pdf');
  });

  it('embeds a JPG directly (no canvas re-encode)', async () => {
    const dom = createDom();
    const { embedJpg, embedPng } = mockPDFLib(dom.window);
    evalScript(dom, 'converters/image-to-pdf.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await dom.window.convertFiles([file]);

    expect(embedJpg).toHaveBeenCalledTimes(1);
    expect(embedPng).not.toHaveBeenCalled();
  });

  it('re-encodes an unsupported format (e.g. WebP) to JPEG via canvas before embedding', async () => {
    const dom = createDom();
    mockImageLoad(dom.window, { width: 50, height: 50 });
    const { ctx } = mockCanvas(dom.window);
    const { embedJpg } = mockPDFLib(dom.window);
    evalScript(dom, 'converters/image-to-pdf.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.webp', { type: 'image/webp' });
    await dom.window.convertFiles([file]);

    expect(ctx.drawImage.mock.calls.length).toBe(1);
    expect(embedJpg).toHaveBeenCalledTimes(1);
    // Re-encoded onto a white background since JPEG has no alpha channel.
    expect(ctx.fillRect.mock.calls.length).toBe(1);
  });

  it('adds one page per file, in order, for multiple files', async () => {
    const dom = createDom();
    const { pages } = mockPDFLib(dom.window);
    evalScript(dom, 'converters/image-to-pdf.js');

    const files = [
      new dom.window.File([new Uint8Array(10)], 'a.png', { type: 'image/png' }),
      new dom.window.File([new Uint8Array(10)], 'b.jpg', { type: 'image/jpeg' })
    ];
    await dom.window.convertFiles(files);

    expect(pages).toHaveLength(2);
  });

  it('rejects with the filename when a re-encoded image fails to load', async () => {
    const dom = createDom();
    mockImageLoad(dom.window, { shouldError: true });
    mockCanvas(dom.window);
    mockPDFLib(dom.window);
    evalScript(dom, 'converters/image-to-pdf.js');

    const file = new dom.window.File([new Uint8Array(10)], 'broken.webp', { type: 'image/webp' });
    await expect(dom.window.convertFiles([file])).rejects.toThrow(
      /failed to load image: broken\.webp/i
    );
  });
});
