import { describe, expect, it, vi } from 'vitest';
import { createDom, evalScript, flush } from './helpers.js';

// Users tab (admin/users.js): list + search, row → detail with paginated
// history, and the Phase 5.5 role toggle (disabled for yourself/owners,
// server re-enforces both regardless).

function makeResponse(status, body) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body))
  });
}

const USERS = [
  {
    id: 'u1',
    email: 'alice@example.com',
    name: 'Alice',
    role: 'user',
    created_at: null,
    last_login_at: null
  },
  {
    id: 'u2',
    email: 'bob@example.com',
    name: 'Bob',
    role: 'admin',
    created_at: null,
    last_login_at: null
  },
  {
    id: 'u3',
    email: 'carol@example.com',
    name: 'Carol',
    role: 'user',
    created_at: null,
    last_login_at: null
  }
];

function load(routeFor, { currentUserEmail = 'alice@example.com' } = {}) {
  const dom = createDom('<div id="c"></div>');
  dom.window.FILECAST = { apiBase: 'https://api.test' };
  dom.window.fetch = (url, opts) => routeFor(url, opts);
  evalScript(dom, 'admin/dom.js');
  evalScript(dom, 'admin/api.js');
  evalScript(dom, 'admin/users.js');
  const ADMIN = dom.window.ADMIN;
  ADMIN.toast = vi.fn();
  ADMIN.onAuthError = vi.fn();
  ADMIN.currentUser = { email: currentUserEmail };
  ADMIN.emptyState = (opts) => {
    const el = dom.window.document.createElement('div');
    el.className = 'admin-empty-state';
    el.textContent = opts.title;
    return el;
  };
  return dom;
}

function defaultRoutes(url) {
  if (url.includes('/admin/staff')) return makeResponse(200, { owners: [], pending: [] });
  if (url.includes('/api/v1/users')) return makeResponse(200, { users: USERS });
  return makeResponse(404, {});
}

describe('admin/users.js — list', () => {
  it('registers on ADMIN.tabs with a render function', () => {
    const dom = load(defaultRoutes);
    expect(typeof dom.window.ADMIN.tabs.users.render).toBe('function');
  });

  it('renders one row per user', async () => {
    const dom = load(defaultRoutes);
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.users.render(c);
    await flush();
    expect(c.querySelectorAll('.admin-users__row')).toHaveLength(3);
  });

  it('filters by search text across email and name', async () => {
    const dom = load(defaultRoutes);
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.users.render(c);
    await flush();

    const search = c.querySelector('.admin-users__search');
    search.value = 'bob';
    search.dispatchEvent(new dom.window.Event('input'));
    expect(c.querySelectorAll('.admin-users__row')).toHaveLength(1);
    expect(c.textContent).toContain('Bob');
  });

  it('degrades to the plain list (no crash) when the staff fetch fails non-auth', async () => {
    const dom = load((url) => {
      if (url.includes('/admin/staff')) return makeResponse(500, {});
      return defaultRoutes(url);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.users.render(c);
    await flush();
    expect(c.querySelectorAll('.admin-users__row')).toHaveLength(3);
    expect(c.querySelector('.admin-staff')).toBeNull(); // staff panel skipped
  });

  it('routes an auth error on the primary /users call to ADMIN.onAuthError', async () => {
    const dom = load((url) => {
      if (url.includes('/api/v1/users')) return makeResponse(401, {});
      return defaultRoutes(url);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.users.render(c);
    await flush();
    expect(dom.window.ADMIN.onAuthError).toHaveBeenCalled();
  });
});

describe('admin/users.js — role toggle', () => {
  it('disables the toggle for your own row', async () => {
    const dom = load(defaultRoutes, { currentUserEmail: 'alice@example.com' });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.users.render(c);
    await flush();

    const aliceRow = Array.from(c.querySelectorAll('.admin-users__row')).find((r) =>
      r.textContent.includes('Alice')
    );
    const toggleBtn = aliceRow.querySelector('[data-role-toggle]');
    expect(toggleBtn.disabled).toBe(true);
  });

  it('promotes a non-self user to admin via POST /admin/staff', async () => {
    const posts = [];
    const dom = load((url, opts) => {
      if (opts && opts.method === 'POST' && url.includes('/admin/staff')) {
        posts.push({ url, body: JSON.parse(opts.body) });
        return makeResponse(200, {});
      }
      return defaultRoutes(url);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.users.render(c);
    await flush();

    const carolRow = Array.from(c.querySelectorAll('.admin-users__row')).find((r) =>
      r.textContent.includes('Carol')
    );
    const toggleBtn = carolRow.querySelector('[data-role-toggle]');
    expect(toggleBtn.disabled).toBe(false);
    expect(toggleBtn.textContent).toBe('Make admin');

    toggleBtn.click();
    await flush();

    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ email: 'carol@example.com' });
    expect(dom.window.ADMIN.toast).toHaveBeenCalledWith('Granted admin', 'success');
  });

  it('demotes a non-self admin via DELETE /admin/staff/<email>', async () => {
    const deletes = [];
    const dom = load((url, opts) => {
      if (opts && opts.method === 'DELETE' && url.includes('/admin/staff/')) {
        deletes.push(url);
        return makeResponse(200, {});
      }
      return defaultRoutes(url);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.users.render(c);
    await flush();

    const bobRow = Array.from(c.querySelectorAll('.admin-users__row')).find((r) =>
      r.textContent.includes('Bob')
    );
    const toggleBtn = bobRow.querySelector('[data-role-toggle]');
    expect(toggleBtn.disabled).toBe(false);
    expect(toggleBtn.textContent).toBe('Revoke admin');

    toggleBtn.click();
    await flush();

    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain('/api/v1/admin/staff/bob%40example.com');
  });
});

describe('admin/users.js — detail view', () => {
  it('clicking a row loads and shows the user detail with paginated history', async () => {
    const dom = load((url) => {
      if (url.includes('/users/u1/history')) {
        return makeResponse(200, {
          history: [
            { tool_id: 'jpg-to-png', input_format: 'JPG', output_format: 'PNG', status: 'success' }
          ],
          has_more: false
        });
      }
      if (url.includes('/users/u1')) {
        return makeResponse(200, { user: { ...USERS[0], favorites: ['jpg-to-png'] } });
      }
      return defaultRoutes(url);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.users.render(c);
    await flush();

    c.querySelector('.admin-users__row').click();
    await flush();

    expect(c.textContent).toContain('Alice');
    expect(c.textContent).toContain('Favorites');
    expect(c.textContent).toContain('History');
  });
});
