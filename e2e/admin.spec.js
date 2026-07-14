import { test, expect } from '@playwright/test';
import { makeState, installApi } from './admin-mock.js';

// Admin-panel E2E (Phase 4 §Test plan). Served from the static `dist/`; the API
// is mocked hermetically (see admin-mock.js) so these run without a live backend.
// Covers: the auth gate, tool toggle-persist + single-PUT reorder + deploy flow,
// announcements CRUD + one-active, the 501 deploy degrading to a banner (not an
// error), the dashboard rendering from ONE bulk /ratings call, and P23 inertness.

const NETWORK_NOISE = /Failed to load resource|net::ERR_|ERR_[A-Z_]+/i;

function collectProblems(page) {
  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !NETWORK_NOISE.test(msg.text())) {
      problems.push('console.error: ' + msg.text());
    }
  });
  page.on('pageerror', (err) => problems.push('pageerror: ' + err.message));
  return problems;
}

test.describe('auth gate (D6)', () => {
  test('anonymous → sign-in screen, no tabs', async ({ page }) => {
    const state = makeState({ me: { status: 401 } });
    await installApi(page, state);
    await page.goto('/admin/');
    await expect(page.locator('.admin-gate__title')).toHaveText('FileCast Admin');
    await expect(page.getByText('Sign in to access')).toBeVisible();
    await expect(page.locator('.admin-tabs')).toHaveCount(0);
  });

  test('non-admin → no-access screen, no tabs, with a sign-out escape (not a dead-end)', async ({ page }) => {
    const state = makeState({ me: { status: 200, body: { user: { id: 'u2', email: 'user@dev.local', role: 'user' } } } });
    await installApi(page, state);
    await page.goto('/admin/');
    await expect(page.locator('.admin-gate__title')).toHaveText('No access');
    await expect(page.locator('.admin-tabs')).toHaveCount(0);

    // A signed-in non-admin must be able to sign out and reach the sign-in
    // screen (to switch to an admin account) — no dead-end.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.locator('.admin-gate__title')).toHaveText('FileCast Admin');
    await expect(page.getByText('Dev login as admin')).toBeVisible();
  });

  test('admin → full panel with all four tabs', async ({ page }) => {
    const state = makeState();
    await installApi(page, state);
    await page.goto('/admin/');
    await expect(page.locator('.admin-topbar__brand')).toBeVisible();
    await expect(page.locator('.admin-tabs__link')).toHaveCount(4);
  });

  test('mid-session 401/403 drops back to the sign-in gate (R8)', async ({ page }) => {
    const state = makeState();
    await installApi(page, state);
    await page.goto('/admin/#tools');
    await expect(page.locator('.admin-tabs__link')).toHaveCount(4);

    // Session expires mid-session: /me now 401 and any mutation 403.
    state.me = { status: 401 };
    state.failAuth = true;

    await page.locator('.admin-toollist .admin-switch').first().click();
    // The 403 routes through the gate → sign-in, tabs gone. No stuck panel.
    await expect(page.locator('.admin-gate__title')).toHaveText('FileCast Admin');
    await expect(page.locator('.admin-tabs')).toHaveCount(0);
  });
});

