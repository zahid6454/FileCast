import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

// Standard Code 128 (subset B) bar/space pattern table, ported from
// python-barcode's charsets/code128.py — used here as an independent oracle
// to decode the tool's SVG output back into text and verify the checksum,
// rather than re-deriving the same table the converter itself uses.
var CODES = [
  '11011001100',
  '11001101100',
  '11001100110',
  '10010011000',
  '10010001100',
  '10001001100',
  '10011001000',
  '10011000100',
  '10001100100',
  '11001001000',
  '11001000100',
  '11000100100',
  '10110011100',
  '10011011100',
  '10011001110',
  '10111001100',
  '10011101100',
  '10011100110',
  '11001110010',
  '11001011100',
  '11001001110',
  '11011100100',
  '11001110100',
  '11101101110',
  '11101001100',
  '11100101100',
  '11100100110',
  '11101100100',
  '11100110100',
  '11100110010',
  '11011011000',
  '11011000110',
  '11000110110',
  '10100011000',
  '10001011000',
  '10001000110',
  '10110001000',
  '10001101000',
  '10001100010',
  '11010001000',
  '11000101000',
  '11000100010',
  '10110111000',
  '10110001110',
  '10001101110',
  '10111011000',
  '10111000110',
  '10001110110',
  '11101110110',
  '11010001110',
  '11000101110',
  '11011101000',
  '11011100010',
  '11011101110',
  '11101011000',
  '11101000110',
  '11100010110',
  '11101101000',
  '11101100010',
  '11100011010',
  '11101111010',
  '11001000010',
  '11110001010',
  '10100110000',
  '10100001100',
  '10010110000',
  '10010000110',
  '10000101100',
  '10000100110',
  '10110010000',
  '10110000100',
  '10011010000',
  '10011000010',
  '10000110100',
  '10000110010',
  '11000010010',
  '11001010000',
  '11110111010',
  '11000010100',
  '10001111010',
  '10100111100',
  '10010111100',
  '10010011110',
  '10111100100',
  '10011110100',
  '10011110010',
  '11110100100',
  '11110010100',
  '11110010010',
  '11011011110',
  '11011110110',
  '11110110110',
  '10101111000',
  '10100011110',
  '10001011110',
  '10111101000',
  '10111100010',
  '11110101000',
  '11110100010',
  '10111011110',
  '10111101110',
  '11101011110',
  '11110101110',
  '11010000100',
  '11010010000',
  '11010011100'
];
var STOP_FULL = '1100011101011';

function decodeDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  return { mime: match[1], svg: Buffer.from(match[2], 'base64').toString('utf8') };
}

function extractPatternFromSvg(svg, moduleWidth) {
  const widthMatch = /width="(\d+)"/.exec(svg);
  const totalWidth = Number(widthMatch[1]);
  const quietZone = 10 * moduleWidth * 2;
  const numModules = (totalWidth - quietZone) / moduleWidth;
  const quiet = 10 * moduleWidth;
  const xs = new Set(
    [...svg.matchAll(/<rect x="(\d+)" y="0" width="2"/g)].map((m) => Number(m[1]))
  );
  let pattern = '';
  for (let m = 0; m < numModules; m++) {
    pattern += xs.has(quiet + m * moduleWidth) ? '1' : '0';
  }
  return pattern;
}

// Independently decodes a Code 128B bar pattern back to text, validating the
// checksum — this is the real proof the generator produces a scannable
// barcode, not just "some SVG with black rectangles in it."
function decodeCode128B(pattern) {
  expect(pattern.endsWith(STOP_FULL)).toBe(true);
  const body = pattern.slice(0, -STOP_FULL.length);
  expect(body.length % 11).toBe(0);
  const values = [];
  for (let i = 0; i < body.length; i += 11) {
    const symbol = body.slice(i, i + 11);
    const value = CODES.indexOf(symbol);
    expect(value).toBeGreaterThanOrEqual(0);
    values.push(value);
  }
  const start = values[0];
  const data = values.slice(1, -1);
  const checksum = values[values.length - 1];
  let expectedChecksum = start;
  data.forEach((v, i) => {
    expectedChecksum += (i + 1) * v;
  });
  expectedChecksum %= 103;
  expect(checksum).toBe(expectedChecksum);
  expect(start).toBe(104); // Start Code B
  return data.map((v) => String.fromCharCode(v + 32)).join('');
}

describe('barcode-generator.js — window.convertText', () => {
  it('returns an SVG data URL with an .svg filename', () => {
    const dom = createDom();
    evalScript(dom, 'converters/barcode-generator.js');

    const { text, filename } = dom.window.convertText('HELLO123');

    expect(filename).toBe('barcode.svg');
    expect(text).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('produces a barcode that decodes back to the original text with a valid checksum', () => {
    const dom = createDom();
    evalScript(dom, 'converters/barcode-generator.js');

    const cases = ['HELLO123', 'A', 'SKU-48213', '0123456789', 'a-Z_ space:test'];
    cases.forEach((input) => {
      const { text } = dom.window.convertText(input);
      const { mime, svg } = decodeDataUrl(text);
      expect(mime).toBe('image/svg+xml');
      const pattern = extractPatternFromSvg(svg, 2);
      expect(decodeCode128B(pattern)).toBe(input);
    });
  });

  it('includes the human-readable label text in the SVG', () => {
    const dom = createDom();
    evalScript(dom, 'converters/barcode-generator.js');

    const { text } = dom.window.convertText('SKU-48213');
    const { svg } = decodeDataUrl(text);

    expect(svg).toContain('>SKU-48213<');
  });

  it('throws on characters outside printable ASCII', () => {
    const dom = createDom();
    evalScript(dom, 'converters/barcode-generator.js');

    expect(() => dom.window.convertText('café')).toThrow(/printable ASCII/);
  });

  it('throws on empty input', () => {
    const dom = createDom();
    evalScript(dom, 'converters/barcode-generator.js');

    expect(() => dom.window.convertText('')).toThrow(/Enter the text/);
  });

  it('throws when input exceeds the length limit', () => {
    const dom = createDom();
    evalScript(dom, 'converters/barcode-generator.js');

    expect(() => dom.window.convertText('x'.repeat(81))).toThrow(/80 characters/);
  });
});
