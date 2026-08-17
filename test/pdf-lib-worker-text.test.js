import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createDom } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Same technique as test/pdf-lib-worker-crypto.test.js: strip the top-level
// 'use strict' directive so eval'd top-level function declarations land on
// dom.window (real `use strict` eval semantics give them their own isolated
// scope instead) — the shipped file itself is untouched.
function evalStrippingUseStrict(dom, absPath) {
  const src = fs.readFileSync(absPath, 'utf8').replace(/^\s*(['"])use strict\1;\s*\n/, '');
  dom.window.eval(src);
}

// txtToPdf()/markdownToPdf() are new word-wrap/pagination logic with no
// precedent anywhere in this codebase (watermark()/pageNumbers() only ever
// draw one line) — loading the real pdf-lib.min.js (not a mock) matters here
// because the wrap algorithm depends on real font.widthOfTextAtSize()
// measurements, not just call counts.
function loadPdfLibWorkerGlobals() {
  const dom = createDom();
  evalStrippingUseStrict(dom, path.join(ROOT, 'static', 'lib', 'pdf-lib.min.js'));
  evalStrippingUseStrict(dom, path.join(ROOT, 'static', 'js', 'workers', 'pdf-lib-worker.js'));
  return dom;
}

describe('pdf-lib-worker.js — txtToPdf', () => {
  it('rejects empty/whitespace-only input', async () => {
    const dom = loadPdfLibWorkerGlobals();
    await expect(dom.window.txtToPdf('   \n  ', {})).rejects.toThrow(/no text/i);
  });

  it('paginates long input onto more than one page', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const longText = new Array(3000).fill('word').join(' ');
    const result = await dom.window.txtToPdf(longText, { pageSize: 'letter', fontSize: 11 });
    const pdfDoc = await dom.window.PDFLib.PDFDocument.load(result.bytes);
    expect(pdfDoc.getPageCount()).toBeGreaterThan(1);
  });

  it('uses Letter dimensions by default and A4 when requested', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const letterResult = await dom.window.txtToPdf('hello world', {});
    const letterDoc = await dom.window.PDFLib.PDFDocument.load(letterResult.bytes);
    const letterSize = letterDoc.getPage(0).getSize();
    expect(letterSize.width).toBeCloseTo(612);
    expect(letterSize.height).toBeCloseTo(792);

    const a4Result = await dom.window.txtToPdf('hello world', { pageSize: 'a4' });
    const a4Doc = await dom.window.PDFLib.PDFDocument.load(a4Result.bytes);
    const a4Size = a4Doc.getPage(0).getSize();
    expect(a4Size.width).toBeCloseTo(595.28, 1);
    expect(a4Size.height).toBeCloseTo(841.89, 1);
  });

  it('preserves blank lines as spacing without drawing them', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const drawTextSpy = vi.spyOn(dom.window.PDFLib.PDFPage.prototype, 'drawText');
    await dom.window.txtToPdf('first paragraph\n\nsecond paragraph', {});
    expect(drawTextSpy).toHaveBeenCalledTimes(2);
    expect(drawTextSpy.mock.calls[0][0]).toBe('first paragraph');
    expect(drawTextSpy.mock.calls[1][0]).toBe('second paragraph');
  });

  it('word-wraps a long line to fit the page width', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const drawTextSpy = vi.spyOn(dom.window.PDFLib.PDFPage.prototype, 'drawText');
    const longLine = new Array(80).fill('lorem').join(' ');
    await dom.window.txtToPdf(longLine, { fontSize: 11 });
    expect(drawTextSpy.mock.calls.length).toBeGreaterThan(1);
    drawTextSpy.mock.calls.forEach((call) => {
      expect(call[0].split(' ').length).toBeLessThan(80);
    });
  });

  it('breaks a single word wider than the page into pieces that each fit', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const pdfDoc = await dom.window.PDFLib.PDFDocument.create();
    const font = await pdfDoc.embedFont(dom.window.PDFLib.StandardFonts.Helvetica);
    const longWord = 'a'.repeat(200);
    const pieces = dom.window.breakLongWord(longWord, font, 11, 100);
    expect(pieces.length).toBeGreaterThan(1);
    pieces.forEach((piece) => {
      expect(font.widthOfTextAtSize(piece, 11)).toBeLessThanOrEqual(100);
    });
    expect(pieces.join('')).toBe(longWord);
  });
});

