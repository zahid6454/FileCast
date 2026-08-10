import { describe, expect, it, vi } from 'vitest';
import { createDom, evalScript, flush } from './helpers.js';

// Announcements tab (admin/announcements.js): CRUD list + form, one-active
// rule REFLECTED (re-fetched after every mutation), two-step delete confirm.

function makeResponse(status, body) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body))
  });
}

function load(fetchImpl) {
  const dom = createDom('<div id="c"></div>');
  dom.window.FILECAST = { apiBase: 'https://api.test' };
  dom.window.fetch = fetchImpl;
  evalScript(dom, 'admin/dom.js');
  evalScript(dom, 'admin/api.js');
  evalScript(dom, 'admin/announcements.js');
  const ADMIN = dom.window.ADMIN;
  ADMIN.toast = vi.fn();
  ADMIN.onAuthError = vi.fn();
  ADMIN.notifySaved = vi.fn();
  ADMIN.icon = () => dom.window.document.createElement('span');
  ADMIN.emptyState = (opts) => {
    const el = dom.window.document.createElement('div');
    el.className = 'admin-empty-state';
    el.textContent = opts.title;
    return el;
  };
  return dom;
}

const ONE_ANNOUNCEMENT = {
  id: 1,
  message: 'Hello world',
  link: null,
  type: 'info',
  active: true,
  starts_at: null,
  ends_at: null
};

describe('admin/announcements.js — list rendering', () => {
  it('registers on ADMIN.tabs with a render function', () => {
    const dom = load(() => makeResponse(200, { announcements: [] }));
    expect(typeof dom.window.ADMIN.tabs.announcements.render).toBe('function');
  });

  it('shows an empty state when there are no announcements', async () => {
    const dom = load(() => makeResponse(200, { announcements: [] }));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.announcements.render(c);
    await flush();
    expect(c.querySelector('.admin-empty-state')).not.toBeNull();
  });

  it('renders one row per announcement and a "Live now" preview for the active one', async () => {
    const dom = load(() => makeResponse(200, { announcements: [ONE_ANNOUNCEMENT] }));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.announcements.render(c);
    await flush();

    expect(c.querySelectorAll('.admin-annc')).toHaveLength(1);
    expect(c.textContent).toContain('Live now');
    expect(c.textContent).toContain('Hello world');
  });

  it('routes an auth error to ADMIN.onAuthError instead of showing an error card', async () => {
    const dom = load(() => makeResponse(401, { detail: 'nope' }));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.announcements.render(c);
    await flush();
    expect(dom.window.ADMIN.onAuthError).toHaveBeenCalled();
  });
});

describe('admin/announcements.js — create form', () => {
  it('rejects an empty message client-side without calling the API', async () => {
    const posted = [];
    const dom = load((url, opts) => {
      if (opts && opts.method === 'POST') posted.push(JSON.parse(opts.body));
      return makeResponse(200, { announcements: [] });
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.announcements.render(c);
    await flush();

    c.querySelector('button').click(); // "New announcement"
    const saveBtn = Array.from(c.querySelectorAll('button')).find(
      (b) => b.textContent === 'Create'
    );
    saveBtn.click();

    expect(posted).toHaveLength(0);
    expect(dom.window.ADMIN.toast).toHaveBeenCalledWith('Message is required', 'error');
  });

  it('POSTs a trimmed message and re-renders on success', async () => {
    let getCount = 0;
    const posted = [];
    const dom = load((url, opts) => {
      if (opts && opts.method === 'POST') {
        posted.push(JSON.parse(opts.body));
        return makeResponse(200, { announcement: ONE_ANNOUNCEMENT });
      }
      getCount++;
      return makeResponse(200, { announcements: getCount > 1 ? [ONE_ANNOUNCEMENT] : [] });
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.announcements.render(c);
    await flush();

    c.querySelector('button').click(); // "New announcement"
    const messageInput = c.querySelector('input[type="text"]');
    messageInput.value = '  Big sale  ';
    messageInput.dispatchEvent(new dom.window.Event('input'));
    const saveBtn = Array.from(c.querySelectorAll('button')).find(
      (b) => b.textContent === 'Create'
    );
    saveBtn.click();
    await flush();

    expect(posted[0].message).toBe('Big sale');
    expect(dom.window.ADMIN.notifySaved).toHaveBeenCalledWith({ live: true });
  });
});

describe('admin/announcements.js — delete confirmation', () => {
  it('requires a second click within the window before calling DELETE', async () => {
    const deletes = [];
    const dom = load((url, opts) => {
      if (opts && opts.method === 'DELETE') {
        deletes.push(url);
        return makeResponse(200);
      }
      return makeResponse(200, { announcements: [ONE_ANNOUNCEMENT] });
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.announcements.render(c);
    await flush();

    const delBtn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Delete');
    delBtn.click(); // arm
    expect(deletes).toHaveLength(0);
    expect(delBtn.textContent).toBe('Confirm delete');

    delBtn.click(); // confirm
    await flush();
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain('/api/v1/announcements/1');
  });
});
