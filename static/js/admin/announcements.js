// Announcements tab (#announcements) — Phase 4 §8.3.
//
// CRUD with the one-active rule REFLECTED (re-fetch after each mutation, never
// assumed). Type values match the Phase 3 bar classes (info/new/maintenance/
// warning — R18) so the preview renders identically to the live bar. Datetimes
// are timezone-explicit: datetime-local is naive local, converted to UTC ISO on
// save and back to local for display (R18). Links are sanitized with safeHref.
(function () {
  'use strict';
  var ADMIN = (window.ADMIN = window.ADMIN || {});
  ADMIN.tabs = ADMIN.tabs || {};
  var dom = ADMIN.dom;
  var api = ADMIN.api;
  var h = dom.h;

  var TYPES = ['info', 'new', 'maintenance', 'warning'];
  var CONTAINER = null;

  // --- datetime helpers ---------------------------------------------------

  // UTC ISO (from server) → "YYYY-MM-DDTHH:mm" in the operator's local time.
  function isoToLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    function pad(n) {
      return String(n).padStart(2, '0');
    }
    return (
      d.getFullYear() +
      '-' +
      pad(d.getMonth() + 1) +
      '-' +
      pad(d.getDate()) +
      'T' +
      pad(d.getHours()) +
      ':' +
      pad(d.getMinutes())
    );
  }

  // "YYYY-MM-DDTHH:mm" (naive local) → explicit UTC ISO-8601, or null if blank.
  function localInputToIso(local) {
    if (!local) return null;
    var d = new Date(local); // parsed as local time
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function formatWindow(a) {
    var s = a.starts_at ? new Date(a.starts_at).toLocaleString() : null;
    var e = a.ends_at ? new Date(a.ends_at).toLocaleString() : null;
    if (!s && !e) return 'Always';
    return (s || '…') + ' → ' + (e || '…');
  }

  function statusOf(a) {
    if (!a.active) return { key: 'inactive', text: 'Inactive' };
    var now = Date.now();
    if (a.starts_at && new Date(a.starts_at).getTime() > now) {
      return { key: 'scheduled', text: 'Scheduled' };
    }
    if (a.ends_at && new Date(a.ends_at).getTime() < now) {
      return { key: 'expired', text: 'Expired' };
    }
    return { key: 'active', text: 'Active' };
  }

  // --- preview of the live bar -------------------------------------------

  function barPreview(a) {
    var type = TYPES.indexOf(a.type) >= 0 ? a.type : 'info';
    var children = [h('span', { class: 'announcement-bar__msg' }, a.message || '')];
    if (a.link) {
      var href = dom.safeHref(a.link);
      var link = h('a', { class: 'announcement-bar__link', href: href }, 'Learn more');
      if (href === '#') {
        link.setAttribute('aria-disabled', 'true');
        link.classList.add('is-inert');
      }
      children.push(link);
    }
    return h('div', { class: 'announcement-bar announcement-bar--' + type + ' admin-preview' }, children);
  }

  // --- form ---------------------------------------------------------------

  function buildForm(existing) {
    var a = existing || { message: '', link: '', type: 'info', active: false, starts_at: null, ends_at: null };

    var message = h('input', { type: 'text', class: 'admin-input', value: a.message || '', placeholder: 'Announcement text' });
    var link = h('input', { type: 'text', class: 'admin-input', value: a.link || '', placeholder: '/tools or https://…' });
    var type = h('select', { class: 'admin-input' });
    TYPES.forEach(function (t) {
      var opt = h('option', { value: t }, t);
      if (t === a.type) opt.setAttribute('selected', '');
      type.appendChild(opt);
    });
    var active = h('input', { type: 'checkbox' });
    if (a.active) active.checked = true;
    var starts = h('input', { type: 'datetime-local', class: 'admin-input', value: isoToLocalInput(a.starts_at) });
    var ends = h('input', { type: 'datetime-local', class: 'admin-input', value: isoToLocalInput(a.ends_at) });

    var preview = h('div', { class: 'admin-form__preview' }, barPreview(a));
    function updatePreview() {
      dom.clear(preview);
      preview.appendChild(
        barPreview({ message: message.value, link: link.value, type: type.value })
      );
    }
    message.addEventListener('input', updatePreview);
    link.addEventListener('input', updatePreview);
    type.addEventListener('change', updatePreview);

    var save = h('button', { type: 'button', class: 'admin-btn admin-btn--primary' }, existing ? 'Save' : 'Create');
    save.addEventListener('click', function () {
      submit(existing, {
        message: message.value.trim(),
        link: link.value.trim() || null,
        type: type.value,
        active: active.checked,
        starts_at: localInputToIso(starts.value),
        ends_at: localInputToIso(ends.value),
      });
    });
    var cancel = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost' }, 'Cancel');
    cancel.addEventListener('click', function () {
      render(CONTAINER);
    });

    return h('div', { class: 'admin-card admin-form' }, [
      h('h2', { class: 'admin-card__title' }, existing ? 'Edit announcement' : 'New announcement'),
      field('Message', message),
      field('Link (optional)', link),
      field('Type', type),
      field('Starts (local time)', starts),
      field('Ends (local time)', ends),
      h('label', { class: 'admin-check' }, [active, h('span', 'Active (only one announcement can be active)')]),
      field('Preview', preview),
      h('div', { class: 'admin-form__actions' }, [save, cancel]),
    ]);
  }

  function field(labelText, control) {
    return h('label', { class: 'admin-field' }, [
      h('span', { class: 'admin-field__label' }, labelText),
      control,
    ]);
  }

  function submit(existing, body) {
    if (!body.message) {
      ADMIN.toast('Message is required', 'error');
      return;
    }
    var req = existing
      ? api.put('/api/v1/announcements/' + existing.id, body)
      : api.post('/api/v1/announcements', body);
    req
      .then(function () {
        ADMIN.notifySaved({ live: true });
        render(CONTAINER); // re-fetch → one-active rule reflected
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        ADMIN.toast('Save failed', 'error');
      });
  }

  function setActive(a, next) {
    api
      .put('/api/v1/announcements/' + a.id, { active: next })
      .then(function () {
        ADMIN.notifySaved({ live: true });
        render(CONTAINER);
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        ADMIN.toast('Update failed', 'error');
      });
  }

  function remove(a) {
    api
      .del('/api/v1/announcements/' + a.id)
      .then(function () {
        ADMIN.notifySaved({ live: true });
        render(CONTAINER);
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        ADMIN.toast('Delete failed', 'error');
      });
  }

  // --- list ---------------------------------------------------------------

  function listRow(a) {
    var status = statusOf(a);
    var edit = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost' }, 'Edit');
    edit.addEventListener('click', function () {
      showForm(a);
    });
    var toggle = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost' }, a.active ? 'Deactivate' : 'Activate');
    toggle.addEventListener('click', function () {
      setActive(a, !a.active);
    });
    var del = h('button', { type: 'button', class: 'admin-btn admin-btn--danger' }, 'Delete');
    del.addEventListener('click', function () {
      remove(a);
    });

    return h('li', { class: 'admin-annc' }, [
      h('div', { class: 'admin-annc__main' }, [
        h('div', { class: 'admin-annc__row' }, [
          h('span', { class: 'admin-badge admin-badge--' + status.key }, status.text),
          h('span', { class: 'admin-annc__type' }, a.type),
        ]),
        h('div', { class: 'admin-annc__msg' }, a.message || ''),
        h('div', { class: 'admin-annc__window' }, formatWindow(a)),
      ]),
      h('div', { class: 'admin-annc__actions' }, [toggle, edit, del]),
    ]);
  }

  function showForm(existing) {
    dom.clear(CONTAINER);
    CONTAINER.appendChild(buildForm(existing));
  }

  function render(container) {
    CONTAINER = container;
    dom.clear(container);
    container.appendChild(h('div', { class: 'admin-loading' }, 'Loading announcements…'));

    api
      .get('/api/v1/announcements')
      .then(function (data) {
        var items = (data && data.announcements) || [];
        dom.clear(container);

        var newBtn = h('button', { type: 'button', class: 'admin-btn admin-btn--primary' }, '+ New announcement');
        newBtn.addEventListener('click', function () {
          showForm(null);
        });
        container.appendChild(h('div', { class: 'admin-toolbar' }, [newBtn]));

        var active = items.filter(function (a) {
          return statusOf(a).key === 'active';
        })[0];
        if (active) {
          container.appendChild(
            h('section', { class: 'admin-card' }, [
              h('h2', { class: 'admin-card__title' }, 'Live now'),
              barPreview(active),
            ])
          );
        }

        if (items.length === 0) {
          container.appendChild(
            ADMIN.emptyState({
              icon: 'megaphone',
              title: 'No announcements yet',
              text: 'Create an announcement to show a banner across the site. It publishes live — no rebuild needed.',
              actionLabel: 'Create announcement',
              onAction: function () {
                showForm(null);
              },
            })
          );
          return;
        }
        var list = h('ul', { class: 'admin-anncs' });
        items.forEach(function (a) {
          list.appendChild(listRow(a));
        });
        container.appendChild(list);
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        dom.clear(container);
        var retry = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost' }, 'Retry');
        retry.addEventListener('click', function () {
          render(container);
        });
        container.appendChild(
          h('div', { class: 'admin-error-state' }, [h('p', "Couldn't load announcements."), retry])
        );
      });
  }

  ADMIN.tabs.announcements = { render: render };
})();
