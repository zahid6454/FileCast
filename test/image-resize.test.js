import { describe, expect, it } from 'vitest';
import { createDom, evalScript, mockCanvas, mockImageLoad } from './helpers.js';

function toolPageWithOptions(widthValue, heightValue) {
  return createDom(`
    <input id="opt-width" value="${widthValue}" />
    <input id="opt-height" value="${heightValue}" />
  `);
}

// Includes #tool-options so ensureUnitToggle() actually builds the px/%
// buttons — toolPageWithOptions() above omits it on purpose to also cover
// pages/tests with no options container (ensureUnitToggle() must no-op).
function toolPageWithUnitToggle(widthValue, heightValue) {
  return createDom(`
    <div id="tool-options">
      <input id="opt-width" value="${widthValue}" />
      <input id="opt-height" value="${heightValue}" />
    </div>
  `);
}

function clickPercentButton(dom) {
  dom.window.document
    .querySelector('.image-resizer__unit-group button[data-unit="percent"]')
    .click();
}

describe('image-resize.js — window.convertFile', () => {
  it('rejects when neither width nor height is given', async () => {
    const dom = toolPageWithOptions('', '');
    evalScript(dom, 'converters/image-resize.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/enter a width, height, or both/i);
  });

  it('derives the missing dimension from the aspect ratio when only width is given', async () => {
    const dom = toolPageWithOptions('400', '');
    mockImageLoad(dom.window, { width: 800, height: 600 }); // 4:3
    const { canvasSizes } = mockCanvas(dom.window);
    evalScript(dom, 'converters/image-resize.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await dom.window.convertFile(file);

    expect(canvasSizes[0]).toEqual({ width: 400, height: 300 }); // keeps 4:3
  });

  it('derives the missing dimension from the aspect ratio when only height is given', async () => {
    const dom = toolPageWithOptions('', '150');
    mockImageLoad(dom.window, { width: 800, height: 600 });
    const { canvasSizes } = mockCanvas(dom.window);
    evalScript(dom, 'converters/image-resize.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await dom.window.convertFile(file);

    expect(canvasSizes[0]).toEqual({ width: 200, height: 150 });
  });

  it('rejects when the derived dimension rounds down to zero', async () => {
    // A 1px-tall, 1000px-wide source scaled to a width of 1 derives a height
    // of round(1 * (1/1000)) = 0 — too small to produce a real image.
    const dom = toolPageWithOptions('1', '');
    mockImageLoad(dom.window, { width: 1000, height: 1 });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/image-resize.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/too small/i);
  });

  it('keeps PNG transparency (no white fill) but flattens JPEG onto white', async () => {
    const dom = toolPageWithOptions('100', '100');

    // PNG input: no fillRect.
    mockImageLoad(dom.window, { width: 200, height: 200 });
    let { ctx } = mockCanvas(dom.window);
    evalScript(dom, 'converters/image-resize.js');
    let file = new dom.window.File([new Uint8Array(10)], 'graphic.png', { type: 'image/png' });
    await dom.window.convertFile(file);
    expect(ctx.fillRect.mock.calls.length).toBe(0);

    // JPEG input: fillRect white background first.
    const dom2 = toolPageWithOptions('100', '100');
    mockImageLoad(dom2.window, { width: 200, height: 200 });
    ({ ctx } = mockCanvas(dom2.window));
    evalScript(dom2, 'converters/image-resize.js');
    file = new dom2.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await dom2.window.convertFile(file);
    expect(ctx.fillRect.mock.calls.length).toBe(1);
  });

  it('sets TOOL_CONFIG.output_extension to match the input format', async () => {
    const dom = toolPageWithOptions('100', '100');
    dom.window.TOOL_CONFIG = { id: 'image-resize' };
    mockImageLoad(dom.window, { width: 200, height: 200 });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/image-resize.js');

    const file = new dom.window.File([new Uint8Array(10)], 'graphic.webp', { type: 'image/webp' });
    await dom.window.convertFile(file);

    expect(dom.window.TOOL_CONFIG.output_extension).toBe('.webp');
  });
});

describe('image-resize.js — px/% unit toggle', () => {
  it('resolves a percent width against the source image, deriving height from the ratio', async () => {
    const dom = toolPageWithUnitToggle('50', '');
    mockImageLoad(dom.window, { width: 800, height: 600 }); // 4:3
    const { canvasSizes } = mockCanvas(dom.window);
    evalScript(dom, 'converters/image-resize.js');

    clickPercentButton(dom);
    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await dom.window.convertFile(file);

    expect(canvasSizes[0]).toEqual({ width: 400, height: 300 });
  });

  it('scales both dimensions by the same percent when both are given', async () => {
    const dom = toolPageWithUnitToggle('50', '50');
    mockImageLoad(dom.window, { width: 800, height: 600 });
    const { canvasSizes } = mockCanvas(dom.window);
    evalScript(dom, 'converters/image-resize.js');

    clickPercentButton(dom);
    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await dom.window.convertFile(file);

    expect(canvasSizes[0]).toEqual({ width: 400, height: 300 });
  });

  it('does not build the toggle when the page has no #tool-options container', async () => {
    const dom = toolPageWithOptions('400', '');
    mockImageLoad(dom.window, { width: 800, height: 600 });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/image-resize.js');

    expect(dom.window.document.querySelector('.image-resizer__unit-group')).toBeNull();
  });
});
