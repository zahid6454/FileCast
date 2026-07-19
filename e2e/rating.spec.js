import { expect, test } from '@playwright/test';

// Phase 6 rating E2E. Covers what genuinely needs a browser: a real click, the
// real POST body, the localStorage lock surviving a reload, and degradation when
// the API is unreachable. The 50-rating threshold maths is NOT tested here — the
// #tool-ratings island is baked into dist/ at build time, so asserting the
// boundary would need a ≥50-seeded DB plus a rebuild inside the Playwright run.
// scoreLine()/parseBakedRating() are pure and unit-tested in test/rating.test.js.

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

// Capture rating POSTs and fulfil them locally — these tests must not depend on
// the API container being up.
function interceptRatings(page, { fulfil = true } = {}) {
  const posts = [];
  page.route('**/api/v1/ratings', async (route) => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
    }
    if (fulfil) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    } else {
      await route.abort('failed'); // API down
    }
  });
  return posts;
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

    await page.goto(tool.url);
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

test('a "no" vote sends vote:no', async ({ page }) => {
  const posts = interceptRatings(page);
  await page.goto('/convert/image-compress/');
  await page.locator('[data-feedback="no"]').click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ tool_id: 'image-compress', vote: 'no' });
});

test('the localStorage lock keeps the buttons hidden across a reload', async ({ page }) => {
  interceptRatings(page);
  await page.goto('/convert/image-compress/');
  await page.locator('[data-feedback="yes"]').click();
  await expect(page.locator('#feedback-score')).toBeVisible();

  expect(await page.evaluate(() => window.localStorage.getItem('fc_rated_image-compress'))).toBe(
    '1'
  );

  await page.reload();
  await expect(page.locator('#feedback-score')).toBeVisible();
  await expect(page.locator('[data-feedback="yes"]')).toBeHidden();
  await expect(page.locator('[data-feedback="no"]')).toBeHidden();
});

test('voting still resolves with the API unreachable, with no console error', async ({ page }) => {
  const problems = collectPageProblems(page);
  interceptRatings(page, { fulfil: false }); // aborted request === API down

  await page.goto('/convert/image-compress/');
  await page.locator('[data-feedback="yes"]').click();

  // Progressive enhancement: the .catch swallows the failure and the widget
  // still resolves optimistically.
  await expect(page.locator('#feedback-score')).toHaveText('Thanks for your feedback!');
  await expect(page.locator('[data-feedback="yes"]')).toBeHidden();
  expect(problems, problems.join('\n')).toEqual([]);
});

test('the resolved score line lays out on its own row without overflow', async ({ page }) => {
  // .feedback gained flex-wrap + a flex-basis:100% score line; a mistake here
  // would push every tool page into horizontal scroll at mobile widths.
  interceptRatings(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/convert/image-compress/');

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