describe('pdf-lib-worker.js — markdownToPdf', () => {
  it('rejects empty/whitespace-only input', async () => {
    const dom = loadPdfLibWorkerGlobals();
    await expect(dom.window.markdownToPdf('   \n  ', {})).rejects.toThrow(/no content/i);
  });

  it('draws a heading in a larger size than a paragraph', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const drawTextSpy = vi.spyOn(dom.window.PDFLib.PDFPage.prototype, 'drawText');
    await dom.window.markdownToPdf('# Title\n\nSome regular text.', {});
    const headingCall = drawTextSpy.mock.calls.find((c) => c[0] === 'Title');
    const paraCall = drawTextSpy.mock.calls.find((c) => c[0].indexOf('Some') === 0);
    expect(headingCall[1].size).toBe(22);
    expect(paraCall[1].size).toBe(11);
  });

  it('draws bold/italic markdown runs with the matching embedded font', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const drawTextSpy = vi.spyOn(dom.window.PDFLib.PDFPage.prototype, 'drawText');
    await dom.window.markdownToPdf('Some **bold** and *italic* words.', {});
    const boldCall = drawTextSpy.mock.calls.find((c) => c[0] === 'bold');
    const italicCall = drawTextSpy.mock.calls.find((c) => c[0] === 'italic');
    const regularCall = drawTextSpy.mock.calls.find((c) => c[0] === 'Some');
    expect(boldCall[1].font).not.toBe(regularCall[1].font);
    expect(italicCall[1].font).not.toBe(regularCall[1].font);
    expect(boldCall[1].font).not.toBe(italicCall[1].font);
  });

  it('renders a bulleted list item with a bullet prefix', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const drawTextSpy = vi.spyOn(dom.window.PDFLib.PDFPage.prototype, 'drawText');
    await dom.window.markdownToPdf('- first item', {});
    const bulletCall = drawTextSpy.mock.calls.find((c) => c[0].indexOf('•') === 0);
    expect(bulletCall).toBeTruthy();
  });

  it('paginates a long markdown document onto more than one page', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const paragraphs = new Array(120).fill('This is a paragraph of body text.').join('\n\n');
    const result = await dom.window.markdownToPdf(paragraphs, {});
    const pdfDoc = await dom.window.PDFLib.PDFDocument.load(result.bytes);
    expect(pdfDoc.getPageCount()).toBeGreaterThan(1);
  });
});

describe('pdf-lib-worker.js — parseMarkdownBlocks/parseInlineRuns', () => {
  it('parses headings, list items, and inline styling', () => {
    const dom = loadPdfLibWorkerGlobals();
    const blocks = dom.window.parseMarkdownBlocks(
      '# Heading\n\n- item one\n- item two\n\n**bold** and *italic* and `code`'
    );
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 1 });
    expect(blocks[1]).toMatchObject({ type: 'listitem', ordered: false });
    expect(blocks[2]).toMatchObject({ type: 'listitem', ordered: false });
    const runs = blocks[3].runs;
    expect(runs.find((r) => r.text === 'bold').bold).toBe(true);
    expect(runs.find((r) => r.text === 'italic').italic).toBe(true);
    expect(runs.find((r) => r.text === 'code').code).toBe(true);
  });

  it('parses a code fence as its own block, not paragraphs', () => {
    const dom = loadPdfLibWorkerGlobals();
    const blocks = dom.window.parseMarkdownBlocks('```\nconst x = 1;\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'code', lines: ['const x = 1;'] });
  });

  it('renders a link as its text followed by the URL, and an image as a placeholder', () => {
    const dom = loadPdfLibWorkerGlobals();
    const runs = dom.window.parseInlineRuns('[FileCast](https://filecast.org) ![alt text](x.png)');
    expect(runs.map((r) => r.text).join('')).toContain('FileCast (https://filecast.org)');
    expect(runs.map((r) => r.text).join('')).toContain('[Image: alt text]');
  });
});