test.describe('dashboard', () => {
  test('renders stat cards, an SVG chart, and the ratings summary from ONE /ratings call', async ({ page }) => {
    const state = makeState();
    await installApi(page, state);
    await page.goto('/admin/#dashboard');

    await expect(page.locator('.admin-stat').first()).toBeVisible();
    await expect(page.locator('.admin-stat')).toHaveCount(4);
    // Inline SVG charts, no library.
    await expect(page.locator('svg.admin-chart').first()).toBeVisible();
    // Ratings summary populated.
    await expect(page.locator('.admin-ratings tbody tr')).toHaveCount(2);
    // The bulk endpoint was hit exactly once (not one-per-tool).
    expect(state.ratingsCalls).toBe(1);
  });

  test('P23: attacker-controlled error_message renders inert (no XSS)', async ({ page }) => {
    const state = makeState();
    await installApi(page, state);
    await page.goto('/admin/#dashboard');
    const msg = page.locator('.admin-errfeed__msg').first();
    await expect(msg).toBeVisible();
    // Rendered literally as text — no <img> element injected, no handler fired.
    await expect(msg).toHaveText('<img src=x onerror="window.__xss=1">');
    expect(await msg.locator('img').count()).toBe(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });
});

test.describe('tools', () => {
  test('toggle disables a tool and persists on reload', async ({ page }) => {
    const state = makeState();
    await installApi(page, state);
    await page.goto('/admin/#tools');

    const firstSwitch = page.locator('.admin-toollist .admin-switch').first();
    await expect(firstSwitch).toHaveAttribute('aria-checked', 'true');
    await firstSwitch.click();
    await expect(firstSwitch).toHaveAttribute('aria-checked', 'false');

    // Server state actually mutated.
    expect(state.tools.find((t) => t.id === 'img-a').enabled).toBe(false);
    // A deploy was fired (→ 501 → banner), and the save banner is visible.
    await expect(page.locator('.admin-banner--info')).toBeVisible();

    // Reload → the disabled state persists (came back from GET /tools).
    await page.reload();
    await page.goto('/admin/#tools');
    await expect(page.locator('.admin-toollist .admin-switch').first()).toHaveAttribute('aria-checked', 'false');
  });

  test('keyboard reorder sends exactly ONE PUT /tools/reorder with the full global order', async ({ page }) => {
    const state = makeState();
    await installApi(page, state);
    await page.goto('/admin/#tools');

    // Move the first image tool down one slot within its category.
    const firstRow = page.locator('.admin-toollist[data-category="image"] .admin-tool').first();
    await firstRow.locator('.admin-tool__down').click();

    await expect.poll(() => state.reorderCalls.length).toBe(1);
    const order = state.reorderCalls[0];
    // Full global order (all 5 ids), image-a and image-b swapped, categories intact.
    expect(order).toEqual(['img-b', 'img-a', 'img-c', 'doc-a', 'doc-b']);
    await expect(page.locator('.admin-banner--info')).toBeVisible();
  });

  test('reorder to a category boundary keeps focus on a move button (not <body>)', async ({ page }) => {
    const state = makeState();
    await installApi(page, state);
    await page.goto('/admin/#tools');

    const imgA = page.locator('.admin-tool[data-tool-id="img-a"]');
    // 3 image tools → two ▼ presses land img-a at the bottom of its category.
    await imgA.locator('.admin-tool__down').click();
    await imgA.locator('.admin-tool__down').click();
    // Its ▼ is now disabled; focus must fall back to the still-enabled ▲, not <body>.
    await expect(imgA.locator('.admin-tool__down')).toBeDisabled();
    await expect(imgA.locator('.admin-tool__up')).toBeFocused();
  });

  test('slide-out edits a display name → PUT /tools/{id}', async ({ page }) => {
    const state = makeState();
    await installApi(page, state);
    await page.goto('/admin/#tools');

    await page.locator('.admin-tool__name').first().click();
    const panel = page.locator('.admin-slideout');
    await expect(panel).toBeVisible();
    await panel.locator('#so-name').fill('Renamed Tool');
    await panel.getByRole('button', { name: 'Save changes' }).click();

    await expect.poll(() => state.tools.find((t) => t.id === 'img-a').display_name).toBe('Renamed Tool');
    await expect(page.locator('.admin-banner--info')).toBeVisible();
  });

  test('slide-out is a real modal: aria-modal, inert background, Escape closes, focus restored', async ({ page }) => {
    const state = makeState();
    await installApi(page, state);
    await page.goto('/admin/#tools');

    const opener = page.locator('.admin-tool__name').first();
    await opener.click();
    const panel = page.locator('.admin-slideout');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('aria-modal', 'true');
    // Background is inert while the dialog is open (Tab can't reach it).
    await expect(page.locator('#admin-app')).toHaveJSProperty('inert', true);

    // Escape closes it, background is interactive again, and focus returns to the opener.
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page.locator('#admin-app')).toHaveJSProperty('inert', false);
    await expect(opener).toBeFocused();
  });
});

