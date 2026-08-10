import { describe, expect, it } from 'vitest';
import { createDom, evalScript, mockCanvas, mockImageLoad } from './helpers.js';

describe('svg-to-png.js — window.convertFile', () => {
  it('reads the SVG as text, renders it, and exports PNG', async () => {
    const dom = createDom();
    mockImageLoad(dom.window, { width: 300, height: 200 });
    const { ctx, toBlobCalls } = mockCanvas(dom.window);
    evalScript(dom, 'converters/svg-to-png.js');

    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"></svg>';
    const file = new dom.window.File([svg], 'icon.svg', { type: 'image/svg+xml' });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/png');
    expect(toBlobCalls).toEqual([{ type: 'image/png', quality: undefined }]);
    expect(ctx.drawImage.mock.calls.length).toBe(1);
  });

  it('falls back to a 1024x1024 canvas when the SVG has no intrinsic size', async () => {
    const dom = createDom();
    mockImageLoad(dom.window, { width: 0, height: 0 });
    const { ctx } = mockCanvas(dom.window);
    evalScript(dom, 'converters/svg-to-png.js');

    const file = new dom.window.File(
      ['<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
      'icon.svg',
      {
        type: 'image/svg+xml'
      }
    );
    await dom.window.convertFile(file);

    expect(ctx.drawImage.mock.calls[0]).toEqual([expect.anything(), 0, 0, 1024, 1024]);
  });

  it('rejects with a render-failure message when the image fails to load', async () => {
    const dom = createDom();
    mockImageLoad(dom.window, { shouldError: true });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/svg-to-png.js');

    const file = new dom.window.File(
      ['<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
      'icon.svg',
      {
        type: 'image/svg+xml'
      }
    );
    await expect(dom.window.convertFile(file)).rejects.toThrow(/unsupported features/i);
  });
});
