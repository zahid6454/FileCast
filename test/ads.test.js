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

describe('ads.js — per-unit push', () => {
  it('pushes exactly once per <ins> on the page', () => {
    const dom = createDom(slotMarkup('leaderboard') + slotMarkup('in-content'));
    evalScript(dom, 'ads.js');
    expect(dom.window.adsbygoogle).toHaveLength(2);
  });

  it('no-ops on a page with no units (home, category, static pages)', () => {
    const dom = createDom('<div class="content-block">no inventory here</div>');
    evalScript(dom, 'ads.js');
    // Never even creates the queue — an adless page must not look ad-bearing.
    expect(dom.window.adsbygoogle).toBeUndefined();
  });

  it('reuses an existing adsbygoogle queue rather than clobbering it', () => {
    const dom = createDom(slotMarkup('leaderboard'));
    dom.window.adsbygoogle = [{ existing: true }];
    evalScript(dom, 'ads.js');
    expect(dom.window.adsbygoogle).toHaveLength(2);
    expect(dom.window.adsbygoogle[0]).toEqual({ existing: true });
  });

  it('survives a blocked loader whose push throws', () => {
    const dom = createDom(slotMarkup('leaderboard') + slotMarkup('in-content'));
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
