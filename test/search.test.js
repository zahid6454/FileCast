import { describe, it, expect, vi } from 'vitest';
import { createDom, boot } from './helpers.js';

const HERO = `
  <div class="hero-search">
    <input id="hero-search" role="combobox" aria-expanded="false"
           aria-controls="hero-search-results" aria-autocomplete="list">
    <ul id="hero-search-results" class="hidden" role="listbox"></ul>
  </div>`;

const TOOLS = [
  { id: 'a', name: 'HEIC to JPG', slug: '/convert/heic-to-jpg', input_format: 'HEIC', output_format: 'JPG', tagline: '' },
  { id: 'b', name: 'PNG to WebP', slug: '/convert/png-to-webp', input_format: 'PNG', output_format: 'WebP', tagline: '' }
];

function mockFetch(dom, payload) {
  const fn = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }));
  dom.window.fetch = fn;
  return fn;
}

describe('nav.js hero search — fetch gating (P21)', () => {
  it('does NOT fetch tool-data.json when #hero-search is absent', async () => {
    const dom = createDom('<button id="theme-toggle"></button>');
    const fetchFn = mockFetch(dom, TOOLS);
    await boot(dom, 'nav.js');
    const urls = fetchFn.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('tool-data.json'))).toBe(false);
  });

  it('fetches tool-data.json exactly once when #hero-search exists', async () => {
    const dom = createDom(HERO);
    const fetchFn = mockFetch(dom, TOOLS);
    await boot(dom, 'nav.js');
    const toolDataCalls = fetchFn.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes('tool-data.json'));
    expect(toolDataCalls.length).toBe(1);
  });
});

describe('nav.js hero search — combobox a11y (P22)', () => {
  async function bootHero() {
    const dom = createDom(HERO);
    mockFetch(dom, TOOLS);
    await boot(dom, 'nav.js');
    return dom;
  }

  it('renders role=option rows and toggles aria-expanded on input', async () => {
    const dom = await bootHero();
    const input = dom.window.document.getElementById('hero-search');
    const results = dom.window.document.getElementById('hero-search-results');

    input.value = 'heic';
    input.dispatchEvent(new dom.window.Event('input'));

    const opts = results.querySelectorAll('[role="option"]');
    expect(opts.length).toBe(1);
    expect(opts[0].id).toBeTruthy();
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(results.classList.contains('hidden')).toBe(false);
  });

  it('ArrowDown sets aria-activedescendant and Escape closes', async () => {
    const dom = await bootHero();
    const input = dom.window.document.getElementById('hero-search');
    const results = dom.window.document.getElementById('hero-search-results');

    input.value = 'to'; // matches both tools
    input.dispatchEvent(new dom.window.Event('input'));
    const opts = results.querySelectorAll('[role="option"]');
    expect(opts.length).toBe(2);

    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(input.getAttribute('aria-activedescendant')).toBe(opts[0].id);
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(input.getAttribute('aria-activedescendant')).toBe(opts[1].id);

    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(results.classList.contains('hidden')).toBe(true);
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('degrades quietly when the fetch fails (no throw, input stays usable)', async () => {
    const dom = createDom(HERO);
    dom.window.fetch = vi.fn(() => Promise.reject(new Error('offline')));
    await boot(dom, 'nav.js');
    const input = dom.window.document.getElementById('hero-search');
    const results = dom.window.document.getElementById('hero-search-results');
    // Typing does nothing harmful; dropdown stays hidden, no exception.
    input.value = 'heic';
    expect(() => input.dispatchEvent(new dom.window.Event('input'))).not.toThrow();
    expect(results.classList.contains('hidden')).toBe(true);
  });
});
