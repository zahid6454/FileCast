import { describe, expect, it } from 'vitest';
import { createDom, evalScript, flush, mockCanvas, mockImageLoad } from './helpers.js';

function toolPage() {
  return createDom(`
    <div id="file-info" class="hidden">
      <img id="file-preview" class="hidden" alt="Preview">
    </div>
    <input type="file" id="file-input" hidden>
    <button id="reset-btn">Convert Another</button>
  `);
}

function selectFile(dom, file) {
  const input = dom.window.document.getElementById('file-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

// jsdom's getBoundingClientRect() returns an all-zero rect (no real layout
// engine), which makes canvasCoords()'s scale factor 1 and its offset 0 — so
// clientX/clientY map 1:1 onto canvas-local pixel coordinates, exactly what
// these tests want to control directly.
function firePointer(canvasEl, win, type, x, y) {
  canvasEl.dispatchEvent(new win.MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
}

describe('image-cropper.js — window.convertFile', () => {
  it('falls back to a centered 80% crop when called with no interactive session', async () => {
    const dom = createDom();
    mockImageLoad(dom.window, { width: 500, height: 400 });
    const { canvasSizes } = mockCanvas(dom.window);
    evalScript(dom, 'converters/image-cropper.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await dom.window.convertFile(file);

    // 80% of 500x400, centered: 400x320.
    expect(canvasSizes[canvasSizes.length - 1]).toEqual({ width: 400, height: 320 });
  });

  it('rejects with a load-failure message when the fallback image fails to load', async () => {
    const dom = createDom();
    mockImageLoad(dom.window, { shouldError: true });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/image-cropper.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/failed to load image/i);
  });

  it('builds an interactive crop overlay when a file is picked, and hides the plain preview', async () => {
    const dom = toolPage();
    mockImageLoad(dom.window, { width: 400, height: 300 });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/image-cropper.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    selectFile(dom, file);
    await flush();

    const container = dom.window.document.getElementById('image-cropper');
    expect(container).not.toBeNull();
    expect(container.classList.contains('hidden')).toBe(false);
    expect(dom.window.document.getElementById('file-preview').classList.contains('hidden')).toBe(
      true
    );
  });

  it('does not build a crop overlay for a non-image file', async () => {
    const dom = toolPage();
    evalScript(dom, 'converters/image-cropper.js');

    const file = new dom.window.File(['not an image'], 'notes.txt', { type: 'text/plain' });
    selectFile(dom, file);
    await flush();

    expect(dom.window.document.getElementById('image-cropper')).toBeNull();
  });

  it('reflects a drag-resized selection in the cropped output', async () => {
    const dom = toolPage();
    mockImageLoad(dom.window, { width: 400, height: 300 });
    const { ctx, canvasSizes } = mockCanvas(dom.window);
    evalScript(dom, 'converters/image-cropper.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    selectFile(dom, file);
    await flush();

    // Default selection on a 400x300 image (displayed 1:1, well under the
    // 640x480 cap) is the centered 80% box: x=40, y=30, w=320, h=240 — so
    // its bottom-right handle sits at (360, 270).
    const canvasEl = dom.window.document.querySelector('.image-cropper__canvas');
    firePointer(canvasEl, dom.window, 'pointerdown', 360, 270);
    firePointer(canvasEl, dom.window, 'pointermove', 400, 300); // drag the corner out by (40, 30)
    firePointer(canvasEl, dom.window, 'pointerup', 400, 300);

    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/jpeg');
    // The resized selection is now x=40, y=30, w=360, h=270.
    expect(canvasSizes[canvasSizes.length - 1]).toEqual({ width: 360, height: 270 });
    const lastDraw = ctx.drawImage.mock.calls[ctx.drawImage.mock.calls.length - 1];
    expect(lastDraw.slice(1)).toEqual([40, 30, 360, 270, 0, 0, 360, 270]);
  });

  it('sets TOOL_CONFIG.output_extension to match the input format', async () => {
    const dom = createDom();
    dom.window.TOOL_CONFIG = { id: 'image-cropper' };
    mockImageLoad(dom.window, { width: 200, height: 200 });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/image-cropper.js');

    const file = new dom.window.File([new Uint8Array(10)], 'graphic.png', { type: 'image/png' });
    await dom.window.convertFile(file);

    expect(dom.window.TOOL_CONFIG.output_extension).toBe('.png');
  });
});
