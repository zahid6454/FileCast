import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

// ads.js is the CSP-safe replacement for AdSense's documented INLINE per-unit
// push (P6/P7). vitest is the only harness that can exercise it at all: the
// Playwright dist has no database and is permanently ads-off, so it never has an
// <ins> to act on, and pytest sees the built markup but never runs it (§1.4).
// These are hand-built jsdom fixtures — no build, no ad server.

// Mirrors _macros.html's ad_slot() output. Kept literal rather than imported so
// a template change that breaks the selectors shows up here as a failure.
function slotMarkup(modifier) {
  return `<div class="ad-slot ad-slot--${modifier}" id="ad-${modifier}">
    <ins class="adsbygoogle" style="display:block"
         data-ad-client="ca-pub-1234567890123456"
         data-ad-slot="1111111111"
         data-ad-format="auto"
         data-full-width-responsive="true"></ins>
  </div>`;
}

// ads.js schedules the unfilled-slot collapse on a 2s timer. Capture the
// callback instead of waiting for it, so the tests stay deterministic AND can
// assert the not-yet-fired state (that the collapse is not eager).
function captureTimers(dom) {
  const queued = [];
  dom.window.setTimeout = (fn) => queued.push(fn);
  return function runTimers() {
    for (const fn of queued) fn();
  };
}

// jsdom has no layout: offsetHeight is 0 for every element, which is ads.js's
// "unfilled" signal. An own property shadows the prototype getter, letting a
// fixture stand in for a unit that actually rendered.
function setRendered(el, height) {
  Object.defineProperty(el, 'offsetHeight', { value: height, configurable: true });
}

describe('ads.js — per-unit push', () => {
  it('pushes exactly once per <ins> on the page', () => {
    const dom = createDom(slotMarkup('leaderboard') + slotMarkup('in-content'));
    captureTimers(dom);
    evalScript(dom, 'ads.js');
    expect(dom.window.adsbygoogle).toHaveLength(2);
  });

  it('no-ops on a page with no units (home, category, static pages)', () => {
    const dom = createDom('<div class="content-block">no inventory here</div>');
    captureTimers(dom);
    evalScript(dom, 'ads.js');
    // Never even creates the queue — an adless page must not look ad-bearing.
    expect(dom.window.adsbygoogle).toBeUndefined();
  });

  it('reuses an existing adsbygoogle queue rather than clobbering it', () => {
    const dom = createDom(slotMarkup('leaderboard'));
    captureTimers(dom);
    dom.window.adsbygoogle = [{ existing: true }];
    evalScript(dom, 'ads.js');
    expect(dom.window.adsbygoogle).toHaveLength(2);
    expect(dom.window.adsbygoogle[0]).toEqual({ existing: true });
  });

  it('survives a blocked loader whose push throws', () => {
    const dom = createDom(slotMarkup('leaderboard') + slotMarkup('in-content'));
    captureTimers(dom);
    let calls = 0;
    dom.window.adsbygoogle = {
      push() {
        calls++;
        throw new Error('blocked by extension');
      }
    };
    // An ad blocker replacing the queue with a throwing stub must not take the
    // page down with it, and must not abort the remaining units.
    expect(() => evalScript(dom, 'ads.js')).not.toThrow();
    expect(calls).toBe(2);
  });
});

describe('ads.js — unfilled-slot collapse', () => {
  it('collapses a slot whose unit reports data-ad-status="unfilled"', () => {
    const dom = createDom(slotMarkup('leaderboard'));
    const runTimers = captureTimers(dom);
    const ins = dom.window.document.querySelector('ins.adsbygoogle');
    setRendered(ins, 90); // has height, but Google says there was no fill
    ins.setAttribute('data-ad-status', 'unfilled');
    evalScript(dom, 'ads.js');
    runTimers();
    expect(dom.window.document.querySelector('.ad-slot').style.display).toBe('none');
  });

  it('collapses a slot whose unit rendered no height (blocked)', () => {
    const dom = createDom(slotMarkup('in-content'));
    const runTimers = captureTimers(dom);
    // offsetHeight stays 0 — jsdom's default, and the blocked-ad signal.
    evalScript(dom, 'ads.js');
    runTimers();
    expect(dom.window.document.querySelector('.ad-slot').style.display).toBe('none');
  });

  it('leaves a filled slot alone', () => {
    const dom = createDom(slotMarkup('in-content'));
    const runTimers = captureTimers(dom);
    const ins = dom.window.document.querySelector('ins.adsbygoogle');
    setRendered(ins, 280);
    ins.setAttribute('data-ad-status', 'filled');
    evalScript(dom, 'ads.js');
    runTimers();
    expect(dom.window.document.querySelector('.ad-slot').style.display).toBe('');
  });

  it('collapses only the slots that failed, not their neighbours', () => {
    const dom = createDom(slotMarkup('leaderboard') + slotMarkup('in-content'));
    const runTimers = captureTimers(dom);
    const [filled, unfilled] = dom.window.document.querySelectorAll('ins.adsbygoogle');
    setRendered(filled, 90);
    filled.setAttribute('data-ad-status', 'filled');
    unfilled.setAttribute('data-ad-status', 'unfilled');
    evalScript(dom, 'ads.js');
    runTimers();
    const slots = dom.window.document.querySelectorAll('.ad-slot');
    expect(slots[0].style.display).toBe('');
    expect(slots[1].style.display).toBe('none');
  });

  it('does NOT collapse eagerly — a slow but successful fill must not be hidden', () => {
    const dom = createDom(slotMarkup('leaderboard'));
    captureTimers(dom); // deliberately never run
    evalScript(dom, 'ads.js');
    expect(dom.window.document.querySelector('.ad-slot').style.display).toBe('');
  });

  it('ignores a .ad-slot that holds no unit', () => {
    const dom = createDom(
      `<div class="ad-slot" id="ad-leaderboard"></div>${slotMarkup('in-content')}`
    );
    const runTimers = captureTimers(dom);
    const ins = dom.window.document.querySelector('ins.adsbygoogle');
    setRendered(ins, 280);
    evalScript(dom, 'ads.js');
    expect(() => runTimers()).not.toThrow();
    expect(dom.window.document.querySelectorAll('.ad-slot')[0].style.display).toBe('');
  });
});
