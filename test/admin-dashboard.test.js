import { describe, expect, it, vi } from 'vitest';
import { createDom, evalScript, flush } from './helpers.js';

// Dashboard tab (admin/dashboard.js): 4 widgets loaded in parallel via
// Promise.allSettled — one failed call degrades to its own error card
// instead of blanking the whole tab (R12), and any auth failure among the
// 4 bubbles up to the global gate.

function makeResponse(status, body) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body))
  });
}

const DASHBOARD_STATS = {
  total_conversions: 100,
  total_failures: 10,
  total_users: 5,
  total_ratings: 20,
  yes_ratings: 15,
  top_tools: [{ tool_id: 'jpg-to-png', count: 42 }]
};

function load(routeFor) {
  const dom = createDom('<div id="c"></div>');
  dom.window.FILECAST = { apiBase: 'https://api.test' };
  dom.window.fetch = (url) => routeFor(url);
  evalScript(dom, 'admin/dom.js');
  evalScript(dom, 'admin/api.js');
  evalScript(dom, 'admin/dashboard.js');
  const ADMIN = dom.window.ADMIN;
  ADMIN.onAuthError = vi.fn();
  return dom;
}

function defaultRoutes(url) {
  if (url.includes('/stats/dashboard')) return makeResponse(200, DASHBOARD_STATS);
  if (url.includes('/stats/conversions')) return makeResponse(200, { series: [] });
  if (url.includes('/stats/errors')) return makeResponse(200, { errors: [] });
  if (url.includes('/ratings')) return makeResponse(200, []);
  return makeResponse(404, {});
}

describe('admin/dashboard.js', () => {
  it('registers on ADMIN.tabs with a render function', () => {
    const dom = load(defaultRoutes);
    expect(typeof dom.window.ADMIN.tabs.dashboard.render).toBe('function');
  });

  it('renders stat cards from the dashboard payload', async () => {
    const dom = load(defaultRoutes);
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.dashboard.render(c);
    await flush();

    const values = Array.from(c.querySelectorAll('.admin-stat__value')).map((el) => el.textContent);
    expect(values).toContain('100'); // total_conversions
    expect(values).toContain('10'); // total_failures
    expect(values).toContain('5'); // total_users
  });

  it('degrades only the failed widget when one of the 4 calls fails (R12)', async () => {
    const dom = load((url) => {
      if (url.includes('/ratings')) return makeResponse(500, { detail: 'boom' });
      return defaultRoutes(url);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.dashboard.render(c);
    await flush();

    // Stats still rendered despite the ratings failure.
    expect(c.querySelectorAll('.admin-stat__value').length).toBeGreaterThan(0);
    // The failed section shows its own error card with a Retry button.
    expect(c.textContent).toContain("Couldn't load this section.");
  });

  it('bubbles an auth failure from any of the 4 calls to ADMIN.onAuthError', async () => {
    const dom = load((url) => {
      if (url.includes('/ratings')) return makeResponse(401, {});
      return defaultRoutes(url);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.dashboard.render(c);
    await flush();

    expect(dom.window.ADMIN.onAuthError).toHaveBeenCalled();
    // Must not also render the degraded dashboard behind the gate.
    expect(c.querySelectorAll('.admin-stat__value')).toHaveLength(0);
  });
});
