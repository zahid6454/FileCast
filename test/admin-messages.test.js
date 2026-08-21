import { describe, expect, it, vi } from 'vitest';
import { createDom, evalScript, flush } from './helpers.js';

// Messages tab (admin/messages.js) — server-paginated inbox with a status
// filter and client-side (page-scoped) search. The two behaviors under test
// that are easy to silently regress:
//   - the toolbar (search text, filter selection) must survive a page turn,
//     filter change, or status mutation — those only refetch data, they must
//     never tear down and rebuild the search/filter controls.
//   - a slow response from an earlier request must never clobber a faster
//     response from a newer one (REQUEST_SEQ guard).

function makeResponse(status, body) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body))
  });
}

function msg(id, overrides) {
  return Object.assign(
    {
      id,
      title: 'Subject ' + id,
      body: 'Body ' + id,
      email: null,
      user_id: null,
      user_agent: null,
      status: 'new',
      created_at: '2026-07-13T10:00:00Z'
    },
    overrides
  );
}

// Stateful GET (+PUT) mock mirroring the real /admin/messages contract
// (limit/offset/status query params, {messages,total,has_more} response).
function stateRoute(state) {
  return function (url, opts) {
    const u = new URL(url);
    const method = ((opts && opts.method) || 'GET').toUpperCase();
    if (u.pathname.endsWith('/admin/messages') && method === 'GET') {
      const status = u.searchParams.get('status');
      const limit = Number(u.searchParams.get('limit')) || 25;
      const offset = Number(u.searchParams.get('offset')) || 0;
      const filtered = status ? state.messages.filter((m) => m.status === status) : state.messages;
      const page = filtered.slice(offset, offset + limit);
      return makeResponse(200, {
        messages: page,
        total: filtered.length,
        has_more: offset + limit < filtered.length
      });
    }
    const idMatch = u.pathname.match(/\/admin\/messages\/(\d+)$/);
    if (idMatch && method === 'PUT') {
      const m = state.messages.find((x) => x.id === Number(idMatch[1]));
      if (m) Object.assign(m, JSON.parse(opts.body));
      return makeResponse(200, m || {});
    }
    return makeResponse(404, {});
  };
}

function stubAdminHelpers(dom) {
  const ADMIN = dom.window.ADMIN;
  ADMIN.onAuthError = vi.fn();
  ADMIN.notifySaved = vi.fn();
  ADMIN.toast = vi.fn();
  // Minimal stand-in for app.js's real emptyState() — icon medallion isn't
  // under test here, just that title/text/action reach the DOM.
  ADMIN.emptyState = function (opts) {
    const doc = dom.window.document;
    const el = doc.createElement('div');
    el.className = 'admin-emptystate';
    const title = doc.createElement('h3');
    title.className = 'admin-emptystate__title';
    title.textContent = opts.title || '';
    el.appendChild(title);
    if (opts.text) {
      const p = doc.createElement('p');
      p.className = 'admin-emptystate__text';
      p.textContent = opts.text;
      el.appendChild(p);
    }
    if (opts.actionLabel && opts.onAction) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'admin-emptystate-action';
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
  evalScript(dom, 'admin/messages.js');
  stubAdminHelpers(dom);
  return dom;
}

function findButton(root, text) {
  return Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text);
}

