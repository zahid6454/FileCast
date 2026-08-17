import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

// Minimal ZIP central-directory reader — enough to pull out one part's raw
// bytes by name without a real unzip library, so tests can assert on the
// word/document.xml the converter actually wrote. Mirrors
// test/csv-to-xlsx.test.js's readZipEntry() exactly, since both converters
// share the same hand-rolled "stored" ZIP writer.
function readZipEntry(bytes, name) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  expect(eocdOffset).toBeGreaterThanOrEqual(0);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  let pos = view.getUint32(eocdOffset + 16, true);

  for (let i = 0; i < entryCount; i++) {
    const sig = view.getUint32(pos, true);
    expect(sig).toBe(0x02014b50);
    const compSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const entryName = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLen));

    if (entryName === name) {
      const localNameLen = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      return new TextDecoder().decode(bytes.subarray(dataStart, dataStart + compSize));
    }

    pos += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('Entry not found: ' + name);
}

async function convert(dom, markdown, filename = 'a.md') {
  const file = new dom.window.File([markdown], filename, { type: 'text/markdown' });
  const blob = await dom.window.convertFile(file);
  expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

describe('markdown-to-docx.js — window.convertFile', () => {
  it('rejects empty/whitespace-only input', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/markdown-to-docx.js');
    const file = new dom.window.File(['   \n  '], 'empty.md', { type: 'text/markdown' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/no content/i);
  });

  it('produces a valid ZIP with the expected OOXML parts', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/markdown-to-docx.js');
    const bytes = await convert(dom, '# Title\n\nSome text.');

    const contentTypes = readZipEntry(bytes, '[Content_Types].xml');
    expect(contentTypes).toContain('word/document.xml');
    const rootRels = readZipEntry(bytes, '_rels/.rels');
    expect(rootRels).toContain('word/document.xml');
    // document.xml.rels exists and is a well-formed (empty) relationships part.
    expect(readZipEntry(bytes, 'word/_rels/document.xml.rels')).toContain('<Relationships');
  });

  it('renders a heading as a bold, larger run', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/markdown-to-docx.js');
    const bytes = await convert(dom, '# Title');
    const doc = readZipEntry(bytes, 'word/document.xml');

    expect(doc).toContain('<w:b/>');
    expect(doc).toContain('<w:sz w:val="44"/>'); // 22pt heading, half-points
    expect(doc).toContain('<w:t xml:space="preserve">Title</w:t>');
  });

  it('renders bold and italic inline runs separately', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/markdown-to-docx.js');
    const bytes = await convert(dom, 'Some **bold** and *italic* text.');
    const doc = readZipEntry(bytes, 'word/document.xml');

    expect(doc).toContain('<w:rPr><w:b/></w:rPr><w:t xml:space="preserve">bold</w:t>');
    expect(doc).toContain('<w:rPr><w:i/></w:rPr><w:t xml:space="preserve">italic</w:t>');
  });

  it('renders a bulleted list item with a bullet prefix and an indent', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/markdown-to-docx.js');
    const bytes = await convert(dom, '- first item');
    const doc = readZipEntry(bytes, 'word/document.xml');

    expect(doc).toContain('<w:ind w:left="720"/>');
    expect(doc).toContain('<w:t xml:space="preserve">• </w:t>');
    expect(doc).toContain('<w:t xml:space="preserve">first item</w:t>');
  });

  it('renders a code block line in a monospace font', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/markdown-to-docx.js');
    const bytes = await convert(dom, '```\nconst x = 1;\n```');
    const doc = readZipEntry(bytes, 'word/document.xml');

    expect(doc).toContain('<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>');
    expect(doc).toContain('const x = 1;');
  });

  it('escapes XML special characters in text content', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/markdown-to-docx.js');
    const bytes = await convert(dom, 'Tom & Jerry <3');
    const doc = readZipEntry(bytes, 'word/document.xml');

    expect(doc).toContain('Tom &amp; Jerry &lt;3');
  });

  it('renders a link as its text and URL, and an image as a placeholder', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/markdown-to-docx.js');
    const bytes = await convert(dom, '[FileCast](https://filecast.org) ![alt text](x.png)');
    const doc = readZipEntry(bytes, 'word/document.xml');

    expect(doc).toContain('FileCast (https://filecast.org)');
    expect(doc).toContain('[Image: alt text]');
  });
});
