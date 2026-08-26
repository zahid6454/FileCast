import { describe, expect, it, vi } from 'vitest';
import { createDom, evalScript, flush, mockCanvas } from './helpers.js';

// shared-page-proof.js (Tool Preview/Interaction Redesign §8-10) mirrors
// pdf-lib-worker.js's watermark()/pageNumbers() x/y math by hand so the live
// overlay matches what the worker actually draws — exactly the class of bug
// (coordinate math silently wrong) shared-page-grid.js's rotation preview
// shipped with. This file had no test coverage before this one.

function pageProofHtml(mode) {
  var options =
    mode === 'watermark'
      ? `
        <input id="opt-text" value="AB" />
        <input id="opt-opacity" value="30" />
        <input id="opt-fontSize" value="40" />
        <input id="opt-angle" value="45" />
      `
      : `
        <select id="opt-position">
          <option value="top-left" selected>Top left</option>
          <option value="bottom-center">Bottom center</option>
        </select>
        <input id="opt-startNumber" value="1" />
        <select id="opt-format">
          <option value="n" selected>N</option>
          <option value="page-of-total">Page N of total</option>
        </select>
      `;
  return `
    <div id="file-info"></div>
    <input id="file-input" type="file" />
    <button id="reset-btn"></button>
    ${options}
  `;
}

// Stands in for pdf-render-worker.js: 'load' replies with a fixed page count,
// 'render' replies with a fixed bitmap/page size so the scale factor
// (bitmap.width / pageWidthPt) works out to a clean 2x.
function mockRenderWorker(win, { pageCount = 3 } = {}) {
  win.Worker = function () {
    var worker = { onmessage: null, onerror: null, terminate: vi.fn() };
    worker.postMessage = function (msg) {
      if (msg.op === 'load') {
        setTimeout(function () {
          if (worker.onmessage) {
            worker.onmessage({ data: { ok: true, type: 'loaded', pageCount: pageCount } });
          }
        }, 0);
      } else if (msg.op === 'render') {
        setTimeout(function () {
          if (worker.onmessage) {
            worker.onmessage({
              data: {
                ok: true,
                type: 'rendered',
                requestId: msg.requestId,
                pageIndex: msg.pageIndex,
                bitmap: { width: 200, height: 280, close: vi.fn() },
                pageWidthPt: 100,
                pageHeightPt: 140
              }
            });
          }
        }, 0);
      }
    };
    return worker;
  };
}

