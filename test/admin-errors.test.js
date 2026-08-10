import { describe, expect, it, vi } from 'vitest';
import { createDom, evalScript, flush } from './helpers.js';

// Errors tab (admin/errors.js): renders each client error as an expandable
// card and filters them with a client-side search across every field.

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
  evalScript(dom, 'admin/errors.js');
  const ADMIN = dom.window.ADMIN;
  ADMIN.toast = vi.fn();
  ADMIN.onAuthError = vi.fn();
  ADMIN.emptyState = (opts) => {
    const el = dom.window.document.createElement('div');
    el.className = 'admin-empty-state';
    el.textContent = opts.title;
    return el;
  };
  return dom;
}

const ERRORS = [
  {
    id: 1,
    tool_id: 'jpg-to-png',
    error_type: 'conversion_error',
    error_message: 'Canvas toBlob failed',
    browser: 'Chrome',
    created_at: '2026-08-01T00:00:00Z'
  },
  {
    id: 2,
    tool_id: 'pdf-merge',
    error_type: 'network_error',
    error_message: 'Worker load timeout',
    browser: 'Firefox',
    created_at: '2026-08-02T00:00:00Z'
  }
];

describe('admin/errors.js', () => {
  it('registers on ADMIN.tabs with a render function', () => {
    const dom = load(() => makeResponse(200, { errors: [] }));
    expect(typeof dom.window.ADMIN.tabs.errors.render).toBe('function');
  });

  it('shows an empty state with no errors', async () => {
    const dom = load(() => makeResponse(200, { errors: [] }));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.errors.render(c);
    await flush();
    expect(c.querySelector('.admin-empty-state')).not.toBeNull();
  });

  it('renders one card per error and a count', async () => {
    const dom = load(() => makeResponse(200, { errors: ERRORS }));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.errors.render(c);
    await flush();

    expect(c.querySelectorAll('.admin-errrow')).toHaveLength(2);
    expect(c.querySelector('.admin-errcount').textContent).toBe('2 of 2');
  });

  it('filters by search text across tool id, message, type, and browser', async () => {
    const dom = load(() => makeResponse(200, { errors: ERRORS }));
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.errors.render(c);
    await flush();

    const search = c.querySelector('.admin-errsearch');
    search.value = 'timeout';
    search.dispatchEvent(new dom.window.Event('input'));

    expect(c.querySelectorAll('.admin-errrow')).toHaveLength(1);
    expect(c.textContent).toContain('Worker load timeout');
    expect(c.querySelector('.admin-errcount').textContent).toBe('1 of 2');
  });

  it('expands a card to show full detail on click', async () => {
    const dom = load(() => makeResponse(200, { errors: ERRORS }));
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
});
