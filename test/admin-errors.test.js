import { describe, expect, it, vi } from 'vitest';
import { createDom, evalScript, flush } from './helpers.js';

// Errors tab (admin/errors.js): server-paginated client error log, rendered
// as expandable cards with a page-size selector and page-scoped search.
// Mirrors messages.js's pagination contract (limit/offset → {errors,total,
// has_more}), minus the status filter and mutation endpoints.

function makeResponse(status, body) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body))
  });
}

function err(id, overrides) {
  return Object.assign(
    {
      id,
      tool_id: 'jpg-to-png',
      error_type: 'conversion_error',
      error_message: 'Canvas toBlob failed ' + id,
      browser: 'Chrome',
      created_at: '2026-08-01T00:00:00Z'
    },
    overrides
  );
}

// Stateful GET mock mirroring the real /stats/errors contract (limit/offset
// query params, {errors,total,has_more} response).
function stateRoute(state) {
  return function (url) {
    const u = new URL(url);
    if (u.pathname.endsWith('/stats/errors')) {
      const limit = Number(u.searchParams.get('limit')) || 25;
      const offset = Number(u.searchParams.get('offset')) || 0;
      const page = state.errors.slice(offset, offset + limit);
      return makeResponse(200, {
        errors: page,
        total: state.errors.length,
        has_more: offset + limit < state.errors.length
      });
    }
    return makeResponse(404, {});
  };
}

function stubAdminHelpers(dom) {
  const ADMIN = dom.window.ADMIN;
  ADMIN.toast = vi.fn();
  ADMIN.onAuthError = vi.fn();
  ADMIN.emptyState = (opts) => {
    const doc = dom.window.document;
    const el = doc.createElement('div');
    el.className = 'admin-empty-state';
    const title = doc.createElement('h3');
    title.textContent = opts.title || '';
    el.appendChild(title);
    if (opts.actionLabel && opts.onAction) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.textContent = opts.actionLabel;
      btn.addEventListener('click', opts.onAction);
      el.appendChild(btn);
    }
    return el;
  };
}

function load(routeFor) {
  const dom = createDom('<div id="c"></div>');
  dom.window.FILECAST = { apiBase: 'https://api.test' };
  dom.window.fetch = (url, opts) => routeFor(url, opts || {});
  evalScript(dom, 'admin/dom.js');
  evalScript(dom, 'admin/api.js');
  evalScript(dom, 'admin/errors.js');
  stubAdminHelpers(dom);
  return dom;
}

function findButton(root, text) {
  return Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text);
}

// The page-size control is a custom toggle+menu dropdown (admin-dropdown),
// not a native <select> — mirrors messages.js's status-filter selectFilter()
// test helper. Opening it is a real click on the toggle, and picking an
// option is a click on that option's own button, scoped to
// .admin-dropdown__item so it never matches the toggle itself.
function selectPageSize(root, size) {
  root.querySelector('.admin-errpagesize .admin-dropdown__toggle').click();
  const item = Array.from(root.querySelectorAll('.admin-errpagesize .admin-dropdown__item')).find(
    (b) => b.textContent === size + ' per page'
  );
  item.click();
}

