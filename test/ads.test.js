import { describe, expect, it } from 'vitest';
import { createDom, evalScript, flush } from './helpers.js';

// ads.js is the CSP-safe replacement for AdSense's documented INLINE per-unit
// push (P6/P7). vitest is the only harness that can exercise it at all: the
// Playwright dist has no database and is permanently ads-off, so it never has an
// <ins> to act on, and pytest sees the built markup but never runs it (§1.4).
// These are hand-built jsdom fixtures — no build, no ad server.

// Mirrors _macros.html's ad_slot() output. Kept literal rather than imported so
// a template change that breaks the selectors shows up here as a failure.
function slotMarkup(modifier) {
  return `<div class="ad-slot ad-slot--${modifier}" id="ad-${modifier}">
    <ins class="adsbygoogle"
         data-ad-client="ca-pub-1234567890123456"
         data-ad-slot="1111111111"
         data-ad-format="auto"
         data-full-width-responsive="true"></ins>
  </div>`;
}

// ads.js arms one long fallback timer for units that never report a status.
// Capture the callback instead of waiting for it, so the tests stay
// deterministic AND can assert the not-yet-fired state.
function captureTimers(dom) {
  const queued = [];
  dom.window.setTimeout = (fn, ms) => queued.push({ fn, ms });
  function runTimers() {
    for (const t of queued) t.fn();
  }
  runTimers.delays = queued.map.bind(queued, (t) => t.ms);
  Object.defineProperty(runTimers, 'ms', { get: () => queued.map((t) => t.ms) });
  return runTimers;
}

// jsdom has no layout: offsetHeight is 0 for every element. An own property
// shadows the prototype getter, letting a fixture stand in for a unit that
// actually rendered.
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

describe('ads.js — collapsing slots that never fill', () => {
  // Google sets data-ad-status on the <ins> when the response lands. That is
  // the only signal distinguishing "no ad for you" from "not yet", so it drives
  // the collapse via MutationObserver rather than a timer.
  async function setStatus(ins, status) {
    ins.setAttribute('data-ad-status', status);
    await flush(); // MutationObserver callbacks are microtasks in jsdom
  }

  it('collapses a slot as soon as Google reports it unfilled', async () => {
    const dom = createDom(slotMarkup('leaderboard'));
    captureTimers(dom); // no timer involved in this path
    evalScript(dom, 'ads.js');
    await setStatus(dom.window.document.querySelector('ins.adsbygoogle'), 'unfilled');
    expect(dom.window.document.querySelector('.ad-slot').classList.contains('hidden')).toBe(true);
  });

  it('leaves a slot alone when Google reports it filled', async () => {
    const dom = createDom(slotMarkup('in-content'));
    captureTimers(dom);
    evalScript(dom, 'ads.js');
    await setStatus(dom.window.document.querySelector('ins.adsbygoogle'), 'filled');
    expect(dom.window.document.querySelector('.ad-slot').classList.contains('hidden')).toBe(false);
  });

  it('does NOT collapse a unit that has simply not responded yet', async () => {
    const dom = createDom(slotMarkup('leaderboard'));
    captureTimers(dom); // fallback deliberately never fired
    evalScript(dom, 'ads.js');
    await flush();
    expect(dom.window.document.querySelector('.ad-slot').classList.contains('hidden')).toBe(false);
  });

  it('arms the fallback far beyond one ad round-trip, not on a 2s timer', () => {
    // 🔴 The regression this pins, and it is about the NUMBER. ads.js is
    // deferred, so its clock starts at DOMContentLoaded; the vendor loader is
    // async and may not have executed by then, let alone completed a request.
    // At 2s a slow-connection unit has no status and no height, so a
    // height-based collapse hides a slot that then fills anyway — the
    // impression is served into a display:none box.
    const dom = createDom(slotMarkup('leaderboard'));
    const timers = captureTimers(dom);
    evalScript(dom, 'ads.js');
    expect(timers.ms).toHaveLength(1);
    expect(timers.ms[0]).toBeGreaterThanOrEqual(10000);
  });

  it('restores a slot the fallback hid when the fill finally lands', async () => {
    // The fallback is only safe because a late 'filled' un-hides the slot —
    // otherwise an ad would render inside a display:none box.
    const dom = createDom(slotMarkup('leaderboard'));
    const runTimers = captureTimers(dom);
    evalScript(dom, 'ads.js');
    runTimers(); // still silent at the timeout → collapsed
    const slot = dom.window.document.querySelector('.ad-slot');
    expect(slot.classList.contains('hidden')).toBe(true);

    await setStatus(dom.window.document.querySelector('ins.adsbygoogle'), 'filled');
    expect(slot.classList.contains('hidden')).toBe(false);
  });

  it('collapses a permanently silent unit once the fallback fires (blocked)', () => {
    const dom = createDom(slotMarkup('in-content'));
    const runTimers = captureTimers(dom);
    evalScript(dom, 'ads.js');
    runTimers();
    expect(dom.window.document.querySelector('.ad-slot').classList.contains('hidden')).toBe(true);
  });

  it('the fallback spares a unit that rendered without reporting a status', () => {
    // Height is consulted only as a reason NOT to collapse. If something is on
    // screen, hiding it is wrong regardless of what the attribute says.
    const dom = createDom(slotMarkup('in-content'));
    const runTimers = captureTimers(dom);
    evalScript(dom, 'ads.js');
    setRendered(dom.window.document.querySelector('ins.adsbygoogle'), 280);
    runTimers();
    expect(dom.window.document.querySelector('.ad-slot').classList.contains('hidden')).toBe(false);
  });

  it('collapses only the slot that failed, not its neighbour', async () => {
    const dom = createDom(slotMarkup('leaderboard') + slotMarkup('in-content'));
    captureTimers(dom);
    evalScript(dom, 'ads.js');
    const [filled, unfilled] = dom.window.document.querySelectorAll('ins.adsbygoogle');
    await setStatus(filled, 'filled');
    await setStatus(unfilled, 'unfilled');
    const slots = dom.window.document.querySelectorAll('.ad-slot');
    expect(slots[0].classList.contains('hidden')).toBe(false);
    expect(slots[1].classList.contains('hidden')).toBe(true);
  });

  it('honours a status already set before ads.js ran', () => {
    const dom = createDom(slotMarkup('leaderboard'));
    captureTimers(dom);
    dom.window.document.querySelector('ins.adsbygoogle').setAttribute('data-ad-status', 'unfilled');
    evalScript(dom, 'ads.js');
    expect(dom.window.document.querySelector('.ad-slot').classList.contains('hidden')).toBe(true);
  });

  it('ignores an <ins> that is not inside a .ad-slot', async () => {
    const dom = createDom('<ins class="adsbygoogle"></ins>');
    const runTimers = captureTimers(dom);
    evalScript(dom, 'ads.js');
    await setStatus(dom.window.document.querySelector('ins.adsbygoogle'), 'unfilled');
    expect(() => runTimers()).not.toThrow();
  });
});
