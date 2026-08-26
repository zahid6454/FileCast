import { describe, expect, it, vi } from 'vitest';
import { createDom, evalScript, flush, mockCanvas } from './helpers.js';

// shared-page-grid.js (Tool Preview/Interaction Redesign §1-5) had no test
// coverage at all before this file — including for the rotation-preview math
// bug fixed alongside it (applyRotationPreview() was adding the page's own
// existing /Rotate value on top of the picked degrees, double-counting it for
// any already-rotated page, since pdf-render-worker.js's rendered bitmap
// already bakes that base rotation in via pdf.js's default viewport). These
// tests drive the component the way a converter + a real render worker would,
// with a fake Worker/IntersectionObserver standing in for the two browser
// APIs jsdom doesn't implement.

function pageGridPageHtml() {
  return `
    <div id="file-info"></div>
    <input id="file-input" type="file" />
    <button id="reset-btn"></button>
    <div id="a11y-status"></div>
    <select id="opt-rotation">
      <option value="90" selected>90</option>
      <option value="180">180</option>
      <option value="270">270</option>
    </select>
    <div id="tool-options"></div>
  `;
}

// Stands in for the real pdf-render-worker.js: 'load' replies with the given
// page count, 'render' replies with a fake bitmap immediately. Every real
// Worker this component creates is captured in `instances`.
function mockRenderWorker(win, { pageCount = 3 } = {}) {
  var instances = [];
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
                bitmap: { width: 100, height: 140, close: vi.fn() },
                pageWidthPt: 100,
                pageHeightPt: 140
              }
            });
          }
        }, 0);
      }
    };
    instances.push(worker);
    return worker;
  };
  return instances;
}

// jsdom has no real IntersectionObserver — the grid observes every tile as
// it's built and only requests a render once a tile is reported intersecting,
// so a stub that fires "intersecting" synchronously on observe() renders
// every tile immediately, standing in for "the whole grid is on-screen."
function mockIntersectionObserver(win) {
  win.IntersectionObserver = function (callback) {
    this.observe = function (target) {
      callback([{ isIntersecting: true, target: target }]);
    };
    this.unobserve = vi.fn();
  };
}

async function setupGrid(dom, mode, pageCount, onChange) {
  mockRenderWorker(dom.window, { pageCount: pageCount });
  mockIntersectionObserver(dom.window);
  mockCanvas(dom.window);
  dom.window.TOOL_CONFIG = {
    pdf_src: '/lib/pdf.min.js',
    pdf_render_worker_src: '/js/workers/pdf-render-worker.js'
  };
  evalScript(dom, 'shared-page-grid.js');
  dom.window.FCPageGrid.init({ mode: mode, onChange: onChange || function () {} });

  const input = dom.window.document.getElementById('file-input');
  const file = new dom.window.File([new Uint8Array(10)], 'doc.pdf', { type: 'application/pdf' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await flush();
}

describe('shared-page-grid.js — remove/extract spec building', () => {
  it('collapses marked pages into the same "N,M-P" ranges the worker parses', async () => {
    const dom = createDom(pageGridPageHtml());
    const specs = [];
    await setupGrid(dom, 'remove', 7, (spec) => specs.push(spec));

    // Mark pages 1, 3, 4, 5, 7 (1-indexed) -> origIdx 0, 2, 3, 4, 6.
    [0, 2, 3, 4, 6].forEach((origIdx) => {
      dom.window.document.querySelector('[data-orig-idx="' + origIdx + '"]').click();
    });

    expect(specs[specs.length - 1]).toBe('1,3-5,7');
  });

  it('announces the running "marked / will remain" count to the a11y live region on every click', async () => {
    const dom = createDom(pageGridPageHtml());
    await setupGrid(dom, 'remove', 4);

    dom.window.document.querySelector('[data-orig-idx="1"]').click();

    const status = dom.window.document.getElementById('a11y-status');
    expect(status.textContent).toBe('1 marked for removal — 3 will remain.');
  });

  it('extract mode marks are the visual inverse (same click, opposite meaning) of remove', async () => {
    const dom = createDom(pageGridPageHtml());
    const specs = [];
    await setupGrid(dom, 'extract', 5, (spec) => specs.push(spec));

    dom.window.document.querySelector('[data-orig-idx="0"]').click();
    dom.window.document.querySelector('[data-orig-idx="4"]').click();

    expect(specs[specs.length - 1]).toBe('1,5');
  });
});

describe('shared-page-grid.js — organize reorder', () => {
  it('keyboard arrow-key reorder emits a flat 1-indexed permutation, not ranges', async () => {
    const dom = createDom(pageGridPageHtml());
    const specs = [];
    await setupGrid(dom, 'organize', 4, (spec) => specs.push(spec));

    // Move page 1 (origIdx 0) right twice: [1,2,3,4] -> [2,1,3,4] -> [2,3,1,4].
    const tile0 = dom.window.document.querySelector('[data-orig-idx="0"]');
    tile0.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
    );
    tile0.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
    );

    expect(specs[specs.length - 1]).toBe('2,3,1,4');
  });

  it('Home moves the focused page to the first position', async () => {
    const dom = createDom(pageGridPageHtml());
    const specs = [];
    await setupGrid(dom, 'organize', 4, (spec) => specs.push(spec));

    const tile2 = dom.window.document.querySelector('[data-orig-idx="2"]');
    tile2.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));

    expect(specs[specs.length - 1]).toBe('3,1,2,4');
  });
});

describe('shared-page-grid.js — rotate v1 live preview', () => {
  it("previews exactly the picked rotation, regardless of the page's own existing orientation", async () => {
    // Regression guard for the double-counted-base-rotation bug: the
    // rendered thumbnail already shows the page upright (pdf.js's default
    // viewport bakes in the page's own /Rotate), so the CSS preview must
    // apply ONLY the picked degrees on top of it — never picked + anything
    // else — or an already-rotated real-world PDF (a common case: scans,
    // phone-camera PDFs) would preview a rotation that isn't what rotate()
    // actually produces.
    const dom = createDom(pageGridPageHtml());
    await setupGrid(dom, 'rotate', 2);

    var canvases = dom.window.document.querySelectorAll('.page-grid__tile-canvas');
    expect(canvases.length).toBe(2);
    // #opt-rotation defaults to 90.
    canvases.forEach((c) => {
      expect(c.style.transform).toBe('rotate(90deg)');
    });

    var select = dom.window.document.getElementById('opt-rotation');
    select.value = '270';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    canvases = dom.window.document.querySelectorAll('.page-grid__tile-canvas');
    canvases.forEach((c) => {
      expect(c.style.transform).toBe('rotate(270deg)');
    });
  });
});
