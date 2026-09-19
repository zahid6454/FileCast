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
  total_unique_visitors: 55
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
  ADMIN.catalog = { list: [{ id: 'jpg-to-png', name: 'JPG to PNG' }], label: (id) => id };
  return dom;
}

// NOTE: '/stats/errors/summary' must be checked before the bare '/stats/errors'
// substring match below (the latter is also a substring of the former).
function defaultRoutes(url) {
  if (url.includes('/stats/dashboard')) return makeResponse(200, DASHBOARD_STATS);
  if (url.includes('/stats/top-tools')) {
    return makeResponse(200, { top_tools: [{ tool_id: 'jpg-to-png', count: 42, visitors: 30 }] });
  }
  if (url.includes('/stats/signups')) return makeResponse(200, []);
  if (url.includes('/stats/errors/summary')) {
    return makeResponse(200, { by_type: [], by_tool: [], retention_days: 30 });
  }
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
    expect(values).toContain('55'); // total_unique_visitors
  });

  it('recent errors: fetches only 10 and links out to the full #errors tab', async () => {
    const requestedUrls = [];
    const dom = load((url) => {
      requestedUrls.push(url);
      if (url.includes('/stats/errors')) {
        return makeResponse(200, { errors: [{ tool_id: 'jpg-to-png', error_message: 'boom' }] });
      }
      return defaultRoutes(url);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.dashboard.render(c);
    await flush();

    expect(requestedUrls.some((u) => u.includes('/stats/errors?limit=10'))).toBe(true);
    const viewAll = c.querySelector('.admin-card__action');
    expect(viewAll).not.toBeNull();
    expect(viewAll.getAttribute('href')).toBe('#errors');
  });

  it('recent errors: hides "View all" when there are no errors to page into', async () => {
    const dom = load(defaultRoutes); // defaultRoutes returns { errors: [] }
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.dashboard.render(c);
    await flush();

    expect(c.querySelector('.admin-card__action')).toBeNull();
    expect(c.textContent).toContain('No errors');
  });

  it('ratings table caps at the top 10 by total votes', async () => {
    const manyRatings = Array.from({ length: 15 }, (_, i) => ({
      tool_id: 'tool-' + i,
      yes: i, // tool-14 has the most votes (14), tool-0 the fewest (0)
      no: 0
    }));
    const dom = load((url) => {
      if (url.includes('/ratings')) return makeResponse(200, manyRatings);
      return defaultRoutes(url);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.dashboard.render(c);
    await flush();

    const rows = c.querySelectorAll('.admin-ratings tbody tr');
    expect(rows.length).toBe(10);
    // Highest-vote tool sorts first; a tool outside the top 10 (0 votes) is dropped.
    expect(rows[0].textContent).toContain('tool-14');
    expect(c.textContent).not.toContain('tool-0');
  });

  it('conversion chart dots expose date/count/failures via a hover tooltip', async () => {
    const dom = load((url) => {
      if (url.includes('/stats/conversions')) {
        return makeResponse(200, { series: [{ date: '2026-07-10', count: 5, failures: 1 }] });
      }
      return defaultRoutes(url);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.dashboard.render(c);
    await flush();

    const hit = c.querySelector('.admin-chart__hit');
    expect(hit).not.toBeNull();
    expect(hit.getAttribute('aria-label')).toBe('2026-07-10: 5 conversions, 1 failure');

    const tip = c.querySelector('.admin-chart__tooltip');
    expect(tip).not.toBeNull();
    expect(tip.classList.contains('is-visible')).toBe(false);

    hit.dispatchEvent(new dom.window.Event('pointerenter'));
    expect(tip.classList.contains('is-visible')).toBe(true);
    expect(tip.textContent).toBe('2026-07-10: 5 conversions, 1 failure');

    hit.dispatchEvent(new dom.window.Event('pointerleave'));
    expect(tip.classList.contains('is-visible')).toBe(false);
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

  it('filter bar defaults to 30 days / all tools and refetches on range change', async () => {
    const requestedUrls = [];
    const dom = load((url) => {
      requestedUrls.push(url);
      return defaultRoutes(url);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.dashboard.render(c);
    await flush();

    const rangeSelect = c.querySelector('.admin-filterbar select[aria-label="Date range"]');
    expect(rangeSelect.value).toBe('30');
    expect(requestedUrls.some((u) => u.includes('/stats/conversions?days=30&group_by=day'))).toBe(
      true
    );

    requestedUrls.length = 0;
    rangeSelect.value = '365';
    rangeSelect.dispatchEvent(new dom.window.Event('change'));
    await flush();

    expect(
      requestedUrls.some((u) => u.includes('/stats/conversions?days=365&group_by=month'))
    ).toBe(true);
    expect(requestedUrls.some((u) => u.includes('/stats/top-tools?days=365'))).toBe(true);
    expect(requestedUrls.some((u) => u.includes('/stats/signups?days=365'))).toBe(true);
  });

  it('tool filter adds tool_id to Conversions and Errors, but not Top tools/New signups', async () => {
    const requestedUrls = [];
    const dom = load((url) => {
      requestedUrls.push(url);
      return defaultRoutes(url);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.dashboard.render(c);
    await flush();

    requestedUrls.length = 0;
    const toolSelect = c.querySelector('.admin-filterbar select[aria-label="Tool"]');
    toolSelect.value = 'jpg-to-png';
    toolSelect.dispatchEvent(new dom.window.Event('change'));
    await flush();

    expect(
      requestedUrls.some(
        (u) => u.includes('/stats/conversions') && u.includes('tool_id=jpg-to-png')
      )
    ).toBe(true);
    expect(
      requestedUrls.some(
        (u) => u.includes('/stats/errors/summary') && u.includes('tool_id=jpg-to-png')
      )
    ).toBe(true);
    expect(requestedUrls.some((u) => u.includes('/stats/top-tools') && u.includes('tool_id'))).toBe(
      false
    );
    expect(requestedUrls.some((u) => u.includes('/stats/signups') && u.includes('tool_id'))).toBe(
      false
    );
  });

  it('errors summary shows the validation/conversion split and a retention caption past the window', async () => {
    const dom = load((url) => {
      if (url.includes('/stats/errors/summary')) {
        return makeResponse(200, {
          by_type: [
            { error_type: 'validation_error', count: 3 },
            { error_type: 'conversion_error', count: 7 }
          ],
          by_tool: [{ tool_id: 'jpg-to-png', count: 5 }],
          retention_days: 30
        });
      }
      return defaultRoutes(url);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.dashboard.render(c);
    await flush();

    const summary = c.querySelector('.admin-errsummary');
    expect(summary.textContent).toContain('3');
    expect(summary.textContent).toContain('7');
    expect(summary.textContent).not.toContain('retained'); // 30-day range == 30-day retention, no caption

    const rangeSelect = c.querySelector('.admin-filterbar select[aria-label="Date range"]');
    rangeSelect.value = '90';
    rangeSelect.dispatchEvent(new dom.window.Event('change'));
    await flush();

    expect(c.querySelector('.admin-errsummary').textContent).toContain('retained for 30 days');
  });

  it('top-tools/new-signups fetch failures degrade independently without blanking Conversions', async () => {
    const dom = load((url) => {
      if (url.includes('/stats/top-tools')) return makeResponse(500, {});
      return defaultRoutes(url);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.dashboard.render(c);
    await flush();

    expect(c.querySelector('.admin-filtered-section').textContent).toContain(
      "Couldn't load this section."
    );
    // Conversions (fed by a different call) still rendered its own chart.
    expect(c.querySelector('.admin-filtered-section svg.admin-chart')).not.toBeNull();
  });
});
