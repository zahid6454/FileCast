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
    <div id="tool-options">
      <input id="opt-pages" class="tool-options__input" type="text" />
    </div>
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

  it('never hides #tool-options, and makes the mirrored input read-only once the grid builds', async () => {
    const dom = createDom(pageGridPageHtml());
    await setupGrid(dom, 'remove', 4);

    const toolOptions = dom.window.document.getElementById('tool-options');
    const input = dom.window.document.getElementById('opt-pages');
    expect(toolOptions.classList.contains('hidden')).toBe(false);
    expect(input.readOnly).toBe(true);
  });

  it('extract/organize also keep #tool-options visible and read-only', async () => {
    const extractDom = createDom(pageGridPageHtml());
    await setupGrid(extractDom, 'extract', 3);
    expect(extractDom.window.document.getElementById('opt-pages').readOnly).toBe(true);
    expect(
      extractDom.window.document.getElementById('tool-options').classList.contains('hidden')
    ).toBe(false);

    const organizeDom = createDom(pageGridPageHtml());
    await setupGrid(organizeDom, 'organize', 3);
    expect(organizeDom.window.document.getElementById('opt-pages').readOnly).toBe(true);
    expect(
      organizeDom.window.document.getElementById('tool-options').classList.contains('hidden')
    ).toBe(false);
  });

  it('restores the input to editable on teardown (fallback to the plain text box)', async () => {
    const dom = createDom(pageGridPageHtml());
    await setupGrid(dom, 'remove', 3);
    expect(dom.window.document.getElementById('opt-pages').readOnly).toBe(true);

    dom.window.document.getElementById('reset-btn').click();

    expect(dom.window.document.getElementById('opt-pages').readOnly).toBe(false);
  });

  it('clears the mirrored spec synchronously on a new file pick (closes a race with the Convert button)', async () => {
    // shared.js enables Convert the instant a file is selected, before this
    // module's async pdf.js load/buildGrid() ever runs for the NEW file — the
    // old spec (marked for the PREVIOUS, different-page-count document) must
    // already be cleared by the time dispatchEvent() returns, or a Convert
    // click landing in that gap would apply it to the wrong document.
    // onChange writes into #opt-pages itself, same as the real converters
    // (e.g. pdf-remove-pages.js) do — setupGrid()'s own default onChange is a
    // no-op, so it wouldn't otherwise reach the DOM the way production does.
    const dom = createDom(pageGridPageHtml());
    const input = dom.window.document.getElementById('opt-pages');
    await setupGrid(dom, 'remove', 7, function (spec) {
      input.value = spec;
    });
    dom.window.document.querySelector('[data-orig-idx="0"]').click();
    expect(input.value).toBe('1');

    const fileInput = dom.window.document.getElementById('file-input');
    const file2 = new dom.window.File([new Uint8Array(10)], 'doc2.pdf', {
      type: 'application/pdf'
    });
    Object.defineProperty(fileInput, 'files', { value: [file2], configurable: true });
    fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    expect(input.value).toBe('');
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

describe('shared-page-grid.js — split "at marked points"', () => {
  function splitModeButton(dom, label) {
    return Array.from(dom.window.document.querySelectorAll('.page-grid__split-mode-btn')).find(
      (b) => b.textContent === label
    );
  }

  it('"every page" is the default and never calls onChange with a groups array', async () => {
    const dom = createDom(pageGridPageHtml());
    const calls = [];
    await setupGrid(dom, 'preview', 4, (groups) => calls.push(groups));

    // buildGrid()'s own unconditional commitChange() call still fires once,
    // with buildSpec()'s empty string — falsy the same way null is, so Split
    // never posts groups on an untouched load.
    expect(calls[calls.length - 1]).toBe('');
    expect(dom.window.document.querySelector('.page-grid__cut-toggle')).toBeNull();
  });

  it('toggling cut points emits contiguous groups covering every page exactly once', async () => {
    const dom = createDom(pageGridPageHtml());
    const groupsCalls = [];
    await setupGrid(dom, 'preview', 5, (groups) => groupsCalls.push(groups));

    splitModeButton(dom, 'At marked points').click();

    // Cut after page 2 (origIdx 1) and after page 4 (origIdx 3):
    // pages 1-5 -> groups [1,2] [3,4] [5].
    dom.window.document.querySelector('[data-orig-idx="1"] .page-grid__cut-toggle').click();
    dom.window.document.querySelector('[data-orig-idx="3"] .page-grid__cut-toggle').click();

    expect(groupsCalls[groupsCalls.length - 1]).toEqual([
      [0, 1],
      [2, 3],
      [4, 4]
    ]);
  });

  it('untoggling a cut re-merges the two groups back into one', async () => {
    const dom = createDom(pageGridPageHtml());
    const groupsCalls = [];
    await setupGrid(dom, 'preview', 3, (groups) => groupsCalls.push(groups));

    splitModeButton(dom, 'At marked points').click();
    const toggle = dom.window.document.querySelector('[data-orig-idx="0"] .page-grid__cut-toggle');
    toggle.click();
    toggle.click();

    expect(groupsCalls[groupsCalls.length - 1]).toEqual([[0, 2]]);
  });

  it('switching back to "every page" reverts onChange to null and removes the toggles', async () => {
    const dom = createDom(pageGridPageHtml());
    const groupsCalls = [];
    await setupGrid(dom, 'preview', 4, (groups) => groupsCalls.push(groups));

    splitModeButton(dom, 'At marked points').click();
    dom.window.document.querySelector('[data-orig-idx="0"] .page-grid__cut-toggle').click();
    splitModeButton(dom, 'Every page').click();

    expect(groupsCalls[groupsCalls.length - 1]).toBeNull();
    expect(dom.window.document.querySelector('.page-grid__cut-toggle')).toBeNull();
  });

  it('has no cut toggle on the last tile (no meaningful cut after the last page)', async () => {
    const dom = createDom(pageGridPageHtml());
    await setupGrid(dom, 'preview', 3);

    splitModeButton(dom, 'At marked points').click();

    expect(
      dom.window.document.querySelector('[data-orig-idx="2"] .page-grid__cut-toggle')
    ).toBeNull();
    expect(
      dom.window.document.querySelector('[data-orig-idx="1"] .page-grid__cut-toggle')
    ).not.toBeNull();
  });

  it('preserves marked cuts across flipping back and forth (not lost on "every page")', async () => {
    const dom = createDom(pageGridPageHtml());
    const groupsCalls = [];
    await setupGrid(dom, 'preview', 4, (groups) => groupsCalls.push(groups));

    splitModeButton(dom, 'At marked points').click();
    dom.window.document.querySelector('[data-orig-idx="1"] .page-grid__cut-toggle').click();
    splitModeButton(dom, 'Every page').click();
    splitModeButton(dom, 'At marked points').click();

    // Re-entering "at marked points" immediately re-posts the preserved cut
    // (visitor shouldn't lose their marks just by previewing "every page").
    expect(groupsCalls[groupsCalls.length - 1]).toEqual([
      [0, 1],
      [2, 3]
    ]);
    const restoredToggle = dom.window.document.querySelector(
      '[data-orig-idx="1"] .page-grid__cut-toggle'
    );
    expect(restoredToggle.classList.contains('is-active')).toBe(true);
  });

  it('a new file pick resets Split groups synchronously (closes a race with the Convert button)', async () => {
    // shared.js enables Convert the instant a file is selected, before this
    // module's async pdf.js load/buildGrid() ever runs — onChange(null) must
    // fire synchronously on pick, or a stale groups array from a
    // previously-loaded, different-page-count PDF could still be in effect
    // for the split-second before the new grid resets it.
    const dom = createDom(pageGridPageHtml());
    const groupsCalls = [];
    await setupGrid(dom, 'preview', 4, (groups) => groupsCalls.push(groups));

    splitModeButton(dom, 'At marked points').click();
    dom.window.document.querySelector('[data-orig-idx="0"] .page-grid__cut-toggle').click();
    expect(groupsCalls[groupsCalls.length - 1]).not.toBeNull();

    // Pick a second file — before awaiting the (mocked) async load, onChange
    // must already have fired with null.
    const input = dom.window.document.getElementById('file-input');
    const file2 = new dom.window.File([new Uint8Array(10)], 'doc2.pdf', {
      type: 'application/pdf'
    });
    Object.defineProperty(input, 'files', { value: [file2], configurable: true });
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    expect(groupsCalls[groupsCalls.length - 1]).toBeNull();
  });
});
