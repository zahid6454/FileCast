import { describe, expect, it, vi } from 'vitest';
import { createDom, evalScript, flush } from './helpers.js';

// Tools tab (admin/tools.js): groups by category, optimistic enable/disable
// toggle with revert-on-failure, move-up/down persists the FULL global order
// in one PUT, and the slide-out only sends changed fields.

function makeResponse(status, body) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body))
  });
}

const TOOLS = [
  { id: 'jpg-to-png', name: 'JPG to PNG', category: 'image-conversion', enabled: true },
  { id: 'png-to-jpg', name: 'PNG to JPG', category: 'image-conversion', enabled: true },
  { id: 'csv-to-json', name: 'CSV to JSON', category: 'developer-tools', enabled: false }
];

function load(routeFor) {
  const dom = createDom('<div id="c"></div><div id="admin-app"></div>');
  dom.window.FILECAST = { apiBase: 'https://api.test' };
  dom.window.fetch = (url, opts) => routeFor(url, opts);
  evalScript(dom, 'admin/dom.js');
  evalScript(dom, 'admin/api.js');
  evalScript(dom, 'admin/tools.js');
  const ADMIN = dom.window.ADMIN;
  ADMIN.toast = vi.fn();
  ADMIN.onAuthError = vi.fn();
  ADMIN.notifySaved = vi.fn();
  return dom;
}

function defaultRoutes(url) {
  if (url.includes('/api/v1/tools')) return makeResponse(200, { tools: TOOLS });
  return makeResponse(404, {});
}

describe('admin/tools.js — rendering', () => {
  it('registers on ADMIN.tabs with a render function', () => {
    const dom = load(defaultRoutes);
    expect(typeof dom.window.ADMIN.tabs.tools.render).toBe('function');
  });

  it('groups tools into one list per category, including disabled ones', async () => {
    const dom = load(defaultRoutes);
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.tools.render(c);
    await flush();

    const groups = c.querySelectorAll('.admin-toolgroup');
    expect(groups).toHaveLength(2);
    expect(c.querySelectorAll('.admin-tool')).toHaveLength(3);
    expect(c.textContent).toContain('disabled'); // csv-to-json's badge
  });
});

describe('admin/tools.js — enable/disable toggle', () => {
  it('optimistically flips the switch, then PUTs enabled and confirms', async () => {
    const puts = [];
    const dom = load((url, opts) => {
      if (opts && opts.method === 'PUT' && url.includes('/tools/')) {
        puts.push({ url, body: JSON.parse(opts.body) });
        return makeResponse(200, {});
      }
      return defaultRoutes(url);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.tools.render(c);
    await flush();

    const toggle = c.querySelector('.admin-switch');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    toggle.click();
    // Optimistic flip happens synchronously, before the PUT resolves.
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await flush();

    expect(puts).toHaveLength(1);
    expect(puts[0].body).toEqual({ enabled: false });
    expect(dom.window.ADMIN.notifySaved).toHaveBeenCalled();
  });

  it('reverts the switch and toasts an error when the PUT fails', async () => {
    const dom = load((url, opts) => {
      if (opts && opts.method === 'PUT' && url.includes('/tools/')) {
        return makeResponse(500, { detail: 'boom' });
      }
      return defaultRoutes(url);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.tools.render(c);
    await flush();

    const toggle = c.querySelector('.admin-switch');
    toggle.click();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await flush();

    expect(toggle.getAttribute('aria-checked')).toBe('true'); // reverted
    expect(dom.window.ADMIN.toast).toHaveBeenCalledWith('Could not update — reverted', 'error');
  });
});

describe('admin/tools.js — reordering', () => {
  it('moving a row down persists the full new order via PUT /tools/reorder', async () => {
    const puts = [];
    const dom = load((url, opts) => {
      if (opts && opts.method === 'PUT' && url.includes('/tools/reorder')) {
        puts.push(JSON.parse(opts.body));
        return makeResponse(200, {});
      }
      return defaultRoutes(url);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.tools.render(c);
    await flush();

    const firstGroupRows = c.querySelectorAll(
      '.admin-toollist[data-category="image-conversion"] .admin-tool'
    );
    expect(firstGroupRows).toHaveLength(2);
    firstGroupRows[0].querySelector('.admin-tool__down').click();
    await flush();

    expect(puts).toHaveLength(1);
    expect(puts[0].order).toEqual(['png-to-jpg', 'jpg-to-png', 'csv-to-json']);
  });

  it('disables the up-button on the first row and the down-button on the last row of a category', async () => {
    const dom = load(defaultRoutes);
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.tools.render(c);
    await flush();

    const rows = c.querySelectorAll(
      '.admin-toollist[data-category="image-conversion"] .admin-tool'
    );
    expect(rows[0].querySelector('.admin-tool__up').disabled).toBe(true);
    expect(rows[1].querySelector('.admin-tool__down').disabled).toBe(true);
  });
});

describe('admin/tools.js — slide-out edit', () => {
  it('opens on name click and only sends changed fields on save', async () => {
    const puts = [];
    const dom = load((url, opts) => {
      if (opts && opts.method === 'PUT' && url.includes('/tools/jpg-to-png')) {
        puts.push(JSON.parse(opts.body));
        return makeResponse(200, { tool: TOOLS[0] });
      }
      return defaultRoutes(url);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.tools.render(c);
    await flush();

    c.querySelector('.admin-tool__name').click();
    const nameInput = dom.window.document.getElementById('so-name');
    expect(nameInput).not.toBeNull();
    nameInput.value = 'JPEG to PNG';
    nameInput.dispatchEvent(new dom.window.Event('input'));

    const saveBtn = Array.from(
      dom.window.document.querySelectorAll('.admin-slideout__foot button')
    )[0];
    saveBtn.click();
    await flush();

    expect(puts).toHaveLength(1);
    expect(puts[0]).toEqual({ display_name: 'JPEG to PNG' });
  });

  it('closes without any API call when nothing changed', async () => {
    const puts = [];
    const dom = load((url, opts) => {
      if (opts && opts.method === 'PUT') puts.push(url);
      return defaultRoutes(url);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.tools.render(c);
    await flush();

    c.querySelector('.admin-tool__name').click();
    const saveBtn = Array.from(
      dom.window.document.querySelectorAll('.admin-slideout__foot button')
    )[0];
    saveBtn.click();

    expect(puts).toHaveLength(0);
    expect(dom.window.document.querySelector('.admin-slideout')).toBeNull();
  });
});
