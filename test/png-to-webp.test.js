import { describe, expect, it } from 'vitest';
import { createDom, evalScript, mockCanvas, mockImageLoad } from './helpers.js';

describe('png-to-webp.js — window.convertFile', () => {
  it('draws the source image and exports WebP, preserving transparency', async () => {
    const dom = createDom();
    mockImageLoad(dom.window, { width: 200, height: 150 });
    const { ctx, toBlobCalls } = mockCanvas(dom.window);
    evalScript(dom, 'converters/png-to-webp.js');

    const file = new dom.window.File([new Uint8Array(10)], 'graphic.png', { type: 'image/png' });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/webp');
    expect(toBlobCalls).toEqual([{ type: 'image/webp', quality: 0.9 }]);
    // WebP supports alpha, so PNG transparency must not be flattened to white.
    expect(ctx.fillRect.mock.calls.length).toBe(0);
    expect(ctx.drawImage.mock.calls.length).toBe(1);
  });

  it('rejects with a WebP-support hint when toBlob returns no blob', async () => {
    const dom = createDom();
    mockImageLoad(dom.window, { width: 200, height: 150 });
    mockCanvas(dom.window);
    dom.window.HTMLCanvasElement.prototype.toBlob = (callback) => callback(null);
    evalScript(dom, 'converters/png-to-webp.js');

    const file = new dom.window.File([new Uint8Array(10)], 'graphic.png', { type: 'image/png' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/may not support webp export/i);
  });

  it('rejects when the image fails to load', async () => {
    const dom = createDom();
    mockImageLoad(dom.window, { shouldError: true });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/png-to-webp.js');

    const file = new dom.window.File([new Uint8Array(10)], 'graphic.png', { type: 'image/png' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/failed to load image/i);
  });
});
