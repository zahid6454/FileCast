// Phase 5 auth.js E2E — hermetic (all API calls are page.route-mocked, so no
// dependency on live DB/session state). Covers P12 (no /me for anon), the
// idempotent /me getter, the favorites heart, the doubled-limit mutation, the
// post-conversion event decision table, and the banner caps/snooze.
const { test, expect } = require('@playwright/test');

const TOOL = '/convert/csv-to-json/'; // a text tool: baked max_file_size = 5 MB

function signedInUser(overrides) {
  return Object.assign(
    {
      id: 'u1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      role: 'user',
      avatar_url: null,
      max_file_size: null,
      favorites: [],
      preferences: {}
    },
    overrides || {}
  );
}

async function mockMe(page, user, counter) {
  await page.route('**/api/v1/auth/me', (route) => {
    if (counter) counter.n++;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user })
    });
  });
}

async function signIn(context) {
  await context.addCookies([{ name: 'fc_logged_in', value: '1', domain: '127.0.0.1', path: '/' }]);
}

test('P12: an anonymous visitor triggers ZERO /me network', async ({ page }) => {
  const me = { n: 0 };
  await page.route('**/api/v1/auth/me', (route) => {
    me.n++;
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(TOOL);
  await page.waitForSelector('#user-menu .user-menu__signin'); // header sign-in button
  await page.waitForTimeout(300);
  expect(me.n).toBe(0);
});

test('signed-in: name + favorited heart, /me fetched exactly once', async ({ page, context }) => {
  await signIn(context);
  const me = { n: 0 };
  await mockMe(page, signedInUser({ favorites: ['csv-to-json'] }), me);
  await page.goto(TOOL);
  await expect(page.locator('.user-menu__name')).toHaveText('Ada Lovelace');
  await expect(page.locator('#tool-fav')).toBeVisible();
  await expect(page.locator('#tool-fav')).toHaveClass(/is-fav/); // already favorited
  await page.waitForTimeout(200);
  expect(me.n).toBe(1); // idempotent getter → single fetch shared by menu + heart
});

test('doubled limit: a signed-in user gets 2× the baked TOOL_CONFIG bytes', async ({
  page,
  context
}) => {
  await signIn(context);
  await mockMe(page, signedInUser());
  await page.goto(TOOL);
  const bytes = await page.evaluate(() => window.TOOL_CONFIG.max_file_size_bytes);
  expect(bytes).toBe(10 * 1024 * 1024); // 5 MB baked → 10 MB signed-in
});

test('anonymous post-conversion → banner appears', async ({ page }) => {
  await page.goto(TOOL);
  await page.evaluate(() =>
    document.dispatchEvent(new CustomEvent('filecast:conversion', { detail: { saved: false } }))
  );
  await expect(page.locator('.signin-banner')).toBeVisible();
});

test('banner respects snooze after a dismiss and the ≥3 cap', async ({ page }) => {
  await page.goto(TOOL);
  await page.evaluate(() =>
    document.dispatchEvent(new CustomEvent('filecast:conversion', { detail: { saved: false } }))
  );
  await expect(page.locator('.signin-banner')).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.locator('.signin-banner')).toHaveCount(0);

  // A dismiss sets a 7-day snooze → banner stays away on the next conversion.
  await page.reload();
  await page.evaluate(() =>
    document.dispatchEvent(new CustomEvent('filecast:conversion', { detail: { saved: false } }))
  );
  await page.waitForTimeout(150);
  await expect(page.locator('.signin-banner')).toHaveCount(0);

  // Hard cap: ≥3 dismisses → never again, even with snooze cleared.
  await page.evaluate(() => {
    localStorage.setItem('fc_signin_banner_dismisses', '3');
    localStorage.setItem('fc_signin_banner_snooze_until', '0');
  });
  await page.reload();
  await page.evaluate(() =>
    document.dispatchEvent(new CustomEvent('filecast:conversion', { detail: { saved: false } }))
  );
  await page.waitForTimeout(150);
  await expect(page.locator('.signin-banner')).toHaveCount(0);
});

test('signed-in + saved → "Saved ✓"; signed-in + not saved → nothing', async ({
  page,
  context
}) => {
  await signIn(context);
  await mockMe(page, signedInUser());

  await page.goto(TOOL);
  await page.evaluate(() =>
    document.dispatchEvent(new CustomEvent('filecast:conversion', { detail: { saved: true } }))
  );
  await expect(page.locator('.signin-saved')).toBeVisible();

  // saved:false for a signed-in user must show neither a badge nor a banner.
  await page.reload();
  await page.evaluate(() =>
    document.dispatchEvent(new CustomEvent('filecast:conversion', { detail: { saved: false } }))
  );
  await page.waitForTimeout(150);
  await expect(page.locator('.signin-saved')).toHaveCount(0);
  await expect(page.locator('.signin-banner')).toHaveCount(0);
});
