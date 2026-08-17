import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createDom, evalScript } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Same technique as test/pdf-lib-worker-crypto.test.js and
// test/pdf-lib-worker-text.test.js: strip the top-level 'use strict'
// directive so indirect eval's top-level function declarations land on
// dom.window instead of staying invisible outside the eval() call.
function loadPdfLibWorkerGlobals() {
  const dom = createDom();
  const stripUseStrict = (src) => src.replace(/^\s*(['"])use strict\1;\s*\n/, '');
  dom.window.eval(
    stripUseStrict(fs.readFileSync(path.join(ROOT, 'static', 'lib', 'pdf-lib.min.js'), 'utf8'))
  );
  dom.window.eval(
    stripUseStrict(
      fs.readFileSync(path.join(ROOT, 'static', 'js', 'workers', 'pdf-lib-worker.js'), 'utf8')
    )
  );
  return dom;
}

// static/js/workers/pdf-lib-worker.js's markdownToPdf() and
// static/js/converters/markdown-to-docx.js's convertFile() each hand-roll
// their own copy of the same Markdown block/inline parser (deliberately
// duplicated rather than shared — see the comment at the top of each file's
// parser section). A markdown-syntax fix applied to only one copy would let
// markdown-to-pdf and markdown-to-docx silently render the same input
// differently. This file is the guard against exactly that: run one
// reasonably feature-complete Markdown document through both converters and
// assert the same significant words/structure appear in both outputs.

const FIXTURE = [
  '# Report Title',
  '',
  '## Section One',
  '',
  'This has **bold text** and *italic text* and `inline code`.',
  '',
  '- bullet one',
  '- bullet two',
  '',
  '1. ordered one',
  '2. ordered two',
  '',
  '> A quoted remark.',
  '',
  '```',
  'const x = 1;',
  '```',
  '',
  '[FileCast](https://filecast.org/) and ![a diagram](diagram.png).'
].join('\n');

async function renderPdfDrawnWords(dom) {
  const drawTextSpy = vi.spyOn(dom.window.PDFLib.PDFPage.prototype, 'drawText');
  await dom.window.markdownToPdf(FIXTURE, {});
  return drawTextSpy.mock.calls.map((c) => c[0]);
}

async function renderDocxText(dom) {
  const file = new dom.window.File([FIXTURE], 'fixture.md', { type: 'text/markdown' });
  const blob = await dom.window.convertFile(file);
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Same minimal ZIP reader as test/markdown-to-docx.test.js.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  const entryCount = view.getUint16(eocdOffset + 10, true);
  let pos = view.getUint32(eocdOffset + 16, true);
  for (let i = 0; i < entryCount; i++) {
    const compSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const entryName = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    if (entryName === 'word/document.xml') {
      const localNameLen = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      return new TextDecoder().decode(bytes.subarray(dataStart, dataStart + compSize));
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('word/document.xml not found');
}

describe('markdown-to-pdf.js / markdown-to-docx.js — parser parity', () => {
  it('both converters recognize the same headings, styled words, list items, quote, code, and link/image text', async () => {
    const pdfDom = loadPdfLibWorkerGlobals();
    const pdfWords = await renderPdfDrawnWords(pdfDom);
    const pdfText = pdfWords.join(' ');

    const docxDom = createDom();
    evalScript(docxDom, 'converters/markdown-to-docx.js');
    const docxXml = await renderDocxText(docxDom);

    const expectedFragments = [
      'Report Title',
      'Section One',
      'bold',
      'text',
      'italic',
      'inline',
      'code',
      'bullet one',
      'bullet two',
      'ordered one',
      'ordered two',
      'quoted remark',
      'const x = 1;',
      'FileCast (https://filecast.org/)',
      '[Image: a diagram]'
    ];

    expectedFragments.forEach((fragment) => {
      expect(pdfText, `PDF output missing "${fragment}"`).toContain(fragment);
      expect(docxXml, `DOCX output missing "${fragment}"`).toContain(fragment);
    });
  });
});
