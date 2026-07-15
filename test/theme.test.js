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

describe('nav.js theme toggle (simple light ↔ dark, no wasted click)', () => {
  const TOGGLE = '<button id="theme-toggle"></button>';

  async function bootToggle() {
    const dom = createDom(TOGGLE);
    await boot(dom, 'nav.js');
    return dom;
  }

  it('flips light ↔ dark on every click, storing an explicit choice each time', async () => {
    const dom = await bootToggle();
    const btn = dom.window.document.getElementById('theme-toggle');
    const html = dom.window.document.documentElement;

    // Fresh: no stored choice → resolves to the OS preference. jsdom has no
    // matchMedia, so systemPrefersDark() is false → effective 'light'.
    expect(dom.window.localStorage.getItem('fc_theme')).toBeNull();
    expect(btn.dataset.themeState).toBe('light');

    btn.click(); // light → dark (first click flips visibly — no wasted step)
    expect(dom.window.localStorage.getItem('fc_theme')).toBe('dark');
    expect(html.dataset.theme).toBe('dark');
    expect(btn.dataset.themeState).toBe('dark');

    btn.click(); // dark → light
    expect(dom.window.localStorage.getItem('fc_theme')).toBe('light');
    expect(html.dataset.theme).toBe('light');
    expect(btn.dataset.themeState).toBe('light');
  });

  it('picks up an already-stored choice on load', async () => {
    const dom = createDom(TOGGLE);
    dom.window.localStorage.setItem('fc_theme', 'dark');
    await boot(dom, 'nav.js');
    const btn = dom.window.document.getElementById('theme-toggle');
    expect(btn.dataset.themeState).toBe('dark');
    // First click flips straight to light.
    btn.click();
    expect(dom.window.localStorage.getItem('fc_theme')).toBe('light');
  });
});
