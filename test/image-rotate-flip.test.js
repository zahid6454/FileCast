import { describe, expect, it } from 'vitest';
import { createDom, evalScript, mockCanvas, mockImageLoad } from './helpers.js';

function toolPageWithOptions(rotateValue, flipValue) {
  return createDom(`
    <select id="opt-rotate"><option value="${rotateValue}" selected>x</option></select>
    <select id="opt-flip"><option value="${flipValue}" selected>x</option></select>
  `);
}

describe('image-rotate-flip.js — window.convertFile', () => {
  it('leaves canvas dimensions unchanged at 0° and 180°', async () => {
    const dom = toolPageWithOptions('180', 'none');
    mockImageLoad(dom.window, { width: 800, height: 600 });
    const { canvasSizes } = mockCanvas(dom.window);
    evalScript(dom, 'converters/image-rotate-flip.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await dom.window.convertFile(file);

    expect(canvasSizes[0]).toEqual({ width: 800, height: 600 });
  });

  it('swaps canvas width/height at 90° and 270°', async () => {
    const dom90 = toolPageWithOptions('90', 'none');
    mockImageLoad(dom90.window, { width: 800, height: 600 });
    let { canvasSizes } = mockCanvas(dom90.window);
    evalScript(dom90, 'converters/image-rotate-flip.js');
    let file = new dom90.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await dom90.window.convertFile(file);
    expect(canvasSizes[0]).toEqual({ width: 600, height: 800 });

    const dom270 = toolPageWithOptions('270', 'none');
    mockImageLoad(dom270.window, { width: 800, height: 600 });
    ({ canvasSizes } = mockCanvas(dom270.window));
    evalScript(dom270, 'converters/image-rotate-flip.js');
    file = new dom270.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await dom270.window.convertFile(file);
    expect(canvasSizes[0]).toEqual({ width: 600, height: 800 });
  });

  it('applies translate, rotate, and scale in that order before drawing', async () => {
    const dom = toolPageWithOptions('90', 'horizontal');
    mockImageLoad(dom.window, { width: 400, height: 200 });
    const { ctx } = mockCanvas(dom.window);
    evalScript(dom, 'converters/image-rotate-flip.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await dom.window.convertFile(file);

    expect(ctx.translate).toHaveBeenCalledWith(100, 200); // canvasW/2, canvasH/2 (swapped)
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(ctx.scale).toHaveBeenCalledWith(-1, 1); // horizontal flip
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), -200, -100, 400, 200);
  });

  it('keeps PNG transparency (no white fill) but flattens JPEG onto white', async () => {
    const dom = toolPageWithOptions('0', 'none');
    mockImageLoad(dom.window, { width: 100, height: 100 });
    let { ctx } = mockCanvas(dom.window);
    evalScript(dom, 'converters/image-rotate-flip.js');
    let file = new dom.window.File([new Uint8Array(10)], 'graphic.png', { type: 'image/png' });
    await dom.window.convertFile(file);
    expect(ctx.fillRect.mock.calls.length).toBe(0);

    const dom2 = toolPageWithOptions('0', 'none');
    mockImageLoad(dom2.window, { width: 100, height: 100 });
    ({ ctx } = mockCanvas(dom2.window));
    evalScript(dom2, 'converters/image-rotate-flip.js');
    file = new dom2.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await dom2.window.convertFile(file);
    expect(ctx.fillRect.mock.calls.length).toBe(1);
  });

  it('sets TOOL_CONFIG.output_extension to match the input format', async () => {
    const dom = toolPageWithOptions('0', 'none');
    dom.window.TOOL_CONFIG = { id: 'image-rotate-flip' };
    mockImageLoad(dom.window, { width: 100, height: 100 });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/image-rotate-flip.js');

    const file = new dom.window.File([new Uint8Array(10)], 'graphic.webp', { type: 'image/webp' });
    await dom.window.convertFile(file);

    expect(dom.window.TOOL_CONFIG.output_extension).toBe('.webp');
  });

  it('rejects with a load-failure message when the image fails to load', async () => {
    const dom = toolPageWithOptions('0', 'none');
    mockImageLoad(dom.window, { shouldError: true });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/image-rotate-flip.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/failed to load image/i);
  });
});