describe('admin/errors.js', () => {
  it('registers on ADMIN.tabs with a render function', () => {
    const dom = load(stateRoute({ errors: [] }));
    expect(typeof dom.window.ADMIN.tabs.errors.render).toBe('function');
  });

  it('shows an empty state with no errors', async () => {
    const dom = load(stateRoute({ errors: [] }));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.errors.render(c);
    await flush();
    expect(c.querySelector('.admin-empty-state')).not.toBeNull();
  });

  it('renders one card per error and a page/total count', async () => {
    const dom = load(stateRoute({ errors: [err(1), err(2)] }));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.errors.render(c);
    await flush();

    expect(c.querySelectorAll('.admin-errrow')).toHaveLength(2);
    expect(c.querySelector('.admin-errcount').textContent).toBe('2 of 2');
  });

  it('requests the default page size (25) with no pager when everything fits on one page', async () => {
    const calls = [];
    const dom = load((url, opts) => {
      calls.push(url);
      return stateRoute({ errors: [err(1)] })(url, opts);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.errors.render(c);
    await flush();

    expect(calls[0]).toContain('limit=25');
    expect(calls[0]).toContain('offset=0');
    expect(c.querySelector('.admin-pager')).toBeNull();
  });

  it('filters by search text across tool id, message, type, and browser, scoped to the current page', async () => {
    const dom = load(
      stateRoute({
        errors: [
          err(1, { error_message: 'timeout while loading' }),
          err(2, { error_message: 'ok' })
        ]
      })
    );
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.errors.render(c);
    await flush();

    const search = c.querySelector('.admin-errsearch');
    search.value = 'timeout';
    search.dispatchEvent(new dom.window.Event('input'));

    expect(c.querySelectorAll('.admin-errrow')).toHaveLength(1);
    expect(c.textContent).toContain('timeout while loading');
    expect(c.querySelector('.admin-errcount').textContent).toBe('1 of 2 on this page');
  });

  it('expands a card to show full detail on click', async () => {
    const dom = load(stateRoute({ errors: [err(1), err(2)] }));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.errors.render(c);
    await flush();

    const summary = c.querySelector('.admin-errrow__summary');
    const detail = c.querySelector('.admin-errrow__detail');
    expect(detail.hidden).toBe(true);
    summary.click();
    expect(detail.hidden).toBe(false);
    expect(summary.getAttribute('aria-expanded')).toBe('true');
  });

  it('routes an auth error to ADMIN.onAuthError', async () => {
    const dom = load(() => makeResponse(403, { detail: 'nope' }));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.errors.render(c);
    await flush();
    expect(dom.window.ADMIN.onAuthError).toHaveBeenCalled();
  });

  it('changing the page size resets to page 1 and refetches with the new limit', async () => {
    const state = { errors: Array.from({ length: 30 }, (_, i) => err(i + 1)) };
    const calls = [];
    const dom = load((url, opts) => {
      calls.push(url);
      return stateRoute(state)(url, opts);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.errors.render(c);
    await flush();

    findButton(c.querySelector('.admin-errpager'), 'Next').click();
    await flush();
    expect(calls[calls.length - 1]).toContain('offset=25');

    selectPageSize(c, 100);
    await flush();

    expect(calls[calls.length - 1]).toContain('limit=100');
    expect(calls[calls.length - 1]).toContain('offset=0');
    expect(c.querySelector('.admin-pager')).toBeNull(); // 30 fits on one 100-sized page
    expect(c.querySelector('.admin-errpagesize__label').textContent).toBe('100 per page');
  });

  it('opens and closes the page-size dropdown on toggle click, tracking aria-expanded', async () => {
    const dom = load(stateRoute({ errors: [err(1)] }));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.errors.render(c);
    await flush();

    const wrap = c.querySelector('.admin-errpagesize');
    const toggle = wrap.querySelector('.admin-dropdown__toggle');
    expect(wrap.classList.contains('admin-dropdown--open')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    toggle.click();
    expect(wrap.classList.contains('admin-dropdown--open')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    toggle.click();
    expect(wrap.classList.contains('admin-dropdown--open')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes the page-size dropdown on an outside click and Escape', async () => {
    const dom = load(stateRoute({ errors: [err(1)] }));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.errors.render(c);
    await flush();

    const wrap = c.querySelector('.admin-errpagesize');
    const toggle = wrap.querySelector('.admin-dropdown__toggle');
    const search = c.querySelector('.admin-errsearch');
    const isOpen = () => wrap.classList.contains('admin-dropdown--open');

    toggle.click();
    expect(isOpen()).toBe(true);
    search.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    expect(isOpen()).toBe(false);

    toggle.click();
    expect(isOpen()).toBe(true);
    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    expect(isOpen()).toBe(false);
  });

  it('preserves typed search text across pagination and requests the right offset', async () => {
    const state = { errors: Array.from({ length: 30 }, (_, i) => err(i + 1)) };
    const calls = [];
    const dom = load((url, opts) => {
      calls.push(url);
      return stateRoute(state)(url, opts);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.errors.render(c);
    await flush();

    const search = c.querySelector('.admin-errsearch');
    search.value = 'still here';
    search.dispatchEvent(new dom.window.Event('input'));

    const next = findButton(c.querySelector('.admin-errpager'), 'Next');
    expect(next.disabled).toBe(false);
    next.click();
    await flush();

    expect(calls[calls.length - 1]).toContain('offset=25');
    expect(c.querySelector('.admin-errsearch')).toBe(search);
    expect(c.querySelector('.admin-errsearch').value).toBe('still here');
  });

  it('ignores a stale response that resolves after a newer request has superseded it', async () => {
    // Two overlapping loads before either lands — e.g. rapidly switching away
    // from and back to the tab before the first fetch resolves. The later
    // request's response must win regardless of arrival order.
    const stateA = { errors: [err(1, { error_message: 'stale one' })] };
    const stateB = { errors: [err(2, { error_message: 'fresh one' })] };
    const pending = [];
    const dom = load((url) => {
      return new Promise((resolve) => {
        pending.push({ resolve });
      });
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.errors.render(c); // request 0 (stale)
    dom.window.ADMIN.tabs.errors.render(c); // request 1 (the one that should win)

    expect(pending).toHaveLength(2);
    // Newer request resolves first, then the stale one arrives late.
    pending[1].resolve(
      stateRoute(stateB)('https://api.test/api/v1/stats/errors?limit=25&offset=0')
    );
    await flush();
    pending[0].resolve(
      stateRoute(stateA)('https://api.test/api/v1/stats/errors?limit=25&offset=0')
    );
    await flush();

    expect(c.textContent).toContain('fresh one');
    expect(c.textContent).not.toContain('stale one');
  });

  it('steps back a page when the requested page comes back empty', async () => {
    // 26 errors at render time (page 1 full, page 2 would hold exactly 1),
    // but the log shrinks to 25 (e.g. a retention sweep) before the "Next"
    // click's own request is even made, so the page-2 fetch itself returns
    // zero rows — the dangling-page recovery must trigger on this response,
    // not just on a page-size change (which resets PAGE on its own).
    const state = { errors: Array.from({ length: 26 }, (_, i) => err(i + 1)) };
    const dom = load(stateRoute(state));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.errors.render(c);
    await flush();

    state.errors = state.errors.slice(0, 25);
    findButton(c.querySelector('.admin-errpager'), 'Next').click();
    await flush();

    expect(c.querySelectorAll('.admin-errrow')).toHaveLength(25);
    expect(c.querySelector('.admin-pager')).toBeNull();
  });

  it('re-entering the tab reuses the cached page without a new network call', async () => {
    const state = { errors: [err(1)] };
    const calls = [];
    const dom = load((url, opts) => {
      calls.push(url);
      return stateRoute(state)(url, opts);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.errors.render(c);
    await flush();

    const search = c.querySelector('.admin-errsearch');
    search.value = 'kept across switch';
    search.dispatchEvent(new dom.window.Event('input'));

    const callsBeforeReentry = calls.length;
    dom.window.ADMIN.tabs.errors.render(c);
    await flush();

    expect(calls.length).toBe(callsBeforeReentry);
    expect(c.querySelector('.admin-errsearch').value).toBe('kept across switch');
  });

  it('shows a search-scoped empty state with a working Clear search action', async () => {
    const dom = load(stateRoute({ errors: [err(1, { error_message: 'Findable' })] }));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.errors.render(c);
    await flush();

    const search = c.querySelector('.admin-errsearch');
    search.value = 'zzz-nothing-matches';
    search.dispatchEvent(new dom.window.Event('input'));

    expect(c.textContent).toContain('No matching errors');
    const clear = findButton(c, 'Clear search');
    expect(clear).toBeTruthy();
    clear.click();

    expect(c.querySelector('.admin-errsearch').value).toBe('');
    expect(c.textContent).toContain('Findable');
  });
});