describe('admin/messages.js', () => {
  it('registers on ADMIN.tabs with a render function', () => {
    const dom = load(stateRoute({ messages: [] }));
    expect(typeof dom.window.ADMIN.tabs.messages.render).toBe('function');
  });

  it('shows the full empty state (no toolbar) when the inbox has zero messages', async () => {
    const dom = load(stateRoute({ messages: [] }));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.messages.render(c);
    await flush();

    expect(c.textContent).toContain('No messages');
    expect(c.querySelector('.admin-msgsearch')).toBeNull();
  });

  it('renders unread and read rows with distinct badge classes and labels', async () => {
    const state = { messages: [msg(1, { status: 'new' }), msg(2, { status: 'read' })] };
    const dom = load(stateRoute(state));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.messages.render(c);
    await flush();

    const badges = Array.from(c.querySelectorAll('.admin-badge'));
    expect(badges).toHaveLength(2);
    expect(badges.find((b) => b.classList.contains('admin-badge--unread')).textContent).toBe(
      'Unread'
    );
    expect(badges.find((b) => b.classList.contains('admin-badge--read')).textContent).toBe('Read');
  });

  it('preserves typed search text across a status-filter change, and requests the right status', async () => {
    const state = { messages: [msg(1, { status: 'new' }), msg(2, { status: 'read' })] };
    const calls = [];
    const dom = load((url, opts) => {
      calls.push(url);
      return stateRoute(state)(url, opts);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.messages.render(c);
    await flush();

    const search = c.querySelector('.admin-msgsearch');
    search.value = 'hello';

    const filter = c.querySelector('.admin-msgfilter');
    filter.value = 'read';
    filter.dispatchEvent(new dom.window.Event('change'));
    await flush();

    expect(calls[calls.length - 1]).toContain('status=read');
    // Same input node, never rebuilt — the value the admin typed survives.
    expect(c.querySelector('.admin-msgsearch')).toBe(search);
    expect(c.querySelector('.admin-msgsearch').value).toBe('hello');
  });

  it('preserves typed search text across pagination and requests the right offset', async () => {
    const state = { messages: [msg(1), msg(2), msg(3)] };
    const calls = [];
    const dom = load((url, opts) => {
      calls.push(url);
      return stateRoute(state)(url, opts);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.messages.render(c);
    await flush();

    const search = c.querySelector('.admin-msgsearch');
    search.value = 'still here';

    // LIMIT is 25 and only 3 messages exist, so there's no next page in the
    // real UI — drive PAGE forward directly the way a "Next" click would, by
    // exercising the pager's own DOM once has_more is true for this fixture.
    state.messages = Array.from({ length: 30 }, (_, i) => msg(i + 1));
    const filter = c.querySelector('.admin-msgfilter');
    filter.dispatchEvent(new dom.window.Event('change')); // refetch under the new fixture
    await flush();

    const next = findButton(c.querySelector('.admin-msgpager'), 'Next');
    expect(next.disabled).toBe(false);
    next.click();
    await flush();

    expect(calls[calls.length - 1]).toContain('offset=25');
    expect(c.querySelector('.admin-msgsearch')).toBe(search);
    expect(c.querySelector('.admin-msgsearch').value).toBe('still here');
  });

  it('ignores a stale response that resolves after a newer request has superseded it', async () => {
    const state = {
      messages: [
        msg(1, { status: 'new', title: 'Unread one' }),
        msg(2, { status: 'read', title: 'Read one' })
      ]
    };
    const pending = [];
    const dom = load((url, opts) => {
      const respond = stateRoute(state);
      return new Promise((resolve) => {
        pending.push({ url, resolve: () => resolve(respond(url, opts)) });
      });
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.messages.render(c);
    // Resolve the initial (unfiltered) load so the toolbar exists.
    pending[0].resolve();
    await flush();

    const filter = c.querySelector('.admin-msgfilter');
    // Fire two filter changes back-to-back before either resolves: the first
    // ('new') is the stale one, the second ('read') is what the admin
    // actually landed on and should win regardless of arrival order.
    filter.value = 'new';
    filter.dispatchEvent(new dom.window.Event('change'));
    filter.value = 'read';
    filter.dispatchEvent(new dom.window.Event('change'));

    expect(pending).toHaveLength(3);
    // Resolve the NEWER request first, then the STALE one arrives late.
    pending[2].resolve();
    await flush();
    pending[1].resolve();
    await flush();

    // Must still reflect the 'read' filter — the late 'new' response must
    // not have clobbered it.
    expect(c.textContent).toContain('Read one');
    expect(c.textContent).not.toContain('Unread one');
  });

  it('marking a message read PUTs the status and reloads while keeping the toolbar', async () => {
    const state = { messages: [msg(1, { status: 'new' })] };
    const dom = load(stateRoute(state));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.messages.render(c);
    await flush();

    const search = c.querySelector('.admin-msgsearch');
    const markRead = findButton(c, 'Mark read');
    markRead.click();
    await flush();

    expect(state.messages[0].status).toBe('read');
    expect(dom.window.ADMIN.notifySaved).toHaveBeenCalled();
    // Toolbar preserved (same search node), row now shows "Read".
    expect(c.querySelector('.admin-msgsearch')).toBe(search);
    expect(c.querySelector('.admin-badge--read').textContent).toBe('Read');
  });

  it('steps back a page when a status change empties the current filtered page', async () => {
    // 26 unread messages: page 1 holds 25, page 2 holds exactly 1.
    const state = { messages: Array.from({ length: 26 }, (_, i) => msg(i + 1, { status: 'new' })) };
    const dom = load(stateRoute(state));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.messages.render(c);
    await flush();

    const filter = c.querySelector('.admin-msgfilter');
    filter.value = 'new';
    filter.dispatchEvent(new dom.window.Event('change'));
    await flush();

    findButton(c.querySelector('.admin-msgpager'), 'Next').click();
    await flush();
    expect(c.querySelectorAll('.admin-errrow')).toHaveLength(1);

    // Marking the sole message on page 2 as read removes it from the "new"
    // filter entirely, emptying the page the admin is currently viewing.
    findButton(c, 'Mark read').click();
    await flush();

    // Auto-recovered to page 1, which still has the other 25 unread rows —
    // not stranded on a dangling, now-nonexistent page 2.
    expect(c.querySelectorAll('.admin-errrow')).toHaveLength(25);
    expect(c.querySelector('.admin-pager')).toBeNull(); // exactly one page now
  });

  it('shows a search-scoped empty state with a working Clear search action', async () => {
    const state = { messages: [msg(1, { title: 'Findable' })] };
    const dom = load(stateRoute(state));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.messages.render(c);
    await flush();

    const search = c.querySelector('.admin-msgsearch');
    search.value = 'zzz-nothing-matches';
    search.dispatchEvent(new dom.window.Event('input'));

    expect(c.textContent).toContain('No matching messages');
    const clear = findButton(c, 'Clear search');
    expect(clear).toBeTruthy();
    clear.click();

    expect(c.querySelector('.admin-msgsearch').value).toBe('');
    expect(c.textContent).toContain('Findable');
  });
});
