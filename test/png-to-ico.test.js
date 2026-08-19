import { describe, expect, it } from 'vitest';
import { createDom, evalScript, mockCanvas, mockImageLoad } from './helpers.js';

describe('png-to-ico.js — window.convertFile', () => {
  it('renders 4 icon sizes and wraps them in a valid ICO container', async () => {
    const dom = createDom();
    mockImageLoad(dom.window, { width: 512, height: 512 });
    const { toBlobCalls } = mockCanvas(dom.window, { blobContent: 'x'.repeat(20) });
    evalScript(dom, 'converters/png-to-ico.js');

    const file = new dom.window.File([new Uint8Array(10)], 'logo.png', { type: 'image/png' });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/x-icon');
    // One render per icon size: 16, 32, 48, 256.
    expect(toBlobCalls).toEqual([
      { type: 'image/png', quality: undefined },
      { type: 'image/png', quality: undefined },
      { type: 'image/png', quality: undefined },
      { type: 'image/png', quality: undefined }
    ]);

    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);
    expect(view.getUint16(0, true)).toBe(0); // reserved
    expect(view.getUint16(2, true)).toBe(1); // type: icon
    expect(view.getUint16(4, true)).toBe(4); // 4 embedded images

    // Directory entries in size order: 16, 32, 48, then 0 (meaning 256).
    const headerSize = 6 + 16 * 4;
    const expectedSizes = [16, 32, 48, 0];
    let expectedDataOffset = headerSize;
    for (let i = 0; i < 4; i++) {
      const dirOffset = 6 + i * 16;
      expect(view.getUint8(dirOffset)).toBe(expectedSizes[i]); // width
      expect(view.getUint8(dirOffset + 1)).toBe(expectedSizes[i]); // height
      expect(view.getUint16(dirOffset + 4, true)).toBe(1); // color planes
      expect(view.getUint16(dirOffset + 6, true)).toBe(32); // bits per pixel
      expect(view.getUint32(dirOffset + 8, true)).toBe(20); // bytesInRes, matches mock blob length
      expect(view.getUint32(dirOffset + 12, true)).toBe(expectedDataOffset); // imageOffset
      expectedDataOffset += 20;
    }

    // The bytes at each entry's declared offset must be exactly the PNG
    // bytes rendered for that size — not just the header fields.
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < 4; i++) {
      const offset = headerSize + i * 20;
      const entryBytes = bytes.slice(offset, offset + 20);
      expect(Array.from(entryBytes)).toEqual(Array.from({ length: 20 }, () => 'x'.charCodeAt(0)));
    }
  });

  it('rejects when the image fails to load', async () => {
    const dom = createDom();
    mockImageLoad(dom.window, { shouldError: true });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/png-to-ico.js');

    const file = new dom.window.File([new Uint8Array(10)], 'logo.png', { type: 'image/png' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/failed to load image/i);
  });

  it('rejects when the browser fails to render one of the icon sizes', async () => {
    const dom = createDom();
    mockImageLoad(dom.window, { width: 64, height: 64 });
    dom.window.HTMLCanvasElement.prototype.getContext = function () {
      return { drawImage: function () {} };
    };
    dom.window.HTMLCanvasElement.prototype.toBlob = function (callback) {
      setTimeout(function () {
        callback(null);
      }, 0);
    };
    evalScript(dom, 'converters/png-to-ico.js');

    const file = new dom.window.File([new Uint8Array(10)], 'logo.png', { type: 'image/png' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/failed to render/i);
  });
});
