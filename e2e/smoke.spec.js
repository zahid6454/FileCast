import { test, expect } from '@playwright/test';

// Phase 3 E2E smoke. Runs against the static `dist/` (see playwright.config.js).
// The local server does NOT enforce the CSP, so "zero CSP violations" is a
// deploy-preview check (Phase 7). Here we assert no console *errors* and that
// the markup contract (external SRI'd JS, no inline handlers) actually works.

const WIDTHS = [320, 768, 1200];

// External hosts (Google Fonts, the announcement API) are unreachable in the
// offline test env, so the browser logs "Failed to load resource" for them.
// Those are network failures, NOT app errors — and the CSP/font checks they'd
// stand in for are deploy-preview-only anyway (Phase 7). We ignore resource-load
// failures and assert on real JS exceptions + genuine console errors (e.g. a CSP
// violation message, an uncaught throw).
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

test('homepage renders with no horizontal overflow across breakpoints', async ({ page }) => {
  const problems = collectPageProblems(page);
  await page.goto('/');
  await expect(page.locator('.hero--home')).toBeVisible();
  await expect(page.locator('#hero-search')).toBeVisible();

  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, `horizontal overflow at ${w}px`).toBeLessThanOrEqual(1);
  }
  expect(problems, problems.join('\n')).toEqual([]);
});

test('tool page renders and the slider markup carries no inline handler', async ({ page }) => {
  const problems = collectPageProblems(page);
  await page.goto('/convert/json-to-yaml/');
  await expect(page.locator('#convert-btn')).toBeVisible();
  // The F4 fix: no inline oninput anywhere on a tool page.
  const inlineHandlers = await page.evaluate(() =>
    document.querySelectorAll('[oninput]').length
  );
  expect(inlineHandlers).toBe(0);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('a client-side converter still works end-to-end (regression guard)', async ({ page }) => {
  const problems = collectPageProblems(page);
  await page.goto('/convert/json-to-yaml/');

  await page.locator('#text-input').fill('{"hello": "world", "n": 1}');
  await page.locator('#convert-btn').click();

  const output = page.locator('#text-output');
  await expect(page.locator('#text-result')).toBeVisible();
  await expect(output).toHaveValue(/hello:\s*world/);

  expect(problems, problems.join('\n')).toEqual([]);
});

test('hero search fetches tool-data.json only on the homepage, not on a tool page (P21)', async ({ page }) => {
  const homeRequests = [];
  page.on('request', (r) => {
    if (r.url().includes('tool-data.json')) homeRequests.push(r.url());
  });
  await page.goto('/');
  // The fetch is triggered on load where #hero-search exists.
  await page.waitForTimeout(300);
  expect(homeRequests.length).toBeGreaterThanOrEqual(1);

  const toolRequests = [];
  page.on('request', (r) => {
    if (r.url().includes('tool-data.json')) toolRequests.push('tool:' + r.url());
  });
  await page.goto('/convert/json-to-yaml/');
  await page.waitForTimeout(300);
  expect(toolRequests).toEqual([]);
});