async function setupProof(dom, mode) {
  mockRenderWorker(dom.window, { pageCount: 3 });
  var { ctx } = mockCanvas(dom.window);
  // measureText isn't part of the shared canvas mock — a fixed
  // characters-times-10 width is all this needs to make the position math
  // reproducible without depending on real font metrics.
  ctx.measureText = vi.fn((text) => ({ width: text.length * 10 }));
  ctx.fillText = vi.fn();

  dom.window.TOOL_CONFIG = {
    pdf_src: '/lib/pdf.min.js',
    pdf_render_worker_src: '/js/workers/pdf-render-worker.js'
  };
  evalScript(dom, 'shared-page-proof.js');
  dom.window.FCPageProof.init({ mode: mode });

  const input = dom.window.document.getElementById('file-input');
  const file = new dom.window.File([new Uint8Array(10)], 'doc.pdf', { type: 'application/pdf' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await flush();

  return ctx;
}

describe('shared-page-proof.js — watermark overlay math', () => {
  it('centers the text at the page midpoint and rotates -45deg, mirroring watermark()', async () => {
    const dom = createDom(pageProofHtml('watermark'));
    const ctx = await setupProof(dom, 'watermark');

    // pageWidthPt=100, pageHeightPt=140, bitmap width=200 -> scale=2.
    // measureText('AB')=20 -> textWidthPt=10 -> xPt=50-5=45 -> xPx=90.
    // yPt=70 -> yPx=(140-70)*2=140.
    expect(ctx.translate).toHaveBeenCalledWith(90, 140);
    expect(ctx.rotate).toHaveBeenCalledWith((-45 * Math.PI) / 180);
    expect(ctx.fillText).toHaveBeenLastCalledWith('AB', 0, 0);
  });

  it('re-renders live as the text/opacity/fontSize inputs change', async () => {
    const dom = createDom(pageProofHtml('watermark'));
    const ctx = await setupProof(dom, 'watermark');

    const textEl = dom.window.document.getElementById('opt-text');
    textEl.value = 'CONFIDENTIAL';
    textEl.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    expect(ctx.fillText).toHaveBeenLastCalledWith(
      'CONFIDENTIAL',
      expect.any(Number),
      expect.any(Number)
    );
  });

  it('draws nothing for blank watermark text', async () => {
    const dom = createDom(pageProofHtml('watermark'));
    const ctx = await setupProof(dom, 'watermark');
    ctx.fillText.mockClear();

    const textEl = dom.window.document.getElementById('opt-text');
    textEl.value = '   ';
    textEl.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('reacts live to a custom #opt-angle value', async () => {
    const dom = createDom(pageProofHtml('watermark'));
    const ctx = await setupProof(dom, 'watermark');

    const angleEl = dom.window.document.getElementById('opt-angle');
    angleEl.value = '90';
    angleEl.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    expect(ctx.rotate).toHaveBeenLastCalledWith((-90 * Math.PI) / 180);
  });
});

describe('shared-page-proof.js — watermark drag-to-position', () => {
  it('updates getWatermarkPosition() and redraws at the dragged coordinates on pointerdown', async () => {
    const dom = createDom(pageProofHtml('watermark'));
    const ctx = await setupProof(dom, 'watermark');

    const canvasEl = dom.window.document.querySelector('.page-proof__canvas');
    // jsdom's default getBoundingClientRect() returns an all-zero rect, which
    // would divide-by-zero the pointer-to-percent math — stub a real box.
    // canvas.width=200 (bitmap width from mockRenderWorker) over a 100px CSS
    // box -> scaleX=2; canvas.height=280 over a 140px CSS box -> scaleY=2.
    canvasEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 140 });

    const initialPos = dom.window.FCPageProof.getWatermarkPosition();
    expect(initialPos).toEqual({ xPercent: 50, yPercent: 50 });

    ctx.translate.mockClear();
    canvasEl.dispatchEvent(
      new dom.window.MouseEvent('pointerdown', { clientX: 20, clientY: 20, bubbles: true })
    );

    const draggedPos = dom.window.FCPageProof.getWatermarkPosition();
    // Dragging toward the top-left of the canvas moves x left of center, and
    // moves y toward the top of the page — a *higher* percent-from-bottom.
    expect(draggedPos.xPercent).toBeLessThan(50);
    expect(draggedPos.yPercent).toBeGreaterThan(50);

    // The overlay redrew at the new (dragged) position, not the old center.
    expect(ctx.translate).toHaveBeenCalled();
    const [xPx] = ctx.translate.mock.calls[ctx.translate.mock.calls.length - 1];
    expect(xPx).not.toBe(90); // 90 was the fixed page-center x from the test above
  });

  it('keeps following the pointer on pointermove, and stops on pointerup', async () => {
    const dom = createDom(pageProofHtml('watermark'));
    const ctx = await setupProof(dom, 'watermark');

    const canvasEl = dom.window.document.querySelector('.page-proof__canvas');
    canvasEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 140 });

    canvasEl.dispatchEvent(
      new dom.window.MouseEvent('pointerdown', { clientX: 50, clientY: 70, bubbles: true })
    );
    const posAfterDown = dom.window.FCPageProof.getWatermarkPosition();

    canvasEl.dispatchEvent(
      new dom.window.MouseEvent('pointermove', { clientX: 10, clientY: 10, bubbles: true })
    );
    const posAfterMove = dom.window.FCPageProof.getWatermarkPosition();
    expect(posAfterMove).not.toEqual(posAfterDown);

    canvasEl.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
    canvasEl.dispatchEvent(
      new dom.window.MouseEvent('pointermove', { clientX: 90, clientY: 130, bubbles: true })
    );
    // No pointerdown preceded this move — dragging is off, position unchanged.
    expect(dom.window.FCPageProof.getWatermarkPosition()).toEqual(posAfterMove);
  });
});

describe('shared-page-proof.js — page-number overlay math', () => {
  it('places the label using the same 6-way position logic pageNumbers() uses', async () => {
    const dom = createDom(pageProofHtml('pageNumbers'));
    const ctx = await setupProof(dom, 'pageNumbers');

    // top-left, format "n", startNumber 1 -> label "1". scale=2, marginPt=24.
    // xPx = marginPx = 48. yPtFromBottom = pageHeightPt - marginPt = 116 ->
    // yPx = (140-116)*2 = 48.
    expect(ctx.fillText).toHaveBeenLastCalledWith('1', 48, 48);
  });

  it('formats "Page N of total" using the loaded page count as the total', async () => {
    const dom = createDom(pageProofHtml('pageNumbers'));
    const ctx = await setupProof(dom, 'pageNumbers');

    const formatEl = dom.window.document.getElementById('opt-format');
    formatEl.value = 'page-of-total';
    formatEl.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    // 3-page doc, startNumber 1 -> lastNumber = 1 + 3 - 1 = 3.
    expect(ctx.fillText.mock.calls[ctx.fillText.mock.calls.length - 1][0]).toBe('Page 1 of 3');
  });
});
