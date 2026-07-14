import { describe, it, expect } from 'vitest';
import { createDom, evalScript, boot } from './helpers.js';

describe('theme-init.js (anti-FOUC, render-blocking)', () => {
  it('applies a stored dark choice to <html> before paint', () => {
    const dom = createDom();
    dom.window.localStorage.setItem('fc_theme', 'dark');
    evalScript(dom, 'theme-init.js');
    expect(dom.window.document.documentElement.dataset.theme).toBe('dark');
  });

  it('applies a stored light choice', () => {
    const dom = createDom();
    dom.window.localStorage.setItem('fc_theme', 'light');
    evalScript(dom, 'theme-init.js');
    expect(dom.window.document.documentElement.dataset.theme).toBe('light');
  });

  it('leaves data-theme UNSET when no choice is stored (system governs via media query)', () => {
    const dom = createDom();
    evalScript(dom, 'theme-init.js');
    expect(dom.window.document.documentElement.dataset.theme).toBeUndefined();
  });
});

describe('nav.js theme toggle (light → dark → system, P20 both selectors)', () => {
  const TOGGLE = '<button id="theme-toggle" data-theme-state="system"></button>';

  async function bootToggle() {
    const dom = createDom(TOGGLE);
    await boot(dom, 'nav.js');
    return dom;
  }

  it('cycles the stored key and the live [data-theme] selector, and reflects the button state', async () => {
    const dom = await bootToggle();
    const btn = dom.window.document.getElementById('theme-toggle');
    const html = dom.window.document.documentElement;

    // Fresh: no stored choice → system (media query governs; data-theme unset)
    expect(dom.window.localStorage.getItem('fc_theme')).toBeNull();
    expect(btn.dataset.themeState).toBe('system');

    btn.click(); // system → light (explicit choice wins over the media query)
    expect(dom.window.localStorage.getItem('fc_theme')).toBe('light');
    expect(html.dataset.theme).toBe('light');
    expect(btn.dataset.themeState).toBe('light');

    btn.click(); // light → dark
    expect(dom.window.localStorage.getItem('fc_theme')).toBe('dark');
    expect(html.dataset.theme).toBe('dark');
    expect(btn.dataset.themeState).toBe('dark');

    btn.click(); // dark → system (clear the key; unset data-theme)
    expect(dom.window.localStorage.getItem('fc_theme')).toBeNull();
    expect(html.dataset.theme).toBeUndefined();
    expect(btn.dataset.themeState).toBe('system');
  });

  it('picks up an already-stored choice on load (no conflict between selectors)', async () => {
    const dom = createDom(TOGGLE);
    dom.window.localStorage.setItem('fc_theme', 'dark');
    await boot(dom, 'nav.js');
    const btn = dom.window.document.getElementById('theme-toggle');
    expect(btn.dataset.themeState).toBe('dark');
  });
});