test.describe('announcements', () => {
  test('CRUD with the one-active rule reflected', async ({ page }) => {
    const state = makeState();
    await installApi(page, state);
    await page.goto('/admin/#announcements');

    await expect(page.getByText('No announcements yet')).toBeVisible();

    // Create #1 (active).
    await page.getByRole('button', { name: '+ New announcement' }).click();
    await page.locator('.admin-form .admin-input').first().fill('First announcement');
    await page.locator('.admin-form .admin-check input[type="checkbox"]').check();
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.locator('.admin-annc')).toHaveCount(1);
    await expect(page.locator('.admin-badge--active')).toHaveCount(1);

    // Create #2 (also active) → the server deactivates #1; UI reflects after re-fetch.
    await page.getByRole('button', { name: '+ New announcement' }).click();
    await page.locator('.admin-form .admin-input').first().fill('Second announcement');
    await page.locator('.admin-form .admin-check input[type="checkbox"]').check();
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.locator('.admin-annc')).toHaveCount(2);
    await expect(page.locator('.admin-badge--active')).toHaveCount(1); // still only one active

    // Delete one.
    await page.locator('.admin-annc').first().getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.admin-annc')).toHaveCount(1);
  });

  test('saves schedule datetimes as explicit UTC ISO strings (R18)', async ({ page }) => {
    const state = makeState();
    await installApi(page, state);
    await page.goto('/admin/#announcements');

    await page.getByRole('button', { name: '+ New announcement' }).click();
    await page.locator('.admin-form .admin-input').first().fill('Scheduled');
    // datetime-local takes naive local "YYYY-MM-DDTHH:mm".
    await page.locator('input[type="datetime-local"]').first().fill('2026-08-01T09:30');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect.poll(() => state.lastAnnouncementBody && state.lastAnnouncementBody.starts_at).toBeTruthy();
    const startsAt = state.lastAnnouncementBody.starts_at;
    // Sent as an explicit UTC instant (trailing Z), not the naive local string.
    expect(startsAt).toMatch(/Z$/);
    expect(new Date(startsAt).toISOString()).toBe(startsAt);
    // And it round-trips back to the same local wall-clock the operator typed.
    const d = new Date(startsAt);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(30);
  });

  test('P23: a javascript: link is rendered inert in the preview', async ({ page }) => {
    const state = makeState({
      announcements: [
        { id: 1, message: 'Hi', link: 'javascript:window.__xss2=1', type: 'info', active: true, starts_at: null, ends_at: null, created_at: '2026-07-13T00:00:00Z' },
      ],
    });
    await installApi(page, state);
    await page.goto('/admin/#announcements');
    const link = page.locator('.announcement-bar__link').first();
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '#'); // safeHref neutralized it
    expect(await page.evaluate(() => window.__xss2)).toBeUndefined();
  });
});

test.describe('users', () => {
  test('lists users, filters client-side, detail has NO role-change control (D9)', async ({ page }) => {
    const state = makeState();
    await installApi(page, state);
    await page.goto('/admin/#users');

    await expect(page.locator('.admin-users tbody tr')).toHaveCount(2);
    await page.locator('.admin-users__search').fill('admin@');
    await expect(page.locator('.admin-users tbody tr')).toHaveCount(1);

    await page.locator('.admin-users__row').first().click();
    await expect(page.getByText('managed by an operator')).toBeVisible();
    // No promotion control of any kind.
    expect(await page.getByRole('button', { name: /make admin|promote|change role/i }).count()).toBe(0);
  });
});

test('fresh/empty DB renders placeholders with no throw (§8.5)', async ({ page }) => {
  const problems = collectProblems(page);
  const state = makeState({
    dashboard: { total_conversions: 0, total_failures: 0, total_users: 2, total_ratings: 0, yes_ratings: 0, top_tools: [] },
    series: [],
    errors: [],
    ratings: [],
    announcements: [],
  });
  await installApi(page, state);

  await page.goto('/admin/#dashboard');
  await expect(page.locator('.admin-stat')).toHaveCount(4); // zeros, not blank
  await expect(page.getByText('No data yet').first()).toBeVisible(); // chart placeholders
  await expect(page.getByText('No ratings yet')).toBeVisible();
  await expect(page.getByText('No errors')).toBeVisible();

  await page.goto('/admin/#announcements');
  await expect(page.getByText('No announcements yet')).toBeVisible();

  // Tools is never empty (seeded), and the switch/rows still render.
  await page.goto('/admin/#tools');
  await expect(page.locator('.admin-tool').first()).toBeVisible();

  expect(problems, problems.join('\n')).toEqual([]);
});

test('the whole admin session produces no JS exceptions or console errors', async ({ page }) => {
  const problems = collectProblems(page);
  const state = makeState();
  await installApi(page, state);
  for (const hash of ['#dashboard', '#tools', '#announcements', '#users']) {
    await page.goto('/admin/' + hash);
    await expect(page.locator('.admin-main')).toBeVisible();
  }
  expect(problems, problems.join('\n')).toEqual([]);
});
