import { expect, test } from '@playwright/test';

// Phase 6 rating E2E, redesigned for P2 §18 (technical audit report). Covers
// what genuinely needs a browser: a real click, the real POST body, the
// localStorage lock surviving a reload, and degradation when the API is
// unreachable. The 50-rating threshold maths is NOT tested here — the
// #tool-ratings island is baked into dist/ at build time, so asserting the
// boundary would need a ≥50-seeded DB plus a rebuild inside the Playwright run.
// scoreLine()/parseBakedRating() are pure and unit-tested in test/rating.test.js.
//
// P2 §18 moved the widget from the bottom of the page (visible on load) into
// the result panel (.result/.multi-result/.text-result), hidden until a
// conversion actually completes — every test here does a REAL conversion
// first, where the old version just navigated and clicked.

const NETWORK_NOISE = /Failed to load resource|net::ERR_|ERR_[A-Z_]+/i;

function collectPageProblems(page) {
  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !NETWORK_NOISE.test(msg.text())) {
      problems.push('console.error: ' + msg.text());
    }
  });
  page.on('pageerror', (err) => problems.push('pageerror: ' + err.message));
  return problems;
}

// Capture rating/feedback POSTs and fulfil them locally — these tests must not
// depend on the API container being up.
// The vote is a cross-origin credentialed POST with a JSON content-type, so the
// browser preflights it and will not expose the response unless CORS allows the
// page's origin. The mock must therefore answer OPTIONS and send the same
// headers the real API does — otherwise the fetch rejects and we would be
// testing the failure path while believing we were testing success.
const CORS = {
  'Access-Control-Allow-Origin': 'http://127.0.0.1:8000',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function interceptRatings(page, { fulfil = true, status = 200, pathSuffix = '' } = {}) {
  const posts = [];
  page.route('**/api/v1/ratings' + pathSuffix, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    if (request.method() === 'POST') {
      posts.push(request.postDataJSON());
    }
    if (fulfil) {
      await route.fulfill({
        status,
        headers: Object.assign({ 'Content-Type': 'application/json' }, CORS),
        body: '{"ok":true}'
      });
    } else {
      await route.abort('failed'); // API down
    }
  });
  return posts;
}

// A 1x1 transparent PNG (valid image the browser can decode) — same fixture
// smoke.spec.js uses for image-compress.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

// Drives a REAL conversion to completion on each of the three ui_types, so the
// result panel (and the feedback widget inside it) actually unhides. Also
// intercepts the /feedback route by default — most tests here don't exercise
// the "No" follow-up, but leaving it unmocked would let a stray click 404
// against the real API and surface as console noise.
const RESULT_SELECTOR = {
  standard: '#result',
  'text-input': '#text-result',
  'multi-file': '#multi-result'
};

async function convert(page, tool) {
  await page.goto(tool.url);
  if (tool.name === 'text-input') {
    await page.locator('#text-input').fill('{"a": 1}');
  } else {
    await page.locator('#file-input').setInputFiles({
      name: 'pixel.png',
      mimeType: 'image/png',
      buffer: PNG_1PX
    });
  }
  await page.locator('#convert-btn').click();
  await expect(page.locator(RESULT_SELECTOR[tool.name])).toBeVisible();
  await expect(page.locator('#feedback')).toBeVisible();
}

// One standard, one text-input, one multi-file tool. shared.js returns early for
// the non-standard ui_types, so this triples as a regression guard on
// initFeedback() being called ABOVE those guards.
const TOOLS = [
  { name: 'standard', url: '/convert/image-compress/', id: 'image-compress' },
  { name: 'text-input', url: '/convert/json-to-yaml/', id: 'json-to-yaml' },
  { name: 'multi-file', url: '/convert/bulk-image-compress/', id: 'bulk-image-compress' }
];

