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
    expect(view.getUint8(6)).toBe(16);
    expect(view.getUint8(6 + 16)).toBe(32);
    expect(view.getUint8(6 + 32)).toBe(48);
    expect(view.getUint8(6 + 48)).toBe(0);
  });

  it('rejects when the image fails to load', async () => {
    const dom = createDom();
    mockImageLoad(dom.window, { shouldError: true });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/png-to-ico.js');

    const file = new dom.window.File([new Uint8Array(10)], 'logo.png', { type: 'image/png' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/failed to load image/i);
  });
});
