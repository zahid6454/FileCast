import { describe, expect, it } from 'vitest';
import { createDom, evalScript, flush } from './helpers.js';

// The Site Settings tab (Phase 7 §4). We eval the production module into a JSDOM
// window (no test hooks in the source), stub the app.js-provided globals it calls
// (toast/notifySaved), and drive it through a mocked fetch. Focus: the tab
// registers on ADMIN.tabs, client validation mirrors the server's injection
// guard, a bad field blocks the PUT, and a good Save issues a PUT then calls
// notifySaved() with NO { live:true } (settings bake at build time — §5.3b).

function makeResponse(status, bodyText) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(bodyText === undefined ? '' : bodyText)
  });
}

function load(fetchImpl) {
  const dom = createDom('<div id="c"></div>');
  dom.window.FILECAST = { apiBase: 'https://api.test' };
  dom.window.fetch = fetchImpl || (() => makeResponse(200, '{"site_settings":null}'));
  evalScript(dom, 'admin/dom.js');
  evalScript(dom, 'admin/api.js');
  evalScript(dom, 'admin/settings.js');
  const ADMIN = dom.window.ADMIN;
  // Provided by app.js in production; stub here so submit()/error paths don't throw.
  ADMIN.toast = () => {};
  ADMIN.onAuthError = () => {};
  return dom;
}

const VALID = {
  site_name: 'FileCast',
  site_tagline: 'Free File Conversion',
  site_description: 'Convert files privately in your browser.',
  adsense_enabled: false,
  adsense_publisher_id: '',
  adsense_slot_leaderboard: '',
  adsense_slot_in_content: '',
  ga4_enabled: false,
  ga4_measurement_id: '',
  sentry_enabled: false,
  sentry_dsn: ''
};

describe('admin/settings.js — tab contract', () => {
  it('registers on ADMIN.tabs with render + validate', () => {
    const dom = load();
    const tab = dom.window.ADMIN.tabs.settings;
    expect(typeof tab.render).toBe('function');
    expect(typeof tab.validate).toBe('function');
  });

  it('renders the full form (all named fields present)', async () => {
    const dom = load();
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.settings.render(c);
    await flush();
    const names = [
      'site_name',
      'site_tagline',
      'site_description',
      'adsense_enabled',
      'adsense_publisher_id',
      'adsense_slot_leaderboard',
      'adsense_slot_in_content',
      'ga4_enabled',
      'ga4_measurement_id',
      'sentry_enabled',
      'sentry_dsn'
    ];
    names.forEach((n) => {
      expect(c.querySelector('[name="' + n + '"]'), n).not.toBeNull();
    });
  });
});

describe('admin/settings.js — validate() mirrors the server', () => {
  function v(overrides) {
    const dom = load();
    return dom.window.ADMIN.tabs.settings.validate({ ...VALID, ...overrides });
  }

  it('accepts a clean body', () => {
    expect(v({})).toEqual({});
  });

  it('rejects empty name / tagline', () => {
    expect(v({ site_name: '' }).site_name).toBeTruthy();
    expect(v({ site_name: '   ' }).site_name).toBeTruthy();
    expect(v({ site_tagline: '' }).site_tagline).toBeTruthy();
  });

  it('rejects oversize copy', () => {
    expect(v({ site_name: 'x'.repeat(81) }).site_name).toBeTruthy();
    expect(v({ site_tagline: 'x'.repeat(161) }).site_tagline).toBeTruthy();
    expect(v({ site_description: 'x'.repeat(301) }).site_description).toBeTruthy();
  });

  it('rejects a malformed publisher id but accepts a valid one', () => {
    expect(v({ adsense_publisher_id: 'pub-123' }).adsense_publisher_id).toBeTruthy();
    expect(v({ adsense_publisher_id: 'ca-pub-123' }).adsense_publisher_id).toBeTruthy();
    expect(
      v({ adsense_publisher_id: 'ca-pub-1234567890123456' }).adsense_publisher_id
    ).toBeUndefined();
  });

  it('rejects a non-numeric ad slot', () => {
    expect(v({ adsense_slot_leaderboard: 'abc' }).adsense_slot_leaderboard).toBeTruthy();
    expect(v({ adsense_slot_in_content: '12a' }).adsense_slot_in_content).toBeTruthy();
    expect(v({ adsense_slot_leaderboard: '123' }).adsense_slot_leaderboard).toBeUndefined();
  });

  it('rejects a bad GA4 id', () => {
    expect(v({ ga4_measurement_id: 'UA-123' }).ga4_measurement_id).toBeTruthy();
    expect(v({ ga4_measurement_id: 'G-ABCD1234' }).ga4_measurement_id).toBeUndefined();
  });

  it('rejects a non-sentry DSN and non-https', () => {
    expect(v({ sentry_dsn: 'https://evil.example.com/1' }).sentry_dsn).toBeTruthy();
    expect(v({ sentry_dsn: 'http://o1.ingest.sentry.io/1' }).sentry_dsn).toBeTruthy();
    expect(v({ sentry_dsn: 'https://abc@o1.ingest.sentry.io/42' }).sentry_dsn).toBeUndefined();
  });

  it('requires the id when an integration is enabled', () => {
    expect(v({ adsense_enabled: true }).adsense_publisher_id).toBeTruthy();
    expect(v({ ga4_enabled: true }).ga4_measurement_id).toBeTruthy();
    expect(v({ sentry_enabled: true }).sentry_dsn).toBeTruthy();
  });
});