for (const tool of TOOLS) {
  test(`rating widget binds and POSTs on a ${tool.name} tool`, async ({ page }) => {
    const problems = collectPageProblems(page);
    const posts = interceptRatings(page);

    await convert(page, tool);
    const yes = page.locator('[data-feedback="yes"]');
    await expect(yes).toBeVisible();
    await yes.click();

    await expect.poll(() => posts.length).toBe(1);
    // D4/P3: the body is EXACTLY {tool_id, vote} — the dedup key is a server-side
    // salted IP hash, so no client fingerprint may ride along.
    expect(Object.keys(posts[0]).sort()).toEqual(['tool_id', 'vote']);
    expect(posts[0]).toEqual({ tool_id: tool.id, vote: 'yes' });

    // Widget collapses to its resolved display.
    await expect(yes).toBeHidden();
    await expect(page.locator('[data-feedback="no"]')).toBeHidden();
    await expect(page.locator('#feedback-prompt')).toBeHidden();
    await expect(page.locator('#feedback-score')).toBeVisible();

    expect(problems, problems.join('\n')).toEqual([]);
  });
}

test('a "no" vote sends vote:no and reveals the follow-up textarea', async ({ page }) => {
  const posts = interceptRatings(page);
  await convert(page, TOOLS[0]);
  await page.locator('[data-feedback="no"]').click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ tool_id: 'image-compress', vote: 'no' });

  // P2 §18 — the "no" follow-up, additive to the existing resolve.
  await expect(page.locator('#feedback-score')).toBeVisible();
  await expect(page.locator('#feedback-detail')).toBeVisible();
  await expect(page.locator('#feedback-text')).toBeFocused();
});

test('submitting the "no" follow-up POSTs to /ratings/feedback and shows thanks', async ({
  page
}) => {
  interceptRatings(page);
  const feedbackPosts = interceptRatings(page, { pathSuffix: '/feedback' });
  await convert(page, TOOLS[0]);

  await page.locator('[data-feedback="no"]').click();
  await expect(page.locator('#feedback-detail')).toBeVisible();

  await page.locator('#feedback-text').fill('the output was blank');
  await page.locator('#feedback-submit').click();

  await expect.poll(() => feedbackPosts.length).toBe(1);
  expect(feedbackPosts[0]).toEqual({
    tool_id: 'image-compress',
    feedback_text: 'the output was blank'
  });

  await expect(page.locator('#feedback-text')).toBeHidden();
  await expect(page.locator('#feedback-submit')).toBeHidden();
  await expect(page.locator('#feedback-detail-thanks')).toBeVisible();
});

test('the localStorage lock keeps the buttons hidden across a reload + fresh conversion', async ({
  page
}) => {
  interceptRatings(page);
  await convert(page, TOOLS[0]);
  await page.locator('[data-feedback="yes"]').click();
  await expect(page.locator('#feedback-score')).toBeVisible();

  // POLL, don't read once: the widget resolves optimistically and synchronously,
  // but the lock is deliberately deferred until the server confirms the vote, so
  // it lands a tick later. The lock stores the vote DIRECTION so the reload path
  // can reproduce the same count the vote showed.
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('fc_rated_image-compress')))
    .toBe('yes');

  // A plain reload resets .result to hidden (fresh page load, no file chosen) —
  // the resolved lock state is still applied by initFeedback() at load, it's
  // just invisible until the widget's container is shown again, so convert
  // once more to see it.
  await page.reload();
  await convert(page, TOOLS[0]);
  await expect(page.locator('[data-feedback="yes"]')).toBeHidden();
  await expect(page.locator('[data-feedback="no"]')).toBeHidden();

  // The resolved message must land in the INERT element: this path runs at
  // widget-init (DOMContentLoaded), and routing it through the live region
  // would make a screen reader announce it unprompted on every page load.
  await expect(page.locator('#feedback-baked')).toBeVisible();
  await expect(page.locator('#feedback-score')).toBeHidden();
  await expect(page.locator('#feedback-score')).toBeEmpty();
});

