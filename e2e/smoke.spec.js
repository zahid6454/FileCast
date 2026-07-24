import { expect, test } from '@playwright/test';

// Phase 3 E2E smoke. Runs against the static `dist/` (see playwright.config.js).
// The local server does NOT enforce the CSP, so "zero CSP violations" is a
// deploy-preview check (Phase 7). Here we assert no console *errors* and that
// the markup contract (external SRI'd JS, no inline handlers) actually works.

// The seven DoD widths (03-phase3 §9 step 1).
const WIDTHS = [320, 375, 480, 768, 1024, 1200, 1440];

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

test('the "Why sign in?" band shows for anonymous visitors and hides when signed in', async ({
  page
}) => {
  // Anonymous (no fc_logged_in cookie): the account pitch is visible with a
  // working sign-in CTA pointing at the OAuth start.
  await page.goto('/');
  const band = page.locator('.signin-band');
  await expect(band).toBeVisible();
  await expect(band.locator('.btn--google')).toHaveAttribute('href', /\/api\/v1\/auth\/google/);

  // Signed-in visitors don't need the pitch. theme-init.js stamps data-auth from
  // the cookie in <head>, and the CSS hides the band on [data-auth="in"] —
  // asserted directly so the test doesn't need a live /me round-trip.
  await page.evaluate(() => document.documentElement.setAttribute('data-auth', 'in'));
  await expect(band).toBeHidden();
});

test('mobile hamburger opens the drawer without leaking horizontal scroll', async ({ page }) => {
  await page.goto('/');
  await page.setViewportSize({ width: 375, height: 800 });

  const hamburger = page.locator('#hamburger');
  await expect(hamburger).toBeVisible();

  // Closed: the off-canvas drawer must not extend the page.
  let overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, 'overflow with drawer closed').toBeLessThanOrEqual(1);

  await hamburger.click();
  await expect(page.locator('#nav-drawer')).toHaveClass(/header__nav--open/);
  await expect(hamburger).toHaveAttribute('aria-expanded', 'true');

  // Open: still no horizontal scroll.
  overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, 'overflow with drawer open').toBeLessThanOrEqual(1);

  // Escape closes it and restores aria-expanded.
  await page.keyboard.press('Escape');
  await expect(hamburger).toHaveAttribute('aria-expanded', 'false');
});

test('tool page renders and the slider markup carries no inline handler', async ({ page }) => {
  const problems = collectPageProblems(page);
  await page.goto('/convert/json-to-yaml/');
  await expect(page.locator('#convert-btn')).toBeVisible();
  // The F4 fix: no inline oninput anywhere on a tool page.
  const inlineHandlers = await page.evaluate(() => document.querySelectorAll('[oninput]').length);
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

// A 1x1 transparent PNG (valid image the browser can decode).
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

test('F4: the range read-out updates from JS (no inline handler) on a MULTI-FILE tool (R3)', async ({
  page
}) => {
  // bulk-image-compress is ui_type: multi-file — its slider only binds because
  // initToolOptions() runs BEFORE shared.js's standard-only early return.
  await page.goto('/convert/bulk-image-compress/');
  const slider = page.locator('#opt-quality');
  const readout = page.locator('#val-quality');
  await expect(readout).toHaveText('75%');

  await slider.focus();
  await page.keyboard.press('ArrowLeft'); // fires a real `input` event
  const value = await slider.inputValue();
  expect(Number(value)).toBeLessThan(75);
  await expect(readout).toHaveText(value + '%');
});

test('upload-zone selection flow still works after the redesign (standard tool)', async ({
  page
}) => {
  await page.goto('/convert/image-compress/');
  await expect(page.locator('.upload-zone__cta')).toBeVisible();
  await expect(page.locator('#convert-btn')).toBeDisabled();

  await page.locator('#file-input').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: PNG_1PX
  });

  // Selecting a valid file moves the state machine: zone hides, file-info shows,
  // convert enables — the CTA span didn't double-fire or break selection.
  await expect(page.locator('#upload-zone')).toBeHidden();
  await expect(page.locator('#file-info')).toBeVisible();
  await expect(page.locator('#convert-btn')).toBeEnabled();
});

test('hero search fetches tool-data.json only on the homepage, not on a tool page (P21)', async ({
  page
}) => {
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
