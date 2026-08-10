import { describe, expect, it } from 'vitest';
import { createDom, evalScript, mockCanvas, mockImageLoad } from './helpers.js';

describe('webp-to-png.js — window.convertFile', () => {
  it('draws the source image and exports PNG, preserving transparency', async () => {
    const dom = createDom();
    mockImageLoad(dom.window, { width: 200, height: 150 });
    const { ctx, toBlobCalls } = mockCanvas(dom.window);
    evalScript(dom, 'converters/webp-to-png.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.webp', { type: 'image/webp' });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/png');
    expect(toBlobCalls).toEqual([{ type: 'image/png', quality: undefined }]);
    // WebP alpha must survive into PNG, so no white-fill flattening here.
    expect(ctx.fillRect.mock.calls.length).toBe(0);
    expect(ctx.drawImage.mock.calls.length).toBe(1);
  });

  it('rejects when the image fails to load', async () => {
    const dom = createDom();
    mockImageLoad(dom.window, { shouldError: true });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/webp-to-png.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.webp', { type: 'image/webp' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/failed to load image/i);
  });
});
