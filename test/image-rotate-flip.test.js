import { describe, expect, it } from 'vitest';
import { createDom, evalScript, flush, mockCanvas, mockImageLoad } from './helpers.js';

function toolPageWithOptions(rotateValue, flipValue) {
  return createDom(`
    <select id="opt-rotate"><option value="${rotateValue}" selected>x</option></select>
    <select id="opt-flip"><option value="${flipValue}" selected>x</option></select>
  `);
}

// Full page markup, mirroring templates/tool.html's #upload-zone/#file-input/
// #file-info/select/reset-btn structure — needed for the live-preview tests
// below, which drive file selection the way a real page would (change/drop/
// paste) rather than calling window.convertFile(file) directly.
function toolPage() {
  return createDom(`
    <div id="upload-zone"></div>
    <input type="file" id="file-input" hidden>
    <div id="file-info" class="hidden">
      <img id="file-preview" class="hidden" alt="Preview">
    </div>
    <select id="opt-rotate">
      <option value="0" selected>No rotation</option>
      <option value="90">90° clockwise</option>
      <option value="180">180°</option>
      <option value="270">270° clockwise</option>
    </select>
    <select id="opt-flip">
      <option value="none" selected>No flip</option>
      <option value="horizontal">Horizontal</option>
      <option value="vertical">Vertical</option>
    </select>
    <button id="reset-btn">Convert Another</button>
  `);
}

function selectFile(dom, file) {
  const input = dom.window.document.getElementById('file-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
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

describe('image-rotate-flip.js — live preview', () => {
  it('builds a live preview canvas when a file is picked, and hides the plain preview img', async () => {
    const dom = toolPage();
    mockImageLoad(dom.window, { width: 400, height: 300 });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/image-rotate-flip.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    selectFile(dom, file);
    await flush();

    const container = dom.window.document.getElementById('image-rotate-flip');
    expect(container).not.toBeNull();
    expect(container.classList.contains('hidden')).toBe(false);
    expect(dom.window.document.getElementById('file-preview').classList.contains('hidden')).toBe(
      true
    );
    expect(
      dom.window.document.querySelector('.image-rotate-flip__canvas').getAttribute('aria-label')
    ).toBeTruthy();
  });

  it('does not build a preview for a non-image file', async () => {
    const dom = toolPage();
    evalScript(dom, 'converters/image-rotate-flip.js');

    const file = new dom.window.File(['not an image'], 'notes.txt', { type: 'text/plain' });
    selectFile(dom, file);
    await flush();

    expect(dom.window.document.getElementById('image-rotate-flip')).toBeNull();
  });

  it('builds the preview from a drag-and-drop file selection, not just #file-input change', async () => {
    const dom = toolPage();
    mockImageLoad(dom.window, { width: 400, height: 300 });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/image-rotate-flip.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    const dropEvent = new dom.window.Event('drop', { bubbles: true, cancelable: true });
    dropEvent.dataTransfer = { files: [file] };
    dom.window.document.getElementById('upload-zone').dispatchEvent(dropEvent);
    await flush();

    const container = dom.window.document.getElementById('image-rotate-flip');
    expect(container).not.toBeNull();
    expect(container.classList.contains('hidden')).toBe(false);
  });

  it('builds the preview from a clipboard paste', async () => {
    const dom = toolPage();
    mockImageLoad(dom.window, { width: 400, height: 300 });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/image-rotate-flip.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    const pasteEvent = new dom.window.Event('paste', { bubbles: true, cancelable: true });
    pasteEvent.clipboardData = {
      items: [{ kind: 'file', type: 'image/jpeg', getAsFile: () => file }]
    };
    dom.window.document.dispatchEvent(pasteEvent);
    await flush();

    const container = dom.window.document.getElementById('image-rotate-flip');
    expect(container).not.toBeNull();
    expect(container.classList.contains('hidden')).toBe(false);
  });

  it('ignores a clipboard paste when the target is an editable field', async () => {
    const dom = toolPage();
    evalScript(dom, 'converters/image-rotate-flip.js');

    const textarea = dom.window.document.createElement('textarea');
    dom.window.document.body.appendChild(textarea);
    textarea.focus();

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    const pasteEvent = new dom.window.Event('paste', { bubbles: true, cancelable: true });
    pasteEvent.clipboardData = {
      items: [{ kind: 'file', type: 'image/jpeg', getAsFile: () => file }]
    };
    dom.window.document.dispatchEvent(pasteEvent);
    await flush();

    expect(dom.window.document.getElementById('image-rotate-flip')).toBeNull();
  });

  it('re-renders the preview live when the Rotate/Flip dropdowns change', async () => {
    const dom = toolPage();
    mockImageLoad(dom.window, { width: 400, height: 300 });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/image-rotate-flip.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    selectFile(dom, file);
    await flush();

    const dimsEl = dom.window.document.querySelector('.image-rotate-flip__dims');
    const canvasEl = dom.window.document.querySelector('.image-rotate-flip__canvas');
    expect(dimsEl.textContent).toBe('400 × 300 px');
    expect(canvasEl.width).toBe(400);
    expect(canvasEl.height).toBe(300);

    const rotateSelect = dom.window.document.getElementById('opt-rotate');
    rotateSelect.value = '90';
    rotateSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    // A 90° rotation swaps the reported output dims and the display canvas.
    expect(dimsEl.textContent).toBe('300 × 400 px');
    expect(canvasEl.width).toBe(300);
    expect(canvasEl.height).toBe(400);
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
    evalScript(dom, 'converters/image-rotate-flip.js');

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

    const canvasEl = dom.window.document.querySelector('.image-rotate-flip__canvas');
    expect(canvasEl.width).toBe(200);
    expect(canvasEl.height).toBe(100);
  });

  it("reuses the preview session's decoded image in convertFile instead of decoding it again", async () => {
    const dom = toolPage();
    mockCanvas(dom.window);

    let imageConstructCount = 0;
    dom.window.Image = function () {
      imageConstructCount++;
      const img = { onload: null, onerror: null, naturalWidth: 0, naturalHeight: 0 };
      let src = '';
      Object.defineProperty(img, 'src', {
        get: () => src,
        set: (v) => {
          src = v;
          setTimeout(() => {
            img.naturalWidth = 400;
            img.naturalHeight = 300;
            if (img.onload) img.onload();
          }, 0);
        }
      });
      return img;
    };
    evalScript(dom, 'converters/image-rotate-flip.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    selectFile(dom, file);
    await flush();
    expect(imageConstructCount).toBe(1);

    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/jpeg');
    expect(imageConstructCount).toBe(1); // no second decode — convertFile reused session.img
  });

  it('hides the preview when Convert Another is clicked', async () => {
    const dom = toolPage();
    mockImageLoad(dom.window, { width: 400, height: 300 });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/image-rotate-flip.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    selectFile(dom, file);
    await flush();

    const container = dom.window.document.getElementById('image-rotate-flip');
    expect(container.classList.contains('hidden')).toBe(false);

    dom.window.document.getElementById('reset-btn').click();

    expect(container.classList.contains('hidden')).toBe(true);
  });
});
