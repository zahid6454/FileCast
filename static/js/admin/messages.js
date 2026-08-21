// Messages tab (#messages) — the contact-page inbox.
//
// Same readable-card layout as errors.js: each card leads with a status
// badge, subject, and time, with a Details disclosure for the full body,
// optional reply email, and sender (signed-in user id or "anonymous"). This
// is a P23 hot spot — title/body/email come from the PUBLIC, anonymous
// POST /messages — so every field reaches the DOM via textContent (h()),
// never markup.
(function () {
  'use strict';
  var ADMIN = (window.ADMIN = window.ADMIN || {});
  ADMIN.tabs = ADMIN.tabs || {};
  var dom = ADMIN.dom;
  var api = ADMIN.api;
  var h = dom.h;

  var CONTAINER = null;
  var MESSAGES = [];
  var LIMIT = 200;
  // renderCards() rebuilds every row from scratch on each call (search, and
  // a status mutation via setStatus) — without tracking which one was open,
  // marking a message read while its detail is expanded would snap it shut
  // on the very re-render the click itself triggered.
  var EXPANDED_ID = null;

  var STATUS_BADGE = { new: 'scheduled', read: 'inactive', archived: 'inactive' };

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  function matches(m, q) {
    if (!q) return true;
    return (
      (m.title || '').toLowerCase().indexOf(q) >= 0 ||
      (m.body || '').toLowerCase().indexOf(q) >= 0 ||
      (m.email || '').toLowerCase().indexOf(q) >= 0
    );
  }

  function setStatus(m, status) {
    return api.put('/api/v1/admin/messages/' + m.id, { status: status }).then(function (updated) {
      m.status = updated.status;
      ADMIN.notifySaved({ live: true });
      renderCards(CONTAINER.querySelector('.admin-msgsearch').value);
    });
  }

  function detailRow(term, value) {
    return h('div', { class: 'admin-errrow__drow' }, [h('dt', term), h('dd', value || '—')]);
  }

  function row(m) {
    var actions = [];
    if (m.status !== 'read') {
      var readBtn = h(
        'button',
        { type: 'button', class: 'admin-btn admin-btn--ghost admin-btn--sm' },
        'Mark read'
      );
      readBtn.addEventListener('click', function () {
        setStatus(m, 'read').catch(function (err) {
          if (err && err.isAuthError) return ADMIN.onAuthError(err);
          ADMIN.toast('Could not update status', 'error');
        });
      });
      actions.push(readBtn);
    }
    if (m.status !== 'archived') {
      var archiveBtn = h(
        'button',
        { type: 'button', class: 'admin-btn admin-btn--ghost admin-btn--sm' },
        'Archive'
      );
      archiveBtn.addEventListener('click', function () {
        setStatus(m, 'archived').catch(function (err) {
          if (err && err.isAuthError) return ADMIN.onAuthError(err);
          ADMIN.toast('Could not update status', 'error');
        });
      });
      actions.push(archiveBtn);
    }

    var expanded = m.id === EXPANDED_ID;
    var detail = h('div', { class: 'admin-errrow__detail', hidden: !expanded }, [
      h('p', { class: 'admin-errrow__msg admin-errrow__msg--prose' }, m.body || '(empty message)'),
      h('dl', { class: 'admin-errrow__dl' }, [
        detailRow('Reply email', m.email),
        detailRow('Sender', m.user_id ? 'Signed-in user (' + m.user_id + ')' : 'Anonymous'),
        detailRow('Message #', m.id != null ? String(m.id) : null),
        detailRow('Timestamp', fmtDate(m.created_at))
      ]),
      h('div', { class: 'admin-toolbar' }, actions)
    ]);

    var summary = h(
      'button',
      {
        type: 'button',
        class: 'admin-errrow__summary',
        'aria-expanded': expanded ? 'true' : 'false'
      },
      [
        h(
          'span',
          { class: 'admin-badge admin-badge--' + (STATUS_BADGE[m.status] || 'inactive') },
          m.status
        ),
        h('span', { class: 'admin-errrow__tool' }, m.title || '(no subject)'),
        h('span', { class: 'admin-errrow__snippet' }, m.body || ''),
        h('time', { class: 'admin-errrow__time' }, fmtDate(m.created_at)),
        h('span', { class: 'admin-errrow__chev', 'aria-hidden': 'true' }, '▸')
      ]
    );
    summary.addEventListener('click', function () {
      var open = summary.getAttribute('aria-expanded') === 'true';
      summary.setAttribute('aria-expanded', open ? 'false' : 'true');
      detail.hidden = open;
      EXPANDED_ID = open ? null : m.id;
    });

    return h('li', { class: 'admin-errrow' }, [summary, detail]);
  }

  function renderCards(filter) {
    var list = CONTAINER.querySelector('.admin-msglist');
    var countEl = CONTAINER.querySelector('.admin-msgcount');
    if (!list) return;
    dom.clear(list);
    var q = (filter || '').trim().toLowerCase();
    var shown = MESSAGES.filter(function (m) {
      return matches(m, q);
    });
    if (countEl) countEl.textContent = shown.length + ' of ' + MESSAGES.length;
    if (shown.length === 0) {
      list.appendChild(h('li', { class: 'admin-empty' }, 'No matching messages.'));
      return;
    }
    shown.forEach(function (m) {
      list.appendChild(row(m));
    });
  }

  function render(container) {
    CONTAINER = container;
    EXPANDED_ID = null; // fresh tab entry — start with every row collapsed
    dom.clear(container);
    container.appendChild(h('div', { class: 'admin-loading' }, 'Loading messages…'));

    api
      .get('/api/v1/admin/messages?limit=' + LIMIT)
      .then(function (data) {
        MESSAGES = (data && data.messages) || [];
        dom.clear(container);

        if (MESSAGES.length === 0) {
          container.appendChild(
            ADMIN.emptyState({
              icon: 'inbox',
              title: 'No messages',
              text: 'Contact-page submissions will show up here.'
            })
          );
          return;
        }

        var search = h('input', {
          type: 'search',
          class: 'admin-input admin-msgsearch',
          placeholder: 'Search subject, message, email…',
          'aria-label': 'Search messages'
        });
        search.addEventListener('input', function () {
          renderCards(search.value);
        });
        container.appendChild(
          h('div', { class: 'admin-toolbar' }, [
            search,
            h('span', { class: 'admin-msgcount admin-muted' }, '')
          ])
        );

        container.appendChild(h('ul', { class: 'admin-msglist' }));
        renderCards('');
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        dom.clear(container);
        var retry = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost' }, 'Retry');
        retry.addEventListener('click', function () {
          render(container);
        });
        container.appendChild(
          h('div', { class: 'admin-error-state' }, [h('p', "Couldn't load messages."), retry])
        );
      });
  }

  ADMIN.tabs.messages = { render: render };
})();
