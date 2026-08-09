import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

// consent.js is what actually requests gtag.js / adsbygoogle.js — the two
// vendor loaders that set tracking cookies — gated on a stored decision. It
// reads its config from a JSON data island (not document.currentScript), so
// a plain eval() harness can drive it with no real <script> element involved.

const BANNER = `
  <div class="cookie-consent hidden" id="cookie-consent">
    <button id="cookie-consent__reject" type="button"></button>
    <button id="cookie-consent__accept" type="button"></button>
  </div>`;

function withConfig(dom, config) {
  const el = dom.window.document.createElement('script');
  el.type = 'application/json';
  el.id = 'cookie-consent-config';
  el.textContent = JSON.stringify(config);
  dom.window.document.body.appendChild(el);
}

function injectedSrcs(dom) {
  return Array.from(dom.window.document.head.querySelectorAll('script[src]')).map((s) => s.src);
}

const GA4_SRC = 'https://www.googletagmanager.com/gtag/js?id=G-TEST';
const ADSENSE_SRC =
  'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1';

describe('consent.js', () => {
  it('does nothing when the config island is absent', () => {
    const dom = createDom(BANNER);
    evalScript(dom, 'consent.js');
    expect(injectedSrcs(dom)).toEqual([]);
    expect(dom.window.document.getElementById('cookie-consent').classList.contains('hidden')).toBe(
      true
    );
  });

  it('undecided: shows the banner and injects nothing yet', () => {
    const dom = createDom(BANNER);
    withConfig(dom, { ga4_src: GA4_SRC, adsense_src: null });
    evalScript(dom, 'consent.js');
    expect(dom.window.document.getElementById('cookie-consent').classList.contains('hidden')).toBe(
      false
    );
    expect(injectedSrcs(dom)).toEqual([]);
  });

  it('prior "granted" decision: injects the configured vendor scripts immediately, banner stays hidden', () => {
    const dom = createDom(BANNER);
    dom.window.localStorage.setItem('fc_cookie_consent', 'granted');
    withConfig(dom, { ga4_src: GA4_SRC, adsense_src: ADSENSE_SRC });
    evalScript(dom, 'consent.js');
    expect(injectedSrcs(dom).sort()).toEqual([ADSENSE_SRC, GA4_SRC].sort());
    expect(dom.window.document.getElementById('cookie-consent').classList.contains('hidden')).toBe(
      true
    );
  });

  it('prior "denied" decision: injects nothing, banner stays hidden', () => {
    const dom = createDom(BANNER);
    dom.window.localStorage.setItem('fc_cookie_consent', 'denied');
    withConfig(dom, { ga4_src: GA4_SRC, adsense_src: ADSENSE_SRC });
    evalScript(dom, 'consent.js');
    expect(injectedSrcs(dom)).toEqual([]);
    expect(dom.window.document.getElementById('cookie-consent').classList.contains('hidden')).toBe(
      true
    );
  });

  it('clicking Accept persists the decision, hides the banner, and injects only the configured scripts', () => {
    const dom = createDom(BANNER);
    withConfig(dom, { ga4_src: GA4_SRC, adsense_src: null });
    evalScript(dom, 'consent.js');

    dom.window.document.getElementById('cookie-consent__accept').click();

    expect(dom.window.localStorage.getItem('fc_cookie_consent')).toBe('granted');
    expect(dom.window.document.getElementById('cookie-consent').classList.contains('hidden')).toBe(
      true
    );
    expect(injectedSrcs(dom)).toEqual([GA4_SRC]);
  });

  it('clicking Reject persists the decision, hides the banner, and injects nothing', () => {
    const dom = createDom(BANNER);
    withConfig(dom, { ga4_src: GA4_SRC, adsense_src: ADSENSE_SRC });
    evalScript(dom, 'consent.js');

    dom.window.document.getElementById('cookie-consent__reject').click();

    expect(dom.window.localStorage.getItem('fc_cookie_consent')).toBe('denied');
    expect(dom.window.document.getElementById('cookie-consent').classList.contains('hidden')).toBe(
      true
    );
    expect(injectedSrcs(dom)).toEqual([]);
  });

  it('a malformed config island is treated as absent (no throw, banner stays hidden)', () => {
    const dom = createDom(BANNER);
    const el = dom.window.document.createElement('script');
    el.type = 'application/json';
    el.id = 'cookie-consent-config';
    el.textContent = '{not json';
    dom.window.document.body.appendChild(el);
    expect(() => evalScript(dom, 'consent.js')).not.toThrow();
    expect(dom.window.document.getElementById('cookie-consent').classList.contains('hidden')).toBe(
      true
    );
  });
});
