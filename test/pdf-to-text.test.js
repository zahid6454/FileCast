import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

function mockPdfjsLib(win, { pages }) {
  win.pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument: function () {
      return {
        promise: Promise.resolve({
          numPages: pages.length,
          getPage: function (pageNum) {
            return Promise.resolve({
              getTextContent: function () {
                return Promise.resolve({ items: pages[pageNum - 1] });
              }
            });
          }
        })
      };
    }
  };
}

function item(str, hasEOL) {
  return { str: str, hasEOL: !!hasEOL };
}

describe('pdf-to-text.js — window.convertFile', () => {
  it('joins text items into lines and pages into a single .txt blob', async () => {
    const dom = createDom();
    mockPdfjsLib(dom.window, {
      pages: [
        [item('Hello', false), item('world', true), item('Second line', true)],
        [item('Page two', true)]
      ]
    });
    evalScript(dom, 'converters/pdf-to-text.js');

    const file = new dom.window.File([new Uint8Array(10)], 'doc.pdf', { type: 'application/pdf' });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('text/plain');
    const text = await blob.text();
    expect(text).toBe('Hello world\nSecond line\n\nPage two');
  });

  it('rejects with a clear error when the PDF has no extractable text', async () => {
    const dom = createDom();
    mockPdfjsLib(dom.window, { pages: [[]] });
    evalScript(dom, 'converters/pdf-to-text.js');

    const file = new dom.window.File([new Uint8Array(10)], 'scanned.pdf', {
      type: 'application/pdf'
    });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/no text found/i);
  });

  it('sets the pdf.js worker source from TOOL_CONFIG when provided', async () => {
    const dom = createDom();
    mockPdfjsLib(dom.window, { pages: [[item('hi', true)]] });
    dom.window.TOOL_CONFIG = { pdf_worker_src: '/pdf.worker.min.js' };
    evalScript(dom, 'converters/pdf-to-text.js');

    const file = new dom.window.File([new Uint8Array(10)], 'doc.pdf', { type: 'application/pdf' });
    await dom.window.convertFile(file);

    expect(dom.window.pdfjsLib.GlobalWorkerOptions.workerSrc).toBe('/pdf.worker.min.js');
  });
});
