import { describe, expect, it, vi } from 'vitest';
import { createDom, evalScript, flush, mockCanvas } from './helpers.js';

// shared-file-grid.js (Tool Preview/Interaction Redesign §6 — PDF Merge's
// reorderable, thumbnailed file list) had no test coverage before this file:
// the plan's own risk column calls this component "Medium" risk (the one
// cross-cutting addition outside the page grid itself), and its
// moveFile()/commitOrder() reorder logic and sequential thumbnail queue are
// exactly the kind of hand-written coordination logic that shipped a real
// bug elsewhere in this PR (shared-page-grid.js's rotation math).

function fileGridHtml() {
  return `
    <div id="file-list"></div>
    <div id="a11y-status"></div>
  `;
}

// Stands in for pdf-render-worker.js. shared-file-grid.js talks to it via
// addEventListener('message', ...)/removeEventListener (one handler per
// in-flight job, not a single onmessage assignment), unlike
// shared-page-grid.js/shared-page-proof.js — so the mock has to be a real,
// if tiny, EventTarget-shaped stand-in rather than just an onmessage setter.
function mockRenderWorker(win, { pageCount = 1 } = {}) {
  win.Worker = function () {
    var listeners = [];
    var worker = {
      addEventListener: function (type, fn) {
        if (type === 'message') listeners.push(fn);
      },
      removeEventListener: function (type, fn) {
        listeners = listeners.filter(function (l) {
          return l !== fn;
        });
      },
      terminate: vi.fn(),
      postMessage: function (msg) {
        if (msg.op === 'load') {
          setTimeout(function () {
            listeners.slice().forEach(function (fn) {
              fn({ data: { ok: true, type: 'loaded', pageCount: pageCount } });
            });
          }, 0);
        } else if (msg.op === 'render') {
          setTimeout(function () {
            listeners.slice().forEach(function (fn) {
              fn({
                data: {
                  ok: true,
                  type: 'rendered',
                  requestId: msg.requestId,
                  pageIndex: msg.pageIndex,
                  bitmap: { width: 60, height: 84, close: vi.fn() }
                }
              });
            });
          }, 0);
        }
      }
    };
    return worker;
  };
}

async function setupGrid(dom, files) {
  mockRenderWorker(dom.window);
  mockCanvas(dom.window);
  dom.window.TOOL_CONFIG = {
    pdf_src: '/lib/pdf.min.js',
    pdf_render_worker_src: '/js/workers/pdf-render-worker.js'
  };
  dom.window._fileListReorder = vi.fn();
  dom.window._fileListRemove = vi.fn();
  evalScript(dom, 'shared-file-grid.js');
  dom.window.FCFileGrid.init();
  dom.window._fileListRenderer(files);
  // One file's thumbnail is a full load->render round trip (two chained
  // macrotasks), queued one at a time — several flush() rounds cover any
  // number of files this suite uses.
  await flush();
  await flush();
  await flush();
}

describe('shared-file-grid.js — render order and thumbnails', () => {
  it('renders one row per file, in order, each numbered by its position', async () => {
    const dom = createDom(fileGridHtml());
    const a = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    const b = new dom.window.File([new Uint8Array(10)], 'b.pdf', { type: 'application/pdf' });
    await setupGrid(dom, [a, b]);

    const rows = dom.window.document.querySelectorAll('.file-grid__row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('a.pdf');
    expect(rows[1].textContent).toContain('b.pdf');

    const badges = dom.window.document.querySelectorAll('.file-grid__badge');
    expect(Array.from(badges).map((el) => el.textContent)).toEqual(['1', '2']);

    // Each row's thumbnail canvas is painted from the mocked worker's bitmap.
    const canvases = dom.window.document.querySelectorAll('.file-grid__thumb-canvas');
    expect(canvases.length).toBe(2);
    canvases.forEach((c) => {
      expect(c.width).toBe(60);
      expect(c.height).toBe(84);
    });
  });
});

describe('shared-file-grid.js — reorder commits back to shared-multi.js', () => {
  it('ArrowDown moves a file later and calls window._fileListReorder with the new order', async () => {
    const dom = createDom(fileGridHtml());
    const a = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    const b = new dom.window.File([new Uint8Array(10)], 'b.pdf', { type: 'application/pdf' });
    await setupGrid(dom, [a, b]);

    const rowA = dom.window.document.querySelector('[data-file-index="0"]');
    rowA.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );

    expect(dom.window._fileListReorder).toHaveBeenCalledTimes(1);
    expect(dom.window._fileListReorder.mock.calls[0][0].map((f) => f.name)).toEqual([
      'b.pdf',
      'a.pdf'
    ]);

    // Badges re-sync to the new DOM order after the move.
    const badges = dom.window.document.querySelectorAll('.file-grid__badge');
    expect(Array.from(badges).map((el) => el.textContent)).toEqual(['1', '2']);
    const rows = dom.window.document.querySelectorAll('.file-grid__row');
    expect(rows[0].textContent).toContain('b.pdf');
    expect(rows[1].textContent).toContain('a.pdf');
  });

  it('End moves the focused file to the last position', async () => {
    const dom = createDom(fileGridHtml());
    const a = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    const b = new dom.window.File([new Uint8Array(10)], 'b.pdf', { type: 'application/pdf' });
    const c = new dom.window.File([new Uint8Array(10)], 'c.pdf', { type: 'application/pdf' });
    await setupGrid(dom, [a, b, c]);

    const rowA = dom.window.document.querySelector('[data-file-index="0"]');
    rowA.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));

    expect(dom.window._fileListReorder.mock.calls[0][0].map((f) => f.name)).toEqual([
      'b.pdf',
      'c.pdf',
      'a.pdf'
    ]);
  });

  it("the remove button calls window._fileListRemove with the row's current index", async () => {
    const dom = createDom(fileGridHtml());
    const a = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    const b = new dom.window.File([new Uint8Array(10)], 'b.pdf', { type: 'application/pdf' });
    await setupGrid(dom, [a, b]);

    dom.window.document.querySelector('[data-file-index="1"] .file-grid__remove').click();

    expect(dom.window._fileListRemove).toHaveBeenCalledWith(1);
  });
});
