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

  it('moves the selection without resizing it when dragging inside the box', async () => {
    const dom = toolPage();
    mockImageLoad(dom.window, { width: 400, height: 300 });
    const { ctx, canvasSizes } = mockCanvas(dom.window);
    evalScript(dom, 'converters/image-cropper.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    selectFile(dom, file);
    await flush();

    const canvasEl = dom.window.document.querySelector('.image-cropper__canvas');
    // Default selection is x=40, y=30, w=320, h=240 — (100, 100) is well inside it.
    firePointer(canvasEl, dom.window, 'pointerdown', 100, 100);
    firePointer(canvasEl, dom.window, 'pointermove', 120, 115); // +20, +15
    firePointer(canvasEl, dom.window, 'pointerup', 120, 115);

    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/jpeg');
    // Size is unchanged (320x240) — only the position moved.
    expect(canvasSizes[canvasSizes.length - 1]).toEqual({ width: 320, height: 240 });
    const lastDraw = ctx.drawImage.mock.calls[ctx.drawImage.mock.calls.length - 1];
    expect(lastDraw.slice(1)).toEqual([60, 45, 320, 240, 0, 0, 320, 240]);
  });

  it('clamps a resize to the minimum crop size instead of collapsing to zero', async () => {
    const dom = toolPage();
    mockImageLoad(dom.window, { width: 400, height: 300 });
    const { canvasSizes } = mockCanvas(dom.window);
    evalScript(dom, 'converters/image-cropper.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    selectFile(dom, file);
    await flush();

    const canvasEl = dom.window.document.querySelector('.image-cropper__canvas');
    // Default bottom-right handle is at (360, 270) — drag it all the way past the opposite corner.
    firePointer(canvasEl, dom.window, 'pointerdown', 360, 270);
    firePointer(canvasEl, dom.window, 'pointermove', 0, 0);
    firePointer(canvasEl, dom.window, 'pointerup', 0, 0);

    await dom.window.convertFile(file);

    expect(canvasSizes[canvasSizes.length - 1]).toEqual({ width: 20, height: 20 });
  });

  it('ignores a slower, superseded image load when a second file is picked before the first resolves', async () => {
    const dom = toolPage();
    mockCanvas(dom.window);

    // A custom Image mock that never auto-fires onload — this test fires the
    // two pending loads manually, out of pick order, to reproduce image A
    // (picked first) resolving AFTER image B (picked second).
    const pending = [];
    dom.window.Image = function () {
      const img = { onload: null, onerror: null, naturalWidth: 0, naturalHeight: 0 };
      let src = '';
      Object.defineProperty(img, 'src', {
        get: () => src,
        set: (v) => {
          src = v;
          pending.push(img);
        }
      });
      return img;
    };
    evalScript(dom, 'converters/image-cropper.js');

    const fileA = new dom.window.File([new Uint8Array(10)], 'slow.jpg', { type: 'image/jpeg' });
    const fileB = new dom.window.File([new Uint8Array(10)], 'fast.jpg', { type: 'image/jpeg' });

    selectFile(dom, fileA); // starts loading A
    selectFile(dom, fileB); // starts loading B before A resolves
    expect(pending.length).toBe(2);

    // B (picked second) resolves first...
    pending[1].naturalWidth = 200;
    pending[1].naturalHeight = 100;
    pending[1].onload();

    // ...then A (picked first, but slower) resolves late. Without the
    // pendingFile guard, this would silently overwrite the session built for
    // B — while shared.js's own file-name display still shows "fast.jpg".
    pending[0].naturalWidth = 900;
    pending[0].naturalHeight = 900;
    pending[0].onload();

    const canvasEl = dom.window.document.querySelector('.image-cropper__canvas');
    expect(canvasEl.width).toBe(200);
    expect(canvasEl.height).toBe(100);
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

  it('shows the live output resolution for the default selection', async () => {
    const dom = toolPage();
    mockImageLoad(dom.window, { width: 400, height: 300 });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/image-cropper.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    selectFile(dom, file);
    await flush();

    // Default selection on a 400x300 image is the centered 80% box: 320x240.
    expect(dom.window.document.querySelector('.image-cropper__dims').textContent).toBe(
      '320 × 240 px'
    );
  });

  it('resizes only the dragged side when dragging an edge, not a corner', async () => {
    const dom = toolPage();
    mockImageLoad(dom.window, { width: 400, height: 300 });
    const { ctx, canvasSizes } = mockCanvas(dom.window);
    evalScript(dom, 'converters/image-cropper.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    selectFile(dom, file);
    await flush();

    // Default selection x=40,y=30,w=320,h=240 -> right edge midpoint is (360, 150).
    const canvasEl = dom.window.document.querySelector('.image-cropper__canvas');
    firePointer(canvasEl, dom.window, 'pointerdown', 360, 150);
    firePointer(canvasEl, dom.window, 'pointermove', 400, 150); // drag the right edge out by 40
    firePointer(canvasEl, dom.window, 'pointerup', 400, 150);

    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/jpeg');
    // Width grows to 360 (40..400); height is untouched at 240.
    expect(canvasSizes[canvasSizes.length - 1]).toEqual({ width: 360, height: 240 });
    const lastDraw = ctx.drawImage.mock.calls[ctx.drawImage.mock.calls.length - 1];
    expect(lastDraw.slice(1)).toEqual([40, 30, 360, 240, 0, 0, 360, 240]);
  });

  it('reflects each zone under the pointer in the canvas cursor, without dragging', async () => {
    const dom = toolPage();
    mockImageLoad(dom.window, { width: 400, height: 300 });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/image-cropper.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    selectFile(dom, file);
    await flush();

    // Default selection: tl(40,30) tr(360,30) bl(40,270) br(360,270).
    const canvasEl = dom.window.document.querySelector('.image-cropper__canvas');
    const cursorAt = (x, y) => {
      firePointer(canvasEl, dom.window, 'pointermove', x, y);
      return canvasEl.style.cursor;
    };

    expect(cursorAt(360, 150)).toBe('ew-resize'); // right edge midpoint
    expect(cursorAt(200, 30)).toBe('ns-resize'); // top edge midpoint
    expect(cursorAt(360, 270)).toBe('nwse-resize'); // br corner
    expect(cursorAt(40, 30)).toBe('nwse-resize'); // tl corner
    expect(cursorAt(200, 150)).toBe('move'); // inside
    expect(cursorAt(5, 5)).toBe('default'); // outside the box entirely
  });

  it('reshapes the selection to a locked ratio and keeps it locked through a corner drag', async () => {
    const dom = toolPage();
    mockImageLoad(dom.window, { width: 400, height: 300 });
    const { ctx, canvasSizes } = mockCanvas(dom.window);
    evalScript(dom, 'converters/image-cropper.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    selectFile(dom, file);
    await flush();

    const ratioBtn = Array.from(
      dom.window.document.querySelectorAll('.image-cropper__ratio-btn')
    ).find((b) => b.textContent === '1:1');
    ratioBtn.click();

    expect(ratioBtn.className).toContain('is-active');
    // 80% of the 400x300 canvas, square-capped by height: 240x240, centered -> x=80,y=30.
    expect(dom.window.document.querySelector('.image-cropper__dims').textContent).toBe(
      '240 × 240 px'
    );

    // Drag the br corner (80+240, 30+240) = (320, 270) mostly horizontally —
    // a non-diagonal drag that would break aspect if the lock weren't applied.
    const canvasEl = dom.window.document.querySelector('.image-cropper__canvas');
    firePointer(canvasEl, dom.window, 'pointerdown', 320, 270);
    firePointer(canvasEl, dom.window, 'pointermove', 400, 280);
    firePointer(canvasEl, dom.window, 'pointerup', 400, 280);

    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/jpeg');
    const finalSize = canvasSizes[canvasSizes.length - 1];
    expect(finalSize.width).toBe(finalSize.height); // still square after a non-diagonal drag
    expect(finalSize).toEqual({ width: 270, height: 270 });
    const lastDraw = ctx.drawImage.mock.calls[ctx.drawImage.mock.calls.length - 1];
    expect(lastDraw.slice(1)).toEqual([80, 30, 270, 270, 0, 0, 270, 270]);
  });

  it('keeps an aspect-locked resize on-canvas when dragged past its own anchor near an edge', async () => {
    const dom = toolPage();
    mockImageLoad(dom.window, { width: 400, height: 300 });
    const { ctx, canvasSizes } = mockCanvas(dom.window);
    evalScript(dom, 'converters/image-cropper.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    selectFile(dom, file);
    await flush();

    const ratioBtn = Array.from(
      dom.window.document.querySelectorAll('.image-cropper__ratio-btn')
    ).find((b) => b.textContent === '1:1');
    ratioBtn.click(); // rect -> x=80,y=30,w=240,h=240

    const canvasEl = dom.window.document.querySelector('.image-cropper__canvas');
    // Move the box so its left edge sits close to the canvas edge (x=5) —
    // drag from its center, (200,150), left by 75.
    firePointer(canvasEl, dom.window, 'pointerdown', 200, 150);
    firePointer(canvasEl, dom.window, 'pointermove', 125, 150);
    firePointer(canvasEl, dom.window, 'pointerup', 125, 150);
    // rect is now x=5,y=30,w=240,h=240 — its right edge sits at 245.

    // Grab the (now-fixed) right-edge handle and overshoot the drag past
    // the left anchor (x=5) and past the canvas's own left edge (x=0) —
    // an easy mouse overshoot. Before the fix this pushed rect.x negative.
    firePointer(canvasEl, dom.window, 'pointerdown', 245, 150);
    firePointer(canvasEl, dom.window, 'pointermove', -5, 150);
    firePointer(canvasEl, dom.window, 'pointerup', -5, 150);

    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/jpeg');
    const finalSize = canvasSizes[canvasSizes.length - 1];
    expect(finalSize.width).toBe(finalSize.height); // aspect still locked
    expect(finalSize).toEqual({ width: 20, height: 20 });
    const lastDraw = ctx.drawImage.mock.calls[ctx.drawImage.mock.calls.length - 1];
    const [sx, sy, sw, sh] = lastDraw.slice(1);
    // The source rect stays entirely within the 400x300 canvas — the bug
    // let sx go negative here (an off-canvas source region silently
    // rendering blank in the exported crop).
    expect(sx).toBeGreaterThanOrEqual(0);
    expect(sy).toBeGreaterThanOrEqual(0);
    expect(sx + sw).toBeLessThanOrEqual(400);
    expect(sy + sh).toBeLessThanOrEqual(300);
  });

  it('keeps an aspect-locked corner drag at least MIN_SIZE near a canvas corner', async () => {
    const dom = toolPage();
    mockImageLoad(dom.window, { width: 400, height: 300 });
    const { ctx, canvasSizes } = mockCanvas(dom.window);
    evalScript(dom, 'converters/image-cropper.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    selectFile(dom, file);
    await flush();

    const ratioBtn = Array.from(
      dom.window.document.querySelectorAll('.image-cropper__ratio-btn')
    ).find((b) => b.textContent === '1:1');
    ratioBtn.click(); // rect -> x=80,y=30,w=240,h=240

    const canvasEl = dom.window.document.querySelector('.image-cropper__canvas');
    // Move the box so its left edge sits close to the canvas edge (x=5),
    // same setup as the edge-drag regression above.
    firePointer(canvasEl, dom.window, 'pointerdown', 200, 150);
    firePointer(canvasEl, dom.window, 'pointermove', 125, 150);
    firePointer(canvasEl, dom.window, 'pointerup', 125, 150);
    // rect is now x=5,y=30,w=240,h=240 -> tr handle sits at (245, 30).

    // Grab the top-right CORNER handle and drag it down-and-left, mostly
    // vertically, overshooting past its own anchor (the bl corner, at
    // x=5) and the canvas's left edge. The corner branch picks the
    // height-driven case here, caps w against the tiny room left of the
    // anchor, then re-derives h from that capped w — before the fix,
    // that final cap wasn't floored at MIN_SIZE and collapsed the box to
    // 5x5 instead of the required minimum 20x20.
    firePointer(canvasEl, dom.window, 'pointerdown', 245, 30);
    firePointer(canvasEl, dom.window, 'pointermove', 0, 150);
    firePointer(canvasEl, dom.window, 'pointerup', 0, 150);

    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/jpeg');
    const finalSize = canvasSizes[canvasSizes.length - 1];
    expect(finalSize.width).toBe(finalSize.height); // aspect still locked
    expect(finalSize).toEqual({ width: 20, height: 20 }); // floored at MIN_SIZE, not collapsed
    const lastDraw = ctx.drawImage.mock.calls[ctx.drawImage.mock.calls.length - 1];
    const [sx, sy, sw, sh] = lastDraw.slice(1);
    expect(sx).toBeGreaterThanOrEqual(0);
    expect(sy).toBeGreaterThanOrEqual(0);
    expect(sx + sw).toBeLessThanOrEqual(400);
    expect(sy + sh).toBeLessThanOrEqual(300);
  });

  it('zooming in and back out does not change the selected output region', async () => {
    const dom = toolPage();
    mockImageLoad(dom.window, { width: 400, height: 300 });
    const { canvasSizes } = mockCanvas(dom.window);
    evalScript(dom, 'converters/image-cropper.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    selectFile(dom, file);
    await flush();

    const zoomInBtn = dom.window.document.querySelector(
      '.image-cropper__zoom-btn[aria-label="Zoom in"]'
    );
    const zoomOutBtn = dom.window.document.querySelector(
      '.image-cropper__zoom-btn[aria-label="Zoom out"]'
    );
    const zoomLabel = dom.window.document.querySelector('.image-cropper__zoom-label');

    expect(zoomOutBtn.disabled).toBe(true); // already at the 100% floor
    expect(zoomLabel.textContent).toBe('100%');

    zoomInBtn.click();

    expect(zoomLabel.textContent).toBe('125%');
    expect(zoomOutBtn.disabled).toBe(false);
    // The zoomed display canvas grows (400x300 * 1.25 = 500x375)...
    const canvasEl = dom.window.document.querySelector('.image-cropper__canvas');
    expect(canvasEl.width).toBe(500);
    expect(canvasEl.height).toBe(375);
    // ...but the selected region is the same image content, so the cropped
    // output is unchanged: still 320x240, the default 80% selection.
    expect(dom.window.document.querySelector('.image-cropper__dims').textContent).toBe(
      '320 × 240 px'
    );

    zoomOutBtn.click(); // back to 100%

    expect(zoomLabel.textContent).toBe('100%');
    expect(zoomOutBtn.disabled).toBe(true);
    expect(canvasEl.width).toBe(400);
    expect(canvasEl.height).toBe(300);
    expect(dom.window.document.querySelector('.image-cropper__dims').textContent).toBe(
      '320 × 240 px'
    );

    const blob = await dom.window.convertFile(file);
    expect(blob.type).toBe('image/jpeg');
    expect(canvasSizes[canvasSizes.length - 1]).toEqual({ width: 320, height: 240 });
  });
});
