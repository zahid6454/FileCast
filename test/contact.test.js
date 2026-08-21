import { describe, expect, it } from 'vitest';
import { createDom, evalScript, flush } from './helpers.js';

// Contact page form (contact.js). The one behavior under test: the mailto
// fallback (templates/contact.html) is visible by default in raw HTML so a
// visitor still has an escape hatch if this script never runs at all (SRI
// mismatch, an ad-blocker targeting contact.js specifically) — cases the
// sitewide <noscript> banner says nothing about, since JS as a whole isn't
// disabled. init() must hide it, but only once it has actually confirmed the
// JS-powered form is live (#contact-form present) — never unconditionally.

const FORM_HTML = `
  <form id="contact-form" class="contact-form">
    <input id="contact-title" name="title">
    <textarea id="contact-body" name="body"></textarea>
    <input id="contact-email" name="email" type="email">
    <input id="contact-website" name="website">
    <button id="contact-submit" type="submit">Send message</button>
    <p id="contact-status" role="status"></p>
  </form>
  <p class="contact-form__fallback" id="contact-fallback">
    Form not working, or prefer email? Write to <a href="mailto:support@filecast.org">support@filecast.org</a> directly.
  </p>
`;

describe('contact.js', () => {
  it('hides the fallback once the JS-powered form is confirmed wired up', async () => {
    const dom = createDom(FORM_HTML);
    evalScript(dom, 'contact.js');
    await flush();

    expect(dom.window.document.getElementById('contact-fallback').hidden).toBe(true);
  });

  it('leaves the fallback visible when the form element is missing (init bails early)', async () => {
    // Simulates the exact gap this fallback exists for: something prevented
    // the JS-powered form from taking over, so the escape hatch must stay.
    const dom = createDom('<p class="contact-form__fallback" id="contact-fallback">fallback</p>');
    evalScript(dom, 'contact.js');
    await flush();

    expect(dom.window.document.getElementById('contact-fallback').hidden).toBe(false);
  });
});
