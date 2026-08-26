import { describe, expect, it } from 'vitest';
import { boot, createDom } from './helpers.js';

// Tool UI audit round 2, §1: dragging a gutter'd textarea's native resize
// handle fires neither 'input' nor 'scroll', so the gutter's numbers went
// stale — and once a ResizeObserver was added to catch that, it turned out
// the gutter's own box height had the same problem, worse: CSS flex
// `align-items: stretch` alone doesn't reliably keep it matched to a
// manually-resized textarea across browsers. jsdom has no layout engine
// (every element's offsetHeight is hardcoded 0) and no ResizeObserver at
// all, so both are faked below rather than left untested.

function toolPageHtml() {
  return `
    <div id="text-result" class="hidden">
      <div class="text-editor" id="text-output-editor">
        <div class="text-editor__gutter" aria-hidden="true"></div>
        <textarea class="text-output-area" id="text-output"></textarea>
      </div>
    </div>
  `;
}

// Stands in for "however tall the textarea actually renders". Walks up to
// the real ancestor a real browser would collapse to 0 for — the .hidden
// #text-result wrapper every text-input tool's output starts inside — so
// the exact hidden-ancestor scenario showResult() has to handle is
// reproducible here instead of jsdom's flat, always-0 offsetHeight.
function mockOffsetHeight(textarea, height) {
  Object.defineProperty(textarea, 'offsetHeight', {
    configurable: true,
    get() {
      let el = textarea;
      while (el) {
        if (el.classList?.contains('hidden')) return 0;
        el = el.parentElement;
      }
      return height;
    }
  });
}

class FakeResizeObserver {
  constructor(cb) {
    this.cb = cb;
    this.targets = [];
    FakeResizeObserver.instances.push(this);
  }
  observe(target) {
    this.targets.push(target);
  }
  disconnect() {}
}
FakeResizeObserver.instances = [];

describe('text-editor-gutter.js', () => {
  it('renders one line number per line and keeps them synced on input', async () => {
    const dom = createDom(toolPageHtml());
    const textarea = dom.window.document.getElementById('text-output');
    mockOffsetHeight(textarea, 150);
    await boot(dom, 'text-editor-gutter.js');

    const inner = dom.window.document.querySelector('.text-editor__gutter-inner');
    expect(inner.textContent).toBe('1');

    textarea.value = 'a\nb\nc';
    textarea.dispatchEvent(new dom.window.Event('input'));
    expect(inner.textContent).toBe('1\n2\n3');
  });

  it('translates the gutter to match scrollTop on scroll', async () => {
    const dom = createDom(toolPageHtml());
    const textarea = dom.window.document.getElementById('text-output');
    mockOffsetHeight(textarea, 150);
    await boot(dom, 'text-editor-gutter.js');

    const inner = dom.window.document.querySelector('.text-editor__gutter-inner');
    Object.defineProperty(textarea, 'scrollTop', { value: 42, configurable: true });
    textarea.dispatchEvent(new dom.window.Event('scroll'));
    expect(inner.style.transform).toBe('translateY(-42px)');
  });

  it('matches the gutter height to the textarea on wire, and re-syncs via ResizeObserver on manual resize', async () => {
    FakeResizeObserver.instances.length = 0;
    const dom = createDom(toolPageHtml());
    dom.window.ResizeObserver = FakeResizeObserver;
    // Already-visible for this test — the hidden-ancestor case has its own
    // test below.
    dom.window.document.getElementById('text-result').classList.remove('hidden');
    const textarea = dom.window.document.getElementById('text-output');
    mockOffsetHeight(textarea, 150);
    await boot(dom, 'text-editor-gutter.js');

    const gutter = dom.window.document.querySelector('.text-editor__gutter');
    expect(gutter.style.height).toBe('150px');

    const ro = FakeResizeObserver.instances.find((r) => r.targets.includes(textarea));
    expect(ro).toBeTruthy();

    // A manual drag-resize: no 'input'/'scroll' event fires for this in a
    // real browser, only the ResizeObserver does.
    Object.defineProperty(textarea, 'offsetHeight', { configurable: true, get: () => 320 });
    ro.cb();
    expect(gutter.style.height).toBe('320px');
  });

  it('does not leave the gutter pinned to a stale 0px height once a hidden ancestor is revealed', async () => {
    // Regression: shared-text.js's showResult() used to call
    // FC.refreshLineNumbers(els.outputArea) BEFORE unhiding #text-result —
    // the output gutter read offsetHeight while still display:none (0) on
    // every single conversion, and matchHeight() had no other trigger to
    // correct it until the next manual resize nudged the ResizeObserver.
    const dom = createDom(toolPageHtml());
    const textarea = dom.window.document.getElementById('text-output');
    mockOffsetHeight(textarea, 150);
    await boot(dom, 'text-editor-gutter.js');

    const gutter = dom.window.document.querySelector('.text-editor__gutter');
    expect(gutter.style.height).toBe('0px');

    // Mirrors showResult()'s corrected order: unhide, then refresh.
    dom.window.document.getElementById('text-result').classList.remove('hidden');
    dom.window.FC.refreshLineNumbers(textarea);
    expect(gutter.style.height).toBe('150px');
  });
});
