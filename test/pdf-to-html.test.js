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

describe('pdf-to-html.js — window.convertFile', () => {
  it('builds a standalone HTML document with one <p> per line and one <section> per page', async () => {
    const dom = createDom();
    mockPdfjsLib(dom.window, {
      pages: [[item('Hello', false), item('world', true)], [item('Page two', true)]]
    });
    evalScript(dom, 'converters/pdf-to-html.js');

    const file = new dom.window.File([new Uint8Array(10)], 'report.pdf', {
      type: 'application/pdf'
    });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('text/html');
    const html = await blob.text();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>report</title>');
    expect(html).toContain('<p>Hello world</p>');
    expect(html).toContain('data-page="1"');
    expect(html).toContain('<p>Page two</p>');
    expect(html).toContain('data-page="2"');
  });

  it('escapes HTML-sensitive characters in extracted text', async () => {
    const dom = createDom();
    mockPdfjsLib(dom.window, { pages: [[item('<script>alert("x")</script>', true)]] });
    evalScript(dom, 'converters/pdf-to-html.js');

    const file = new dom.window.File([new Uint8Array(10)], 'doc.pdf', { type: 'application/pdf' });
    const blob = await dom.window.convertFile(file);
    const html = await blob.text();

    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rejects with a clear error when the PDF has no extractable text', async () => {
    const dom = createDom();
    mockPdfjsLib(dom.window, { pages: [[]] });
    evalScript(dom, 'converters/pdf-to-html.js');

    const file = new dom.window.File([new Uint8Array(10)], 'scanned.pdf', {
      type: 'application/pdf'
    });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/no text found/i);
  });
});
