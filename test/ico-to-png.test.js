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

  it('correctly treats a 0 width/height byte as meaning 256 (the largest entry)', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/ico-to-png.js');

    const mediumPng = new Uint8Array([...PNG_SIGNATURE, 9, 9]);
    const largePng = new Uint8Array([...PNG_SIGNATURE, 7, 7, 7, 7]);
    // width/height >= 256 is encoded as the byte value 0 — buildFakeIco
    // mirrors png-to-ico.js's own encoding of that convention.
    const icoBytes = buildFakeIco([
      { width: 48, height: 48, data: mediumPng },
      { width: 256, height: 256, data: largePng }
    ]);

    const file = new dom.window.File([icoBytes], 'app.ico', { type: 'image/x-icon' });
    const blob = await dom.window.convertFile(file);

    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(largePng));
  });

  it('rejects a header that declares zero images', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/ico-to-png.js');

    const out = new Uint8Array(6);
    const view = new DataView(out.buffer);
    view.setUint16(0, 0, true); // reserved
    view.setUint16(2, 1, true); // type: icon
    view.setUint16(4, 0, true); // count = 0

    const file = new dom.window.File([out], 'empty.ico', { type: 'image/x-icon' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/not look like a valid ico/i);
  });

  it('rejects a directory entry whose declared image data runs past the end of the file', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/ico-to-png.js');

    // A well-formed 6-byte header + one 16-byte directory entry, but the
    // entry's bytesInRes claims far more data than the file actually has —
    // simulates a truncated or corrupted download.
    const out = new Uint8Array(22);
    const view = new DataView(out.buffer);
    view.setUint16(0, 0, true);
    view.setUint16(2, 1, true);
    view.setUint16(4, 1, true);
    out[6] = 32;
    out[7] = 32;
    view.setUint32(6 + 8, 1000, true); // bytesInRes — far larger than the file
    view.setUint32(6 + 12, 22, true); // imageOffset — right after the directory

    const file = new dom.window.File([out], 'corrupt.ico', { type: 'image/x-icon' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/could not read any icon images/i);
  });
});