test('voting still resolves with the API unreachable, with no console error', async ({ page }) => {
  const problems = collectPageProblems(page);
  interceptRatings(page, { fulfil: false }); // aborted request === API down

  await convert(page, TOOLS[0]);
  // Wait for the request to actually FAIL before asserting the lock is absent —
  // otherwise "still null" would pass simply because the handler hadn't run yet.
  const failed = page.waitForEvent('requestfailed', {
    predicate: (r) => r.url().includes('/api/v1/ratings')
  });
  await page.locator('[data-feedback="yes"]').click();
  await failed;

  // Progressive enhancement: the .catch swallows the failure and the widget
  // still resolves optimistically.
  await expect(page.locator('#feedback-score')).toHaveText('Thanks for your feedback!');
  await expect(page.locator('[data-feedback="yes"]')).toBeHidden();
  expect(problems, problems.join('\n')).toEqual([]);

  // Nothing reached the server, so the vote must NOT be locked out — otherwise
  // anyone whose ad-blocker blocks the API origin is silently excluded forever.
  expect(
    await page.evaluate(() => window.localStorage.getItem('fc_rated_image-compress'))
  ).toBeNull();
  await page.reload();
  await convert(page, TOOLS[0]);
  await expect(page.locator('[data-feedback="yes"]')).toBeVisible();
});

test('a rate-limited vote is not locked out', async ({ page }) => {
  // 429 means the server did NOT record the vote (30/hr per IP). Locking on it
  // would be the same silent-discard bug as locking on a network failure.
  interceptRatings(page, { status: 429 });
  await convert(page, TOOLS[0]);
  // Anchor on the response landing, so a null lock means "declined to lock"
  // rather than "hasn't got there yet".
  const responded = page.waitForResponse(
    (r) => r.url().includes('/api/v1/ratings') && r.request().method() === 'POST'
  );
  await page.locator('[data-feedback="yes"]').click();
  await responded;
  await expect(page.locator('#feedback-score')).toBeVisible();

  expect(
    await page.evaluate(() => window.localStorage.getItem('fc_rated_image-compress'))
  ).toBeNull();
  // And the user can still vote next visit.
  await page.reload();
  await convert(page, TOOLS[0]);
  await expect(page.locator('[data-feedback="yes"]')).toBeVisible();
});

test('the resolved score line lays out on its own row without overflow', async ({ page }) => {
  // .feedback gained flex-wrap + a flex-basis:100% score line; a mistake here
  // would push every tool page into horizontal scroll at mobile widths.
  interceptRatings(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await convert(page, TOOLS[0]);

  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );

  const widget = page.locator('#feedback');
  const before = await widget.boundingBox();
  const overflowBefore = await overflow();

  await page.locator('[data-feedback="yes"]').click();

  const score = page.locator('#feedback-score');
  await expect(score).toBeVisible();
  const box = await score.boundingBox();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  // Sits within the widget's column rather than spilling out of it.
  expect(box.x + box.width).toBeLessThanOrEqual(before.x + before.width + 1);

  // Assert the DELTA, not an absolute zero. Tool pages carried a pre-existing
  // ~23px overflow at 320px from the slider read-out (`.tool-options__value`,
  // a flex min-width:auto trap) — nothing to do with this widget, and fixed
  // separately in its own PR. Measuring the delta keeps this test honest about
  // what it owns: the score line must add no overflow of its own, whether or
  // not that other fix has landed on this branch yet.
  expect(await overflow()).toBeLessThanOrEqual(overflowBefore);
});

test('no inline handlers and no device fingerprinting in the shipped rating path', async ({
  page
}) => {
  // The island is baked into every tool page's HTML regardless of the widget's
  // (now conversion-gated) visibility, so this doesn't need a conversion.
  await page.goto('/convert/image-compress/');

  const inlineHandlers = await page.evaluate(
    () =>
      [...document.querySelectorAll('*')].filter((el) =>
        [...el.attributes].some((a) => /^on[a-z]+$/i.test(a.name))
      ).length
  );
  expect(inlineHandlers).toBe(0);

  // The island is inert JSON data, never an executable script.
  const island = page.locator('#tool-ratings');
  if (await island.count()) {
    expect(await island.getAttribute('type')).toBe('application/json');
  }
});
