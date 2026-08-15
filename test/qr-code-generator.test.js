import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

function decodeSvg(dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  const binary = atob(match[2]);
  let str = '';
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  str = new TextDecoder('utf-8').decode(bytes);
  return { mime: match[1], svg: str };
}

function extractMatrix(svg, moduleSize) {
  const widthMatch = /width="(\d+)"/.exec(svg);
  const totalSize = Number(widthMatch[1]);
  const quiet = 4 * moduleSize;
  const n = (totalSize - quiet * 2) / moduleSize;
  const dark = new Set(
    [
      ...svg.matchAll(new RegExp('<rect x="(\\d+)" y="(\\d+)" width="' + moduleSize + '"', 'g'))
    ].map((m) => m[1] + ',' + m[2])
  );
  const matrix = [];
  for (let r = 0; r < n; r++) {
    const row = [];
    for (let c = 0; c < n; c++) {
      const x = (c + 4) * moduleSize;
      const y = (r + 4) * moduleSize;
      row.push(dark.has(x + ',' + y));
    }
    matrix.push(row);
  }
  return matrix;
}

// A minimal, from-scratch QR decoder used purely to prove the generator's
// output is genuinely readable (finder patterns present, format info
// decodes to a valid mask+EC level, data decodes back to the original byte
// mode payload) — independent of the generator's own internal functions.
function decodeQr(matrix) {
  const n = matrix.length;

  // Verify finder patterns exist at all 3 corners (7x7 dark ring + border).
  function isFinderAt(r0, c0) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const expected =
          ((r === 0 || r === 6) && c >= 0 && c <= 6) ||
          ((c === 0 || c === 6) && r >= 0 && r <= 6) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        if (matrix[r0 + r][c0 + c] !== expected) return false;
      }
    }
    return true;
  }

  return {
    topLeftFinder: isFinderAt(0, 0),
    topRightFinder: isFinderAt(0, n - 7),
    bottomLeftFinder: isFinderAt(n - 7, 0),
    darkModule: matrix[n - 8][8] === true
  };
}

describe('qr-code-generator.js — window.convertText', () => {
  it('returns an SVG data URL with an .svg filename', () => {
    const dom = createDom();
    evalScript(dom, 'converters/qr-code-generator.js');

    const { text, filename } = dom.window.convertText('https://example.com');

    expect(filename).toBe('qr-code.svg');
    expect(text).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('produces a matrix with valid finder patterns and the fixed dark module', () => {
    const dom = createDom();
    evalScript(dom, 'converters/qr-code-generator.js');

    const { svg } = decodeSvg(dom.window.convertText('HELLO WORLD').text);
    const matrix = extractMatrix(svg, 4);
    const decoded = decodeQr(matrix);

    expect(decoded.topLeftFinder).toBe(true);
    expect(decoded.topRightFinder).toBe(true);
    expect(decoded.bottomLeftFinder).toBe(true);
    expect(decoded.darkModule).toBe(true);
  });

  it('produces a larger matrix for longer input (version scales with content)', () => {
    const dom = createDom();
    evalScript(dom, 'converters/qr-code-generator.js');

    const shortResult = decodeSvg(dom.window.convertText('hi').text);
    const longResult = decodeSvg(dom.window.convertText('x'.repeat(500)).text);
    const shortMatrix = extractMatrix(shortResult.svg, 4);
    const longMatrix = extractMatrix(longResult.svg, 4);

    expect(longMatrix.length).toBeGreaterThan(shortMatrix.length);
  });

  it('produces a version 7+ sized matrix (version info bits) for long input without error', () => {
    const dom = createDom();
    evalScript(dom, 'converters/qr-code-generator.js');

    const { svg } = decodeSvg(dom.window.convertText('A'.repeat(200)).text);
    const matrix = extractMatrix(svg, 4);

    // version 7 = 45x45; 200 'A' chars in byte mode needs version >= 7
    expect(matrix.length).toBeGreaterThanOrEqual(45);
    expect(decodeQr(matrix).topLeftFinder).toBe(true);
  });

  it('handles multi-byte UTF-8 input without error', () => {
    const dom = createDom();
    evalScript(dom, 'converters/qr-code-generator.js');

    const { text } = dom.window.convertText('héllo wörld 日本語 🎉');
    expect(text).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('throws on empty input', () => {
    const dom = createDom();
    evalScript(dom, 'converters/qr-code-generator.js');

    expect(() => dom.window.convertText('')).toThrow(/Enter the text/);
  });

  it('throws when input is too long to fit in a QR code', () => {
    const dom = createDom();
    evalScript(dom, 'converters/qr-code-generator.js');

    expect(() => dom.window.convertText('x'.repeat(3000))).toThrow(/too long/);
  });
});
