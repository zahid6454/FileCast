import { describe, expect, it, vi } from 'vitest';
import { boot, createDom } from './helpers.js';

// Announcement-bar shell as rendered by base.html (§6.9).
const BAR = `
  <div class="announcement-bar hidden" id="announcement-bar" role="region">
    <span id="announcement-bar__message"></span>
    <a class="announcement-bar__link hidden" id="announcement-bar__link"></a>
    <button id="announcement-bar__dismiss" type="button"></button>
  </div>`;

const API = 'https://api.test';

function withApi(dom) {
  dom.window.FILECAST = { apiBase: API };
}

function mockActive(dom, announcement) {
  const fn = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ announcement }) })
  );
  dom.window.fetch = fn;
  return fn;
}

describe('nav.js announcement bar (§6.9, progressive enhancement)', () => {
  it('shows the active announcement, sets the type class, and fills the message', async () => {
    const dom = createDom(BAR);
    withApi(dom);
    mockActive(dom, {
      id: 1,
      message: 'Scheduled maintenance tonight',
      link: null,
      type: 'maintenance'
    });
    await boot(dom, 'nav.js');

    const bar = dom.window.document.getElementById('announcement-bar');
    expect(bar.classList.contains('hidden')).toBe(false);
    expect(bar.classList.contains('announcement-bar--maintenance')).toBe(true);
    expect(dom.window.document.getElementById('announcement-bar__message').textContent).toBe(
      'Scheduled maintenance tonight'
    );
  });

  it('exposes the link only when one is present', async () => {
    const dom = createDom(BAR);
    withApi(dom);
    mockActive(dom, {
      id: 2,
      message: 'New tool added',
      link: '/convert/heic-to-jpg/',
      type: 'new'
    });
    await boot(dom, 'nav.js');

    const link = dom.window.document.getElementById('announcement-bar__link');
    expect(link.classList.contains('hidden')).toBe(false);
    expect(link.getAttribute('href')).toBe('/convert/heic-to-jpg/');
  });

  it('rejects an unsafe link scheme (javascript:) — bar still shows, link stays hidden', async () => {
    const dom = createDom(BAR);
    withApi(dom);
    // eslint-disable-next-line no-script-url
    mockActive(dom, { id: 9, message: 'Click me', link: 'javascript:alert(1)', type: 'info' });
    await boot(dom, 'nav.js');

    const bar = dom.window.document.getElementById('announcement-bar');
    const link = dom.window.document.getElementById('announcement-bar__link');
    expect(bar.classList.contains('hidden')).toBe(false); // message still shown
    expect(link.classList.contains('hidden')).toBe(true); // but the unsafe link is not exposed
    expect(link.getAttribute('href')).toBeNull();
  });

  it('accepts an absolute https link', async () => {
    const dom = createDom(BAR);
    withApi(dom);
    mockActive(dom, {
      id: 10,
      message: 'Read the post',
      link: 'https://blog.example.com/x',
      type: 'info'
    });
    await boot(dom, 'nav.js');
    const link = dom.window.document.getElementById('announcement-bar__link');
    expect(link.classList.contains('hidden')).toBe(false);
    expect(link.getAttribute('href')).toBe('https://blog.example.com/x');
  });

  it('stays hidden when there is no active row', async () => {
    const dom = createDom(BAR);
    withApi(dom);
    mockActive(dom, null);
    await boot(dom, 'nav.js');
    expect(
      dom.window.document.getElementById('announcement-bar').classList.contains('hidden')
    ).toBe(true);
  });

  it('stays hidden and does not throw when the API is down', async () => {
    const dom = createDom(BAR);
    withApi(dom);
    dom.window.fetch = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')));
    await expect(boot(dom, 'nav.js')).resolves.toBeUndefined();
    expect(
      dom.window.document.getElementById('announcement-bar').classList.contains('hidden')
    ).toBe(true);
  });

  it('stays hidden when no API base is configured', async () => {
    const dom = createDom(BAR);
    const fetchFn = vi.fn();
    dom.window.fetch = fetchFn; // no window.FILECAST
    await boot(dom, 'nav.js');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(
      dom.window.document.getElementById('announcement-bar').classList.contains('hidden')
    ).toBe(true);
  });

  it('dismiss hides the bar and persists the dismissal keyed by announcement id', async () => {
    const dom = createDom(BAR);
    withApi(dom);
    mockActive(dom, { id: 7, message: 'Heads up', link: null, type: 'info' });
    await boot(dom, 'nav.js');

    const bar = dom.window.document.getElementById('announcement-bar');
    expect(bar.classList.contains('hidden')).toBe(false);

    dom.window.document.getElementById('announcement-bar__dismiss').click();
    expect(bar.classList.contains('hidden')).toBe(true);
    expect(dom.window.localStorage.getItem('fc_announcement_dismissed')).toBe('7');
  });

  it('respects a prior dismissal of the same announcement id', async () => {
    const dom = createDom(BAR);
    withApi(dom);
    dom.window.localStorage.setItem('fc_announcement_dismissed', '7');
    mockActive(dom, { id: 7, message: 'Heads up again', link: null, type: 'info' });
    await boot(dom, 'nav.js');
    expect(
      dom.window.document.getElementById('announcement-bar').classList.contains('hidden')
    ).toBe(true);
  });
});
