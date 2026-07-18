import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('theme-init.js (anti-FOUC + auth marker, render-blocking)', () => {
  // Dark mode is a signed-in privilege (Phase 5): gated on the fc_logged_in cookie.
  it("applies a signed-in user's stored dark choice before paint", () => {
    const dom = createDom();
    dom.window.document.cookie = 'fc_logged_in=1';
    dom.window.localStorage.setItem('fc_theme', 'dark');
    evalScript(dom, 'theme-init.js');
    expect(dom.window.document.documentElement.dataset.theme).toBe('dark');
  });

  it("applies a signed-in user's stored light choice", () => {
    const dom = createDom();
    dom.window.document.cookie = 'fc_logged_in=1';
    dom.window.localStorage.setItem('fc_theme', 'light');
    evalScript(dom, 'theme-init.js');
    expect(dom.window.document.documentElement.dataset.theme).toBe('light');
  });

  it('signed-in with no stored choice → data-theme UNSET (system governs)', () => {
    const dom = createDom();
    dom.window.document.cookie = 'fc_logged_in=1';
    evalScript(dom, 'theme-init.js');
    expect(dom.window.document.documentElement.dataset.theme).toBeUndefined();
  });

  it('FORCES light for anonymous, even with a stored dark choice (dark = signed-in perk)', () => {
    const dom = createDom();
    dom.window.localStorage.setItem('fc_theme', 'dark'); // no fc_logged_in cookie
    evalScript(dom, 'theme-init.js');
    expect(dom.window.document.documentElement.dataset.theme).toBe('light');
  });

  it('sets data-auth from the fc_logged_in cookie (drives the account no-flash rule)', () => {
    const signedIn = createDom();
    signedIn.window.document.cookie = 'fc_logged_in=1';
    evalScript(signedIn, 'theme-init.js');
    expect(signedIn.window.document.documentElement.dataset.auth).toBe('in');

    const anon = createDom();
    evalScript(anon, 'theme-init.js');
    expect(anon.window.document.documentElement.dataset.auth).toBe('out');
  });
});
