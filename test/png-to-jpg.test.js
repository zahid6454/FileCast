import { describe, expect, it } from 'vitest';
import { createDom, evalScript, mockCanvas, mockImageLoad } from './helpers.js';

describe('png-to-jpg.js — window.convertFile', () => {
  it('fills a white background then draws the image and exports JPEG', async () => {
    const dom = createDom();
    mockImageLoad(dom.window, { width: 200, height: 150 });
    const { ctx, toBlobCalls } = mockCanvas(dom.window);
    evalScript(dom, 'converters/png-to-jpg.js');

    const file = new dom.window.File([new Uint8Array(10)], 'graphic.png', { type: 'image/png' });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/jpeg');
    expect(toBlobCalls).toEqual([{ type: 'image/jpeg', quality: 0.92 }]);
    // PNG transparency must be flattened onto white before JPEG (no alpha).
    expect(ctx.fillRect.mock.calls.length).toBe(1);
    expect(ctx.drawImage.mock.calls.length).toBe(1);
  });

  it('rejects when the image fails to load', async () => {
    const dom = createDom();
    mockImageLoad(dom.window, { shouldError: true });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/png-to-jpg.js');

    const file = new dom.window.File([new Uint8Array(10)], 'graphic.png', { type: 'image/png' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/failed to load image/i);
  });
});
