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

  test('non-admin → no-access screen, no tabs', async ({ page }) => {
    const state = makeState({ me: { status: 200, body: { user: { id: 'u2', email: 'user@dev.local', role: 'user' } } } });
    await installApi(page, state);
    await page.goto('/admin/');
    await expect(page.locator('.admin-gate__title')).toHaveText('No access');
    await expect(page.locator('.admin-tabs')).toHaveCount(0);
  });

  test('admin → full panel with all four tabs', async ({ page }) => {
    const state = makeState();
    await installApi(page, state);
    await page.goto('/admin/');
    await expect(page.locator('.admin-topbar__brand')).toBeVisible();
    await expect(page.locator('.admin-tabs__link')).toHaveCount(4);
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
