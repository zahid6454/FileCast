import { beforeEach, describe, expect, it, vi } from 'vitest';
import { boot, createDom, flush } from './helpers.js';

// The rating threshold + percentage maths (`scoreLine`) and the baked-island
// parser (`parseBakedRating`) are pure, but they live inside the shared.js IIFE
// with no export seam — so we drive them through their real DOM contract, the
// same way the browser does. The island is baked into dist/ at BUILD time, which
// is exactly why this boundary belongs here and not in Playwright.

const WIDGET = `
  <div class="feedback" id="feedback">
    <span class="feedback__prompt" id="feedback-prompt">Was this tool helpful?</span>
    <button class="btn" type="button" data-feedback="yes">Yes</button>
    <button class="btn" type="button" data-feedback="no">No</button>
    <p class="feedback__score hidden" id="feedback-baked"></p>
    <p class="feedback__score hidden" id="feedback-score" role="status" aria-live="polite"></p>
  </div>`;

// `island` may be an object (serialized), a raw string (to test malformed JSON),
// or null/undefined for the no-DB case where build.py emits no island at all.
function ratingDom(island) {
  let markup = WIDGET;
  if (island !== undefined && island !== null) {
    const body = typeof island === 'string' ? island : JSON.stringify(island);
    markup += `<script type="application/json" id="tool-ratings">${body}</script>`;
  }
  const dom = createDom(markup);
  // `text-input` (not `standard`) so init() takes its early return before the
  // upload-zone wiring this fixture has no markup for. That the widget still
  // binds is the point: initFeedback() runs among the UNCONDITIONAL inits, above
  // the `uiType !== 'standard'` guard — without that placement the feedback
  // widget would silently go dead on every text and multi tool.
  dom.window.TOOL_CONFIG = { id: 'pdf-to-png', ui_type: 'text-input' };
  dom.window.fetch = vi.fn(() => Promise.resolve({ ok: true }));
  return dom;
}

// #feedback-score is the LIVE region (vote confirmation only); #feedback-baked
// is inert and carries anything rendered at page load.
const liveOf = (dom) => dom.window.document.getElementById('feedback-score');
const bakedOf = (dom) => dom.window.document.getElementById('feedback-baked');
const isHidden = (el) => el.classList.contains('hidden');
// Whichever element is currently showing text.
const shownScore = (dom) => (isHidden(bakedOf(dom)) ? liveOf(dom) : bakedOf(dom));

describe('shared.js rating — scoreLine() threshold boundary', () => {
  it('49 total ratings: below threshold, no score line pre-vote', async () => {
    const dom = ratingDom({ yes: 40, no: 9 });
    await boot(dom, 'shared.js');
    expect(isHidden(bakedOf(dom))).toBe(true);
  });

  it('50 total ratings: at threshold, score line shows', async () => {
    const dom = ratingDom({ yes: 40, no: 10 });
    await boot(dom, 'shared.js');
    expect(bakedOf(dom).textContent).toBe('80% found this helpful (50 ratings)');
  });

  it('51 total ratings: above threshold, score line shows', async () => {
    const dom = ratingDom({ yes: 41, no: 10 });
    await boot(dom, 'shared.js');
    expect(isHidden(bakedOf(dom))).toBe(false);
    expect(bakedOf(dom).textContent).toContain('(51 ratings)');
  });

  it('rounds the percentage rather than truncating (34/51 = 66.67 -> 67%)', async () => {
    const dom = ratingDom({ yes: 34, no: 17 });
    await boot(dom, 'shared.js');
    expect(bakedOf(dom).textContent).toBe('67% found this helpful (51 ratings)');
  });

  it('keeps the buttons visible pre-vote even when the score shows', async () => {
    const dom = ratingDom({ yes: 40, no: 10 });
    await boot(dom, 'shared.js');
    const buttons = dom.window.document.querySelectorAll('[data-feedback]');
    expect([...buttons].every((b) => !isHidden(b))).toBe(true);
  });
});

