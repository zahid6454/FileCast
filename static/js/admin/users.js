// Users tab (#users) — Phase 4 §8.4.
//
// List + client-side search over the loaded users (counts are tiny; server-side
// search/pagination is a noted future extension). Row → detail with history,
// favorites, and role. Role is DISPLAYED READ-ONLY — there is deliberately no
// role-change control (D9/R7); a "make admin" button would be a
// privilege-escalation vector. All user-supplied fields (email/name) render via
// textContent (P23).
(function () {
  'use strict';
  var ADMIN = (window.ADMIN = window.ADMIN || {});
  ADMIN.tabs = ADMIN.tabs || {};
  var dom = ADMIN.dom;
  var api = ADMIN.api;
  var h = dom.h;

  var CONTAINER = null;
  var USERS = [];

  function labelFor(toolId) {
    if (ADMIN.catalog && typeof ADMIN.catalog.label === 'function') {
      return ADMIN.catalog.label(toolId);
    }
    return toolId;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString();
  }

  // --- list ---------------------------------------------------------------

  function renderList(filter) {
    var tbody = CONTAINER.querySelector('.admin-users tbody');
    if (!tbody) return;
    dom.clear(tbody);
    var q = (filter || '').trim().toLowerCase();
    var shown = USERS.filter(function (u) {
      if (!q) return true;
      return (
        (u.email || '').toLowerCase().indexOf(q) >= 0 ||
        (u.name || '').toLowerCase().indexOf(q) >= 0
      );
    });
    if (shown.length === 0) {
      tbody.appendChild(h('tr', h('td', { colspan: '5', class: 'admin-empty' }, 'No matching users.')));
      return;
    }
    shown.forEach(function (u) {
      var row = h('tr', { class: 'admin-users__row' }, [
        h('td', u.email || '—'),
        h('td', u.name || '—'),
        h('td', h('span', { class: 'admin-badge admin-badge--role' }, u.role)),
        h('td', fmtDate(u.created_at)),
        h('td', fmtDate(u.last_login_at)),
      ]);
      row.addEventListener('click', function () {
        openDetail(u.id);
      });
      tbody.appendChild(row);
    });
  }

  // --- detail -------------------------------------------------------------

  function openDetail(userId) {
    dom.clear(CONTAINER);
    CONTAINER.appendChild(h('div', { class: 'admin-loading' }, 'Loading user…'));
    api
      .get('/api/v1/users/' + encodeURIComponent(userId))
      .then(function (data) {
        dom.clear(CONTAINER);
        var u = data.user || {};
        var history = data.history || [];
        var favorites = u.favorites || [];

        var back = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost' }, '← Back to users');
        back.addEventListener('click', function () {
          render(CONTAINER);
        });

        CONTAINER.appendChild(h('div', { class: 'admin-toolbar' }, [back]));
        CONTAINER.appendChild(
          h('section', { class: 'admin-card' }, [
            h('h2', { class: 'admin-card__title' }, u.name || u.email || 'User'),
            h('dl', { class: 'admin-deflist' }, [
              dt('Email', u.email || '—'),
              dt('Role', h('span', [
                h('span', { class: 'admin-badge admin-badge--role' }, u.role),
                h('span', { class: 'admin-deflist__note' }, ' — role is managed by an operator'),
              ])),
              dt('Joined', fmtDate(u.created_at)),
              dt('Last login', fmtDate(u.last_login_at)),
              dt('Max file size', u.max_file_size ? String(u.max_file_size) : '—'),
            ]),
          ])
        );

        // Favorites
        var favBody =
          favorites.length === 0
            ? h('div', { class: 'admin-empty' }, 'No favorites.')
            : h(
                'ul',
                { class: 'admin-chips' },
                favorites.map(function (id) {
                  return h('li', { class: 'admin-chip' }, labelFor(id));
                })
              );
        CONTAINER.appendChild(
          h('section', { class: 'admin-card' }, [h('h2', { class: 'admin-card__title' }, 'Favorites'), favBody])
        );

        // History
        var histBody;
        if (history.length === 0) {
          histBody = h('div', { class: 'admin-empty' }, 'No conversion history.');
        } else {
          var tbody = h('tbody');
          history.forEach(function (r) {
            tbody.appendChild(
              h('tr', [
                h('td', labelFor(r.tool_id)),
                h('td', (r.input_format || '') + ' → ' + (r.output_format || '')),
                h('td', r.status || '—'),
                h('td', r.file_size_kb != null ? r.file_size_kb + ' KB' : '—'),
                h('td', fmtDate(r.created_at)),
              ])
            );
          });
          histBody = h('table', { class: 'admin-table' }, [
            h('thead', h('tr', [h('th', 'Tool'), h('th', 'Formats'), h('th', 'Status'), h('th', 'Size'), h('th', 'When')])),
            tbody,
          ]);
        }
        CONTAINER.appendChild(
          h('section', { class: 'admin-card' }, [h('h2', { class: 'admin-card__title' }, 'History'), histBody])
        );
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        dom.clear(CONTAINER);
        var back = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost' }, '← Back');
        back.addEventListener('click', function () {
          render(CONTAINER);
        });
        CONTAINER.appendChild(h('div', { class: 'admin-error-state' }, [h('p', "Couldn't load this user."), back]));
      });
  }

  function dt(term, value) {
    return h('div', { class: 'admin-deflist__pair' }, [
      h('dt', term),
      h('dd', value),
    ]);
  }

  // --- render -------------------------------------------------------------

  function render(container) {
    CONTAINER = container;
    dom.clear(container);
    container.appendChild(h('div', { class: 'admin-loading' }, 'Loading users…'));

    api
      .get('/api/v1/users')
      .then(function (data) {
        USERS = (data && data.users) || [];
        dom.clear(container);

        var search = h('input', {
          type: 'search',
          class: 'admin-input admin-users__search',
          placeholder: 'Search by email or name…',
          'aria-label': 'Search users',
        });
        search.addEventListener('input', function () {
          renderList(search.value);
        });
        container.appendChild(h('div', { class: 'admin-toolbar' }, [search]));

        if (USERS.length === 0) {
          container.appendChild(h('div', { class: 'admin-empty' }, 'No users yet.'));
          return;
        }

        var table = h('table', { class: 'admin-table admin-users' }, [
          h('thead', h('tr', [h('th', 'Email'), h('th', 'Name'), h('th', 'Role'), h('th', 'Joined'), h('th', 'Last login')])),
          h('tbody'),
        ]);
        container.appendChild(table);
        renderList('');
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        dom.clear(container);
        var retry = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost' }, 'Retry');
        retry.addEventListener('click', function () {
          render(container);
        });
        container.appendChild(
          h('div', { class: 'admin-error-state' }, [h('p', "Couldn't load users."), retry])
        );
      });
  }

  ADMIN.tabs.users = { render: render };
})();