describe('admin/settings.js — Save', () => {
  function setField(c, name, value) {
    const el = c.querySelector('[name="' + name + '"]');
    el.value = value;
    return el;
  }

  it('blocks the PUT and shows an error when a field is invalid', async () => {
    const calls = [];
    const dom = load((url, opts) => {
      calls.push({ url, method: (opts && opts.method) || 'GET' });
      return makeResponse(200, '{"site_settings":null}');
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.settings.render(c);
    await flush();

    setField(c, 'site_name', 'OK');
    setField(c, 'site_tagline', 'OK');
    setField(c, 'adsense_publisher_id', 'not-valid'); // bad
    c.querySelector('.admin-form__actions .admin-btn--primary').click();
    await flush();

    // Only the initial GET happened — no PUT.
    expect(calls.filter((x) => x.method === 'PUT').length).toBe(0);
    const pub = c.querySelector('[name="adsense_publisher_id"]');
    const errSlot = pub.closest('.admin-field').querySelector('.admin-field__error');
    expect(errSlot.hidden).toBe(false);
    expect(errSlot.textContent).toBeTruthy();
    // a11y: the invalid control is flagged for assistive tech.
    expect(pub.getAttribute('aria-invalid')).toBe('true');
  });

  it('clears a prior error once the fixed body validates and issues the PUT', async () => {
    const calls = [];
    const dom = load((url, opts) => {
      calls.push({ method: (opts && opts.method) || 'GET' });
      return makeResponse(200, '{"site_settings":null}');
    });
    dom.window.ADMIN.notifySaved = () => {};
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.settings.render(c);
    await flush();

    setField(c, 'site_name', 'OK');
    setField(c, 'site_tagline', 'OK');
    const pub = setField(c, 'adsense_publisher_id', 'bad');
    c.querySelector('.admin-form__actions .admin-btn--primary').click();
    await flush();
    expect(pub.getAttribute('aria-invalid')).toBe('true');
    expect(calls.filter((x) => x.method === 'PUT').length).toBe(0);

    // Fix the field and re-save → the error clears and the PUT fires.
    setField(c, 'adsense_publisher_id', 'ca-pub-1234567890123456');
    c.querySelector('.admin-form__actions .admin-btn--primary').click();
    await flush();
    expect(calls.filter((x) => x.method === 'PUT').length).toBe(1);
  });

  it('issues a PUT with the body and calls notifySaved() with NO { live:true }', async () => {
    const calls = [];
    const dom = load((url, opts) => {
      const method = (opts && opts.method) || 'GET';
      calls.push({ url, method, body: opts && opts.body });
      return makeResponse(200, '{"site_settings":null}');
    });
    let savedArg = 'UNSET';
    dom.window.ADMIN.notifySaved = (o) => {
      savedArg = o;
    };
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.settings.render(c);
    await flush();

    setField(c, 'site_name', 'FileCast');
    setField(c, 'site_tagline', 'A tagline');
    c.querySelector('.admin-form__actions .admin-btn--primary').click();
    await flush();

    const put = calls.find((x) => x.method === 'PUT');
    expect(put).toBeTruthy();
    expect(put.url).toBe('https://api.test/api/v1/admin/site-settings');
    expect(JSON.parse(put.body).site_name).toBe('FileCast');
    // §5.3b: settings bake at build time — notifySaved must run the rebuild path,
    // so it is called with no argument (passing { live:true } would skip it).
    expect(savedArg).toBeUndefined();
  });
});