describe('shared.js rating — parseBakedRating() robustness', () => {
  it('no island (no DB at build) leaves the widget on its plain prompt', async () => {
    const dom = ratingDom(null);
    await boot(dom, 'shared.js');
    expect(isHidden(bakedOf(dom))).toBe(true);
    expect(isHidden(dom.window.document.getElementById('feedback-prompt'))).toBe(false);
  });

  it('malformed JSON degrades to no score instead of throwing', async () => {
    const dom = ratingDom('{"yes": 40, "no":');
    await expect(boot(dom, 'shared.js')).resolves.not.toThrow();
    expect(isHidden(bakedOf(dom))).toBe(true);
  });

  it('survives a valid-JSON-but-degenerate island (bare null)', async () => {
    // JSON.parse('null') succeeds, then reading .yes off null throws — inside
    // the try, so it degrades to "no score" like any other malformed island.
    const dom = ratingDom('null');
    await expect(boot(dom, 'shared.js')).resolves.not.toThrow();
    expect(isHidden(bakedOf(dom))).toBe(true);
    // The widget must remain interactive, not be left half-resolved.
    expect(isHidden(dom.window.document.querySelector('[data-feedback="yes"]'))).toBe(false);
  });

  it('coerces string counts (Number(x) || 0)', async () => {
    const dom = ratingDom({ yes: '45', no: '10' });
    await boot(dom, 'shared.js');
    expect(bakedOf(dom).textContent).toBe('82% found this helpful (55 ratings)');
  });

  it('treats null/undefined counts as 0, not NaN', async () => {
    const dom = ratingDom({ yes: 50, no: null });
    await boot(dom, 'shared.js');
    expect(bakedOf(dom).textContent).toBe('100% found this helpful (50 ratings)');
  });
});

describe('shared.js rating — the score line is announced (R11)', () => {
  // The end DOM state cannot distinguish "unhid then wrote" from "wrote then
  // unhid", but only the former announces: `.hidden` is display:none, so a live
  // region mutated while hidden is outside the accessibility tree and silent.
  // Observe the mutation ORDER to lock the correct sequence in.
  function recordMutations(dom, el) {
    const seen = [];
    const obs = new dom.window.MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes' && r.attributeName === 'class') {
          seen.push(el.classList.contains('hidden') ? 'hidden' : 'shown');
        } else {
          seen.push('text');
        }
      }
    });
    obs.observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
    return seen;
  }

  it('unhides #feedback-score before writing the resolved text', async () => {
    const dom = ratingDom({ yes: 5, no: 1 });
    await boot(dom, 'shared.js');
    const seen = recordMutations(dom, liveOf(dom));

    dom.window.document.querySelector('[data-feedback="yes"]').click();
    await flush();

    expect(seen.indexOf('shown')).toBeGreaterThanOrEqual(0);
    expect(seen.indexOf('shown')).toBeLessThan(seen.indexOf('text'));
  });

  it('keeps the live-region attributes intact on the resolved element', async () => {
    const dom = ratingDom({ yes: 5, no: 1 });
    await boot(dom, 'shared.js');
    dom.window.document.querySelector('[data-feedback="yes"]').click();
    await flush();

    const el = liveOf(dom);
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
  });
});

describe('shared.js rating — nothing is announced on page load', () => {
  // #feedback-score is role="status" aria-live="polite". init() runs at
  // DOMContentLoaded, so ANY text written there on the load path is read out
  // unprompted, interrupting whatever the user is doing — on every page load,
  // for content they never acted on. Page-load text belongs in the inert
  // element; the live region is reserved for confirming a vote just cast.
  it('renders baked social proof into the inert element, not the live region', async () => {
    const dom = ratingDom({ yes: 40, no: 10 });
    await boot(dom, 'shared.js');

    expect(bakedOf(dom).textContent).toBe('80% found this helpful (50 ratings)');
    expect(isHidden(liveOf(dom))).toBe(true);
    expect(liveOf(dom).textContent).toBe('');
  });

  it('renders the already-voted state into the inert element too', async () => {
    const dom = ratingDom({ yes: 40, no: 10 });
    dom.window.localStorage.setItem('fc_rated_pdf-to-png', 'yes');
    await boot(dom, 'shared.js');

    expect(isHidden(bakedOf(dom))).toBe(false);
    expect(isHidden(liveOf(dom))).toBe(true);
    expect(liveOf(dom).textContent).toBe('');
  });

  it('moves the message into the live region once the user votes', async () => {
    const dom = ratingDom({ yes: 40, no: 10 });
    await boot(dom, 'shared.js');
    expect(bakedOf(dom).textContent).toContain('(50 ratings)'); // pre-vote

    dom.window.document.querySelector('[data-feedback="yes"]').click();
    await flush();

    // The pre-vote line is retired so the two never show at once.
    expect(isHidden(bakedOf(dom))).toBe(true);
    expect(liveOf(dom).textContent).toBe('80% found this helpful (51 ratings)');
  });
});

