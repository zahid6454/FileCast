import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Builds a minimal ICO container by hand for the test — mirrors the exact
// layout png-to-ico.js itself writes (6-byte ICONDIR + 16-byte
// ICONDIRENTRY per image + raw image bytes back-to-back).
function buildFakeIco(entries) {
  const headerSize = 6 + 16 * entries.length;
  const totalSize = headerSize + entries.reduce((sum, e) => sum + e.data.length, 0);
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, entries.length, true);

  let dirOffset = 6;
  let dataOffset = headerSize;
  for (const entry of entries) {
    out[dirOffset] = entry.width >= 256 ? 0 : entry.width;
    out[dirOffset + 1] = entry.height >= 256 ? 0 : entry.height;
    view.setUint32(dirOffset + 8, entry.data.length, true);
    view.setUint32(dirOffset + 12, dataOffset, true);
    out.set(entry.data, dataOffset);
    dirOffset += 16;
    dataOffset += entry.data.length;
  }
  return out;
}

describe('ico-to-png.js — window.convertFile', () => {
  it('extracts the largest PNG-format icon image', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/ico-to-png.js');

    const smallPng = new Uint8Array([...PNG_SIGNATURE, 1, 2, 3]);
    const largePng = new Uint8Array([...PNG_SIGNATURE, 4, 5, 6, 7, 8]);
    const icoBytes = buildFakeIco([
      { width: 16, height: 16, data: smallPng },
      { width: 256, height: 256, data: largePng }
    ]);

    const file = new dom.window.File([icoBytes], 'app.ico', { type: 'image/x-icon' });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/png');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(largePng));
  });

  it('rejects a file with no ICONDIR header', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/ico-to-png.js');

    const file = new dom.window.File([new Uint8Array([1, 2, 3])], 'bad.ico', {
      type: 'image/x-icon'
    });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/not look like a valid ico/i);
  });

  it('rejects a legacy BMP-format icon entry', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/ico-to-png.js');

    const bmpEntry = new Uint8Array([0x28, 0, 0, 0, 1, 2, 3, 4]); // BITMAPINFOHEADER, not PNG
    const icoBytes = buildFakeIco([{ width: 32, height: 32, data: bmpEntry }]);

    const file = new dom.window.File([icoBytes], 'legacy.ico', { type: 'image/x-icon' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/legacy bmp-format/i);
  });
});
