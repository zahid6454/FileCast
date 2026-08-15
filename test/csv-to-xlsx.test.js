import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

function decodeDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mime: match[1], bytes };
}

// Minimal ZIP central-directory reader — enough to pull out one part's raw
// bytes by name without a real unzip library, so tests can assert on the
// worksheet XML the converter actually wrote.
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
    const uncompSize = view.getUint32(pos + 24, true);
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
    void uncompSize;
  }
  throw new Error('Entry not found: ' + name);
}

describe('csv-to-xlsx.js — window.convertText', () => {
  it('returns a data URL with the XLSX mime type and .xlsx filename', () => {
    const dom = createDom();
    evalScript(dom, 'converters/csv-to-xlsx.js');

    const csv = 'name,age\nAlice,30\nBob,25\n';
    const { text, filename } = dom.window.convertText(csv);

    expect(filename).toBe('data.xlsx');
    expect(text).toMatch(
      /^data:application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet;base64,/
    );
  });

  it('produces a valid ZIP with the expected OOXML parts', () => {
    const dom = createDom();
    evalScript(dom, 'converters/csv-to-xlsx.js');

    const csv = 'name,age\nAlice,30\nBob,25\n';
    const { text } = dom.window.convertText(csv);
    const { mime, bytes } = decodeDataUrl(text);

    expect(mime).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const sheet = readZipEntry(bytes, 'xl/worksheets/sheet1.xml');
    expect(sheet).toContain(
      '<c r="A1" t="inlineStr"><is><t xml:space="preserve">name</t></is></c>'
    );
    expect(sheet).toContain('<c r="B2"><v>30</v></c>');
    expect(sheet).toContain(
      '<c r="A2" t="inlineStr"><is><t xml:space="preserve">Alice</t></is></c>'
    );
  });

  it('preserves a leading-zero value as text instead of coercing it to a number', () => {
    const dom = createDom();
    evalScript(dom, 'converters/csv-to-xlsx.js');

    const csv = 'zip\n00501\n';
    const { text } = dom.window.convertText(csv);
    const { bytes } = decodeDataUrl(text);
    const sheet = readZipEntry(bytes, 'xl/worksheets/sheet1.xml');

    expect(sheet).toContain('t="inlineStr"><is><t xml:space="preserve">00501</t></is>');
  });

  it('escapes XML special characters in cell text', () => {
    const dom = createDom();
    evalScript(dom, 'converters/csv-to-xlsx.js');

    const csv = 'note\n"Tom & Jerry <3"\n';
    const { text } = dom.window.convertText(csv);
    const { bytes } = decodeDataUrl(text);
    const sheet = readZipEntry(bytes, 'xl/worksheets/sheet1.xml');

    expect(sheet).toContain('Tom &amp; Jerry &lt;3');
  });

  it('throws on completely empty input', () => {
    const dom = createDom();
    evalScript(dom, 'converters/csv-to-xlsx.js');

    expect(() => dom.window.convertText('   \n  ')).toThrow(/at least one row/);
  });
});