describe('shared.js rating — the lock follows the SERVER, not the click', () => {
  const ok = () => Promise.resolve({ ok: true, status: 200 });
  const lock = (dom) => dom.window.localStorage.getItem('fc_rated_pdf-to-png');

  function votingDom(agg, fetchImpl) {
    const dom = ratingDom(agg);
    dom.window.FILECAST = { apiBase: 'https://api.example.test' };
    dom.window.fetch = vi.fn(fetchImpl);
    return dom;
  }

  it('locks on a recorded vote, storing the direction', async () => {
    const dom = votingDom({ yes: 5, no: 1 }, ok);
    await boot(dom, 'shared.js');
    dom.window.document.querySelector('[data-feedback="no"]').click();
    await flush();
    expect(lock(dom)).toBe('no');
  });

  it('does NOT lock when the POST fails — the vote stays retryable', async () => {
    // An ad-blocker blocking the API origin is the common case, and it hits the
    // privacy-tooling population hardest. Locking here would discard their
    // feedback permanently and skew the published percentage.
    const dom = votingDom({ yes: 5, no: 1 }, () => Promise.reject(new Error('blocked')));
    await boot(dom, 'shared.js');
    dom.window.document.querySelector('[data-feedback="yes"]').click();
    await flush();

    expect(lock(dom)).toBeNull();
    expect(liveOf(dom).textContent).toBe('Thanks for your feedback!'); // UX unchanged
  });

  it('does NOT lock on a non-ok response (e.g. 429 rate-limited)', async () => {
    const dom = votingDom({ yes: 5, no: 1 }, () => Promise.resolve({ ok: false, status: 429 }));
    await boot(dom, 'shared.js');
    dom.window.document.querySelector('[data-feedback="yes"]').click();
    await flush();
    expect(lock(dom)).toBeNull();
  });

  it('does NOT lock when there is no apiBase to POST to', async () => {
    const dom = ratingDom({ yes: 5, no: 1 });
    await boot(dom, 'shared.js');
    dom.window.document.querySelector('[data-feedback="yes"]').click();
    await flush();
    expect(lock(dom)).toBeNull();
  });

  it('a failed vote leaves the buttons live again on the next load', async () => {
    const dom = votingDom({ yes: 5, no: 1 }, () => Promise.reject(new Error('blocked')));
    await boot(dom, 'shared.js');
    dom.window.document.querySelector('[data-feedback="yes"]').click();
    await flush();

    // Second visit: same storage, fresh DOM.
    const again = ratingDom({ yes: 5, no: 1 });
    again.window.localStorage.setItem('probe', '1');
    expect(again.window.localStorage.getItem('fc_rated_pdf-to-png')).toBeNull();
    await boot(again, 'shared.js');
    expect(isHidden(again.window.document.querySelector('[data-feedback="yes"]'))).toBe(false);
  });

  it('the reload count matches what the vote displayed (no phantom -1)', async () => {
    const dom = votingDom({ yes: 40, no: 10 }, ok);
    await boot(dom, 'shared.js');
    dom.window.document.querySelector('[data-feedback="yes"]').click();
    await flush();
    const atVote = liveOf(dom).textContent;
    expect(atVote).toBe('80% found this helpful (51 ratings)');

    // Reload with the lock in place: the recorded vote is still not in the
    // baked counts, so the reload path must add it back the same way.
    const reloaded = ratingDom({ yes: 40, no: 10 });
    reloaded.window.localStorage.setItem('fc_rated_pdf-to-png', 'yes');
    await boot(reloaded, 'shared.js');
    expect(bakedOf(reloaded).textContent).toBe(atVote);
  });

  it('a legacy flag lock still resolves, falling back to bare baked counts', async () => {
    const dom = ratingDom({ yes: 40, no: 10 });
    dom.window.localStorage.setItem('fc_rated_pdf-to-png', '1'); // pre-direction
    await boot(dom, 'shared.js');
    expect(bakedOf(dom).textContent).toBe('80% found this helpful (50 ratings)');
  });
});

