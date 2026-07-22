// Site Settings tab (#settings) — Phase 7 §4.
//
// Edits the singleton overlay behind GET/PUT /api/v1/admin/site-settings: the
// site display copy (name/tagline/description) and the AdSense / GA4 / Sentry
// integration toggles. These values BAKE INTO STATIC HTML at build time, so on
// Save this calls plain ADMIN.notifySaved() (NO { live:true } — that flag skips
// the rebuild and is only for the runtime-fetched announcement bar; §5.3b).
//
// Client validation mirrors the server's injection-guard regexes/lengths (§3.3)
// for fast feedback, but the server stays authoritative (422 before any rebuild).
// All DOM is built via ADMIN.dom (textContent only, no innerHTML — P23) and every
// handler is bound with addEventListener (no on* attributes — P7).
(function () {
  'use strict';
  var ADMIN = (window.ADMIN = window.ADMIN || {});
  ADMIN.tabs = ADMIN.tabs || {};
  var dom = ADMIN.dom;
  var api = ADMIN.api;
  var h = dom.h;

  var CONTAINER = null;

  // Mirror of api/data/routers/site_settings.py — keep in lock-step with §3.3.
  var PUBLISHER_RE = /^ca-pub-\d{16}$/;
  var MEASUREMENT_RE = /^G-[A-Z0-9]{4,}$/;
  var SLOT_RE = /^\d+$/;
  var NAME_MAX = 80;
  var TAGLINE_MAX = 160;
  var DESCRIPTION_MAX = 300;

  var DEFAULTS = {
    site_name: '',
    site_tagline: '',
    site_description: '',
    adsense_enabled: false,
    adsense_publisher_id: '',
    adsense_slot_leaderboard: '',
    adsense_slot_in_content: '',
    ga4_enabled: false,
    ga4_measurement_id: '',
    sentry_enabled: false,
    sentry_dsn: ''
  };

  function isSentryDsn(v) {
    try {
      var u = new URL(v);
      var host = u.hostname;
      return u.protocol === 'https:' && (host === 'sentry.io' || /\.sentry\.io$/.test(host));
    } catch (e) {
      return false;
    }
  }

  // Pure validator: returns { field: message } for every rule the body breaks.
  // Empty object ⇒ valid. Same rules (and order of intent) as the server so a
  // value the client accepts the server accepts too.
  function validate(body) {
    var errors = {};
    var name = (body.site_name || '').trim();
    if (!name) errors.site_name = 'Required.';
    else if (name.length > NAME_MAX) errors.site_name = 'Must be ≤ ' + NAME_MAX + ' characters.';

    var tagline = (body.site_tagline || '').trim();
    if (!tagline) errors.site_tagline = 'Required.';
    else if (tagline.length > TAGLINE_MAX)
      errors.site_tagline = 'Must be ≤ ' + TAGLINE_MAX + ' characters.';

    if ((body.site_description || '').trim().length > DESCRIPTION_MAX)
      errors.site_description = 'Must be ≤ ' + DESCRIPTION_MAX + ' characters.';

    var pub = (body.adsense_publisher_id || '').trim();
    if (pub && !PUBLISHER_RE.test(pub))
      errors.adsense_publisher_id = 'Must look like ca-pub-<16 digits>.';
    var slotL = (body.adsense_slot_leaderboard || '').trim();
    if (slotL && !SLOT_RE.test(slotL)) errors.adsense_slot_leaderboard = 'Must be numeric.';
    var slotC = (body.adsense_slot_in_content || '').trim();
    if (slotC && !SLOT_RE.test(slotC)) errors.adsense_slot_in_content = 'Must be numeric.';
    if (body.adsense_enabled && !pub)
      errors.adsense_publisher_id = 'Required when AdSense is enabled.';

    var mid = (body.ga4_measurement_id || '').trim();
    if (mid && !MEASUREMENT_RE.test(mid)) errors.ga4_measurement_id = 'Must look like G-XXXXXXXX.';
    if (body.ga4_enabled && !mid) errors.ga4_measurement_id = 'Required when GA4 is enabled.';

    var dsn = (body.sentry_dsn || '').trim();
    if (dsn && !isSentryDsn(dsn)) errors.sentry_dsn = 'Must be an https://…sentry.io URL.';
    if (body.sentry_enabled && !dsn) errors.sentry_dsn = 'Required when Sentry is enabled.';

    return errors;
  }

  // A labelled control with an inline (initially empty) error slot underneath.
  function field(labelText, control, hint) {
    var err = h('span', { class: 'admin-field__error', role: 'alert', hidden: true });
    var kids = [h('span', { class: 'admin-field__label' }, labelText), control];
    if (hint) kids.push(h('span', { class: 'admin-field__hint' }, hint));
    kids.push(err);
    var wrap = h('label', { class: 'admin-field' }, kids);
    wrap._errSlot = err;
    return wrap;
  }

  function textInput(nameAttr, value, placeholder) {
    return h('input', {
      type: 'text',
      class: 'admin-input',
      name: nameAttr,
      value: value || '',
      placeholder: placeholder || ''
    });
  }

  function checkbox(nameAttr, checked) {
    var cb = h('input', { type: 'checkbox', name: nameAttr });
    if (checked) cb.checked = true;
    return cb;
  }

  function buildForm(s) {
    // --- Site copy -------------------------------------------------------
    var name = textInput('site_name', s.site_name, 'FileCast');
    var tagline = textInput('site_tagline', s.site_tagline, 'Free File Conversion — …');
    var description = h('textarea', {
      class: 'admin-input',
      name: 'site_description',
      rows: '3',
      placeholder: 'One-sentence meta description (≤ 300 chars)'
    });
    description.value = s.site_description || '';

    // --- AdSense ---------------------------------------------------------
    var adsenseEnabled = checkbox('adsense_enabled', s.adsense_enabled);
    var publisherId = textInput('adsense_publisher_id', s.adsense_publisher_id, 'ca-pub-…');
    var slotLeaderboard = textInput(
      'adsense_slot_leaderboard',
      s.adsense_slot_leaderboard,
      'numeric slot id'
    );
    var slotInContent = textInput(
      'adsense_slot_in_content',
      s.adsense_slot_in_content,
      'numeric slot id'
    );

    // --- GA4 -------------------------------------------------------------
    var ga4Enabled = checkbox('ga4_enabled', s.ga4_enabled);
    var measurementId = textInput('ga4_measurement_id', s.ga4_measurement_id, 'G-XXXXXXXX');

    // --- Sentry ----------------------------------------------------------
    var sentryEnabled = checkbox('sentry_enabled', s.sentry_enabled);
    var sentryDsn = textInput('sentry_dsn', s.sentry_dsn, 'https://…@…ingest.sentry.io/…');

    // Field wrappers (so we can surface per-field errors by name).
    var fields = {
      site_name: field('Site name', name),
      site_tagline: field('Tagline', tagline),
      site_description: field('Meta description', description),
      adsense_publisher_id: field('Publisher ID', publisherId),
      adsense_slot_leaderboard: field('Leaderboard slot', slotLeaderboard),
      adsense_slot_in_content: field('In-content slot', slotInContent),
      ga4_measurement_id: field('Measurement ID', measurementId),
      sentry_dsn: field('DSN', sentryDsn)
    };

    function readBody() {
      return {
        site_name: name.value,
        site_tagline: tagline.value,
        site_description: description.value,
        adsense_enabled: adsenseEnabled.checked,
        adsense_publisher_id: publisherId.value,
        adsense_slot_leaderboard: slotLeaderboard.value,
        adsense_slot_in_content: slotInContent.value,
        ga4_enabled: ga4Enabled.checked,
        ga4_measurement_id: measurementId.value,
        sentry_enabled: sentryEnabled.checked,
        sentry_dsn: sentryDsn.value
      };
    }

    function clearErrors() {
      Object.keys(fields).forEach(function (k) {
        var slot = fields[k]._errSlot;
        slot.textContent = '';
        slot.hidden = true;
        fields[k].classList.remove('admin-field--invalid');
      });
    }

    function showErrors(errors) {
      clearErrors();
      Object.keys(errors).forEach(function (k) {
        var wrap = fields[k];
        if (!wrap) return;
        wrap._errSlot.textContent = errors[k];
        wrap._errSlot.hidden = false;
        wrap.classList.add('admin-field--invalid');
      });
    }

    var save = h('button', { type: 'button', class: 'admin-btn admin-btn--primary' }, 'Save');
    save.addEventListener('click', function () {
      var body = readBody();
      var errors = validate(body);
      if (Object.keys(errors).length > 0) {
        showErrors(errors);
        ADMIN.toast('Please fix the highlighted fields', 'error');
        return;
      }
      clearErrors();
      submit(body, save);
    });

    var group = function (title, note, controls) {
      var kids = [h('h2', { class: 'admin-card__title' }, title)];
      if (note) kids.push(h('p', { class: 'admin-card__note admin-muted' }, note));
      controls.forEach(function (c) {
        kids.push(c);
      });
      return h('section', { class: 'admin-card' }, kids);
    };

    var checkLabel = function (cb, text) {
      return h('label', { class: 'admin-check' }, [cb, h('span', text)]);
    };

    return h('div', { class: 'admin-form admin-settings' }, [
      group('Site', 'Display copy baked into every page — title, hero and meta tags.', [
        fields.site_name,
        fields.site_tagline,
        fields.site_description
      ]),
      group('AdSense', 'Off until Google approval. IDs are validated before they bake into HTML.', [
        checkLabel(adsenseEnabled, 'Enable AdSense'),
        fields.adsense_publisher_id,
        fields.adsense_slot_leaderboard,
        fields.adsense_slot_in_content
      ]),
      group('Google Analytics (GA4)', null, [
        checkLabel(ga4Enabled, 'Enable GA4'),
        fields.ga4_measurement_id
      ]),
      group('Sentry', null, [checkLabel(sentryEnabled, 'Enable Sentry'), fields.sentry_dsn]),
      h('div', { class: 'admin-form__actions' }, [save])
    ]);
  }

  function submit(body, saveBtn) {
    if (saveBtn) saveBtn.disabled = true;
    api
      .put('/api/v1/admin/site-settings', body)
      .then(function () {
        // Site settings bake at BUILD time → plain notifySaved() so the rebuild
        // fires. Passing { live:true } here would leave the change in the DB and
        // absent from the live site, silently (§5.3b).
        ADMIN.notifySaved();
        render(CONTAINER); // re-fetch → reflect the persisted (server-normalized) row
      })
      .catch(function (err) {
        if (saveBtn) saveBtn.disabled = false;
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        ADMIN.toast((err && err.message) || 'Save failed', 'error');
      });
  }

  function render(container) {
    CONTAINER = container;
    dom.clear(container);
    container.appendChild(h('div', { class: 'admin-loading' }, 'Loading settings…'));

    api
      .get('/api/v1/admin/site-settings')
      .then(function (data) {
        dom.clear(container);
        var s = (data && data.site_settings) || DEFAULTS;
        container.appendChild(buildForm(s));
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        dom.clear(container);
        var retry = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost' }, 'Retry');
        retry.addEventListener('click', function () {
          render(container);
        });
        container.appendChild(
          h('div', { class: 'admin-error-state' }, [h('p', "Couldn't load settings."), retry])
        );
      });
  }

  ADMIN.tabs.settings = { render: render, validate: validate };
})();
