import { describe, expect, it } from 'vitest';
import { createDom, evalScript, mockCanvas, mockImageLoad } from './helpers.js';

describe('jpg-to-png.js — window.convertFile', () => {
  it('draws the source image and exports PNG with no background fill', async () => {
    const dom = createDom();
    mockImageLoad(dom.window, { width: 200, height: 150 });
    const { ctx, toBlobCalls } = mockCanvas(dom.window);
    evalScript(dom, 'converters/jpg-to-png.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/png');
    expect(toBlobCalls).toEqual([{ type: 'image/png', quality: undefined }]);
    expect(ctx.drawImage.mock.calls.length).toBe(1);
    // JPG has no alpha, so PNG output shouldn't have needed a white fill —
    // this converter should never call fillRect at all.
    expect(ctx.fillRect.mock.calls.length).toBe(0);
  });

  it('rejects when the image fails to load', async () => {
    const dom = createDom();
    mockImageLoad(dom.window, { shouldError: true });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/jpg-to-png.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/failed to load image/i);
  });
});