describe('shared.js rating — vote resolve', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs exactly {tool_id, vote} — no client fingerprint (D4/P3)', async () => {
    const dom = ratingDom({ yes: 40, no: 10 });
    dom.window.FILECAST = { apiBase: 'https://api.example.test' };
    await boot(dom, 'shared.js');
    dom.window.document.querySelector('[data-feedback="yes"]').click();
    await flush();

    const [url, opts] = dom.window.fetch.mock.calls.at(-1);
    expect(String(url)).toBe('https://api.example.test/api/v1/ratings');
    expect(opts.credentials).toBe('include');
    expect(JSON.parse(opts.body)).toEqual({ tool_id: 'pdf-to-png', vote: 'yes' });
  });

  it('collapses to the optimistic score line after voting (41/10 -> 51)', async () => {
    const dom = ratingDom({ yes: 40, no: 10 });
    await boot(dom, 'shared.js');
    dom.window.document.querySelector('[data-feedback="yes"]').click();
    await flush();

    expect(liveOf(dom).textContent).toBe('80% found this helpful (51 ratings)');
    const buttons = dom.window.document.querySelectorAll('[data-feedback]');
    expect([...buttons].every((b) => isHidden(b))).toBe(true);
    expect(isHidden(dom.window.document.getElementById('feedback-prompt'))).toBe(true);
  });

  it('below threshold, a vote resolves to a plain thanks', async () => {
    const dom = ratingDom({ yes: 5, no: 1 });
    await boot(dom, 'shared.js');
    dom.window.document.querySelector('[data-feedback="no"]').click();
    await flush();
    expect(liveOf(dom).textContent).toBe('Thanks for your feedback!');
  });

  it('a prior localStorage lock renders the resolved state, buttons never shown', async () => {
    const dom = ratingDom({ yes: 40, no: 10 });
    dom.window.localStorage.setItem('fc_rated_pdf-to-png', '1');
    await boot(dom, 'shared.js');

    expect(bakedOf(dom).textContent).toBe('80% found this helpful (50 ratings)');
    const buttons = dom.window.document.querySelectorAll('[data-feedback]');
    expect([...buttons].every((b) => isHidden(b))).toBe(true);
  });

  it('still resolves when the API rejects (progressive enhancement)', async () => {
    const dom = ratingDom({ yes: 5, no: 1 });
    dom.window.FILECAST = { apiBase: 'https://api.example.test' };
    dom.window.fetch = vi.fn(() => Promise.reject(new Error('network down')));
    await boot(dom, 'shared.js');
    dom.window.document.querySelector('[data-feedback="yes"]').click();
    await flush();
    expect(liveOf(dom).textContent).toBe('Thanks for your feedback!');
  });

  it('ignores a malformed data-feedback value rather than POSTing it', async () => {
    const dom = ratingDom({ yes: 5, no: 1 });
    dom.window.FILECAST = { apiBase: 'https://api.example.test' };
    await boot(dom, 'shared.js');

    const btn = dom.window.document.querySelector('[data-feedback="yes"]');
    btn.setAttribute('data-feedback', 'maybe'); // the API would 400 on this
    btn.click();
    await flush();

    expect(dom.window.fetch).not.toHaveBeenCalled();
    expect(isHidden(liveOf(dom))).toBe(true); // widget stays interactive
    expect(isHidden(bakedOf(dom))).toBe(true);
    expect(isHidden(btn)).toBe(false);
  });

  it('does not POST when no apiBase is configured', async () => {
    const dom = ratingDom({ yes: 5, no: 1 });
    await boot(dom, 'shared.js');
    dom.window.document.querySelector('[data-feedback="yes"]').click();
    await flush();
    const ratingCalls = dom.window.fetch.mock.calls.filter((c) =>
      String(c[0]).includes('/ratings')
    );
    expect(ratingCalls).toHaveLength(0);
  });
});
