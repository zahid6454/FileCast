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
    if (u.pathname.endsWith('/admin/messages/counts') && method === 'GET') {
      const counts = { new: 0, read: 0 };
      state.messages.forEach((m) => {
        counts[m.status] = (counts[m.status] || 0) + 1;
      });
      return makeResponse(200, counts);
    }
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

  it("gives read and unread rows distinct left-edge classes, not the errors tab's always-red one", async () => {
    // .admin-msgrow is its own class family (not a reuse of errors.js's
    // .admin-errrow, which hardcodes a permanent red left border since every
    // row there genuinely is an error) — a message row's edge is status-
    // driven instead.
    const state = { messages: [msg(1, { status: 'new' }), msg(2, { status: 'read' })] };
    const dom = load(stateRoute(state));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.messages.render(c);
    await flush();

    const rows = Array.from(c.querySelectorAll('.admin-msgrow'));
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.classList.contains('admin-msgrow--unread'))).toBe(true);
    expect(rows.some((r) => r.classList.contains('admin-msgrow--read'))).toBe(true);
    expect(
      rows.some(
        (r) =>
          r.classList.contains('admin-msgrow--unread') && r.classList.contains('admin-msgrow--read')
      )
    ).toBe(false);
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
    // render() fires the messages list (pending[0]) and the counts badge
    // fetch (pending[1]) in parallel — resolve just the list so the toolbar
    // exists; the counts call is left dangling, irrelevant to this test.
    pending[0].resolve();
    await flush();

    const filter = c.querySelector('.admin-msgfilter');
    // Fire two filter changes back-to-back before either resolves: the first
    // ('new', pending[2]) is the stale one, the second ('read', pending[3])
    // is what the admin actually landed on and should win regardless of
    // arrival order.
    filter.value = 'new';
    filter.dispatchEvent(new dom.window.Event('change'));
    filter.value = 'read';
    filter.dispatchEvent(new dom.window.Event('change'));

    expect(pending).toHaveLength(4);
    // Resolve the NEWER request first, then the STALE one arrives late.
    pending[3].resolve();
    await flush();
    pending[2].resolve();
    await flush();

    // Must still reflect the 'read' filter — the late 'new' response must
    // not have clobbered it.
    expect(c.textContent).toContain('Read one');
    expect(c.textContent).not.toContain('Unread one');
  });

  it('marking a message read PUTs the status, toasts a specific message, and reloads while keeping the toolbar', async () => {
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
    // A specific toast, not the generic notifySaved({live:true}) "Saved —
    // live now" every other tab's live mutation reuses.
    expect(dom.window.ADMIN.toast).toHaveBeenCalledWith('Marked as read', 'success');
    expect(dom.window.ADMIN.notifySaved).not.toHaveBeenCalled();
    // Toolbar preserved (same search node), row now shows "Read".
    expect(c.querySelector('.admin-msgsearch')).toBe(search);
    expect(c.querySelector('.admin-badge--read').textContent).toBe('Read');
  });

  it('marking a message unread toasts the unread-specific message', async () => {
    const state = { messages: [msg(1, { status: 'read' })] };
    const dom = load(stateRoute(state));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.messages.render(c);
    await flush();

    findButton(c, 'Mark unread').click();
    await flush();

    expect(state.messages[0].status).toBe('new');
    expect(dom.window.ADMIN.toast).toHaveBeenCalledWith('Marked as unread', 'success');
  });

  it('renders inbox-wide unread/read count badges independent of the active filter', async () => {
    const state = {
      messages: [msg(1, { status: 'new' }), msg(2, { status: 'new' }), msg(3, { status: 'read' })]
    };
    const dom = load(stateRoute(state));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.messages.render(c);
    await flush();

    const counts = c.querySelector('.admin-msgcounts');
    expect(counts.querySelector('.admin-msgcounts__badge--unread').textContent).toBe('2 unread');
    expect(counts.querySelector('.admin-msgcounts__badge--read').textContent).toBe('1 read');

    // Switching to the "Read" filter narrows the list but must not narrow
    // the badges — they stay inbox-wide.
    const filter = c.querySelector('.admin-msgfilter');
    filter.value = 'read';
    filter.dispatchEvent(new dom.window.Event('change'));
    await flush();

    expect(counts.querySelector('.admin-msgcounts__badge--unread').textContent).toBe('2 unread');
    expect(counts.querySelector('.admin-msgcounts__badge--read').textContent).toBe('1 read');
  });

  it('marking a message read updates the count badges, not just the row', async () => {
    const state = { messages: [msg(1, { status: 'new' }), msg(2, { status: 'new' })] };
    const dom = load(stateRoute(state));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.messages.render(c);
    await flush();

    const counts = c.querySelector('.admin-msgcounts');
    expect(counts.querySelector('.admin-msgcounts__badge--unread').textContent).toBe('2 unread');

    findButton(c, 'Mark read').click();
    await flush();

    expect(counts.querySelector('.admin-msgcounts__badge--unread').textContent).toBe('1 unread');
    expect(counts.querySelector('.admin-msgcounts__badge--read').textContent).toBe('1 read');
  });

  it('a stale counts response never overwrites a newer one (mirrors the loadMessages REQUEST_SEQ guard)', async () => {
    const state = { messages: [msg(1, { status: 'new' }), msg(2, { status: 'new' })] };
    const pendingCounts = [];
    const dom = load((url, opts) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/admin/messages/counts')) {
        // Snapshot the count NOW (request time), like a real server would —
        // resolution is deferred separately below.
        const counts = { new: 0, read: 0 };
        state.messages.forEach((m) => {
          counts[m.status] = (counts[m.status] || 0) + 1;
        });
        return new Promise((resolve) => {
          pendingCounts.push({ resolve: () => resolve(makeResponse(200, counts)) });
        });
      }
      return stateRoute(state)(url, opts);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.messages.render(c);
    await flush();
    pendingCounts[0].resolve(); // initial load's counts fetch
    await flush();

    const counts = c.querySelector('.admin-msgcounts');
    expect(counts.querySelector('.admin-msgcounts__badge--unread').textContent).toBe('2 unread');

    // Mark message 1 read, let it fully settle (its own loadCounts() request
    // — pendingCounts[1], snapshotting "1 unread" — is left unresolved), then
    // mark message 2 read too (pendingCounts[2], snapshotting "0 unread").
    findButton(c, 'Mark read').click();
    await flush();
    findButton(c, 'Mark read').click();
    await flush();

    expect(pendingCounts).toHaveLength(3);
    // Resolve the NEWER request first, then let the STALE one arrive late —
    // the badge must keep reflecting the newer, correct total.
    pendingCounts[2].resolve();
    await flush();
    pendingCounts[1].resolve();
    await flush();

    expect(counts.querySelector('.admin-msgcounts__badge--unread').textContent).toBe('0 unread');
    expect(counts.querySelector('.admin-msgcounts__badge--read').textContent).toBe('2 read');
  });

  it('re-entering the tab reuses cached state instead of refetching', async () => {
    const state = { messages: [msg(1, { status: 'new' })] };
    const calls = [];
    const dom = load((url, opts) => {
      calls.push(url);
      return stateRoute(state)(url, opts);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.messages.render(c);
    await flush();

    const search = c.querySelector('.admin-msgsearch');
    search.value = 'kept across switch';
    search.dispatchEvent(new dom.window.Event('input'));

    const callsBeforeReentry = calls.length;
    // Simulate leaving and returning to the tab: a fresh container, same
    // render() call.
    dom.window.ADMIN.tabs.messages.render(c);
    await flush();

    expect(calls.length).toBe(callsBeforeReentry); // no new network calls
    expect(c.querySelector('.admin-msgsearch').value).toBe('kept across switch');
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
    expect(c.querySelectorAll('.admin-msgrow')).toHaveLength(1);

    // Marking the sole message on page 2 as read removes it from the "new"
    // filter entirely, emptying the page the admin is currently viewing.
    findButton(c, 'Mark read').click();
    await flush();

    // Auto-recovered to page 1, which still has the other 25 unread rows —
    // not stranded on a dangling, now-nonexistent page 2.
    expect(c.querySelectorAll('.admin-msgrow')).toHaveLength(25);
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
