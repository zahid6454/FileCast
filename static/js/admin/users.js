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

  function initials(u) {
    var s = (u.name || u.email || '?').trim();
    var parts = s.split(/[\s@._-]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return s.slice(0, 2).toUpperCase();
  }

  function avatar(u, big) {
    return h(
      'span',
      {
        class:
          'admin-avatar' +
          (u.role === 'admin' ? ' admin-avatar--admin' : '') +
          (big ? ' admin-avatar--lg' : '')
      },
      initials(u)
    );
  }

  function rolePill(role) {
    return h(
      'span',
      { class: 'admin-badge admin-badge--' + (role === 'admin' ? 'admin' : 'user') },
      role
    );
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
      tbody.appendChild(
        h('tr', h('td', { colspan: '4', class: 'admin-empty' }, 'No matching users.'))
      );
      return;
    }
    shown.forEach(function (u) {
      var row = h('tr', { class: 'admin-users__row' }, [
        h(
          'td',
          h('div', { class: 'admin-usercell' }, [
            avatar(u),
            h('div', { class: 'admin-usercell__meta' }, [
              h('span', { class: 'admin-usercell__name' }, u.name || '—'),
              h('span', { class: 'admin-usercell__email' }, u.email || '—')
            ])
          ])
        ),
        h('td', rolePill(u.role)),
        h('td', { class: 'admin-users__date' }, fmtDate(u.created_at)),
        h('td', { class: 'admin-users__date' }, fmtDate(u.last_login_at))
      ]);
      row.addEventListener('click', function () {
        openDetail(u.id);
      });
      tbody.appendChild(row);
    });
  }

  // --- detail -------------------------------------------------------------

  var HISTORY_PAGE = 10;

  function loadHistory(userId, mount, page) {
    dom.clear(mount);
    mount.appendChild(h('div', { class: 'admin-loading' }, 'Loading…'));
    api
      .get(
        '/api/v1/users/' +
          encodeURIComponent(userId) +
          '/history?limit=' +
          HISTORY_PAGE +
          '&offset=' +
          page * HISTORY_PAGE
      )
      .then(function (hd) {
        renderHistory(userId, mount, page, (hd && hd.history) || [], !!(hd && hd.has_more));
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        dom.clear(mount);
        mount.appendChild(h('div', { class: 'admin-empty' }, "Couldn't load history."));
      });
  }

  function renderHistory(userId, mount, page, rows, hasMore) {
    dom.clear(mount);
    if (rows.length === 0 && page === 0) {
      mount.appendChild(h('div', { class: 'admin-empty' }, 'No conversion history.'));
      return;
    }
    var tbody = h('tbody');
    rows.forEach(function (r) {
      tbody.appendChild(
        h('tr', [
          h('td', labelFor(r.tool_id)),
          h('td', (r.input_format || '') + ' → ' + (r.output_format || '')),
          h('td', r.status || '—'),
          h('td', r.file_size_kb != null ? r.file_size_kb + ' KB' : '—'),
          h('td', fmtDate(r.created_at))
        ])
      );
    });
    mount.appendChild(
      h('table', { class: 'admin-table' }, [
        h(
          'thead',
          h('tr', [
            h('th', 'Tool'),
            h('th', 'Formats'),
            h('th', 'Status'),
            h('th', 'Size'),
            h('th', 'When')
          ])
        ),
        tbody
      ])
    );
    if (page > 0 || hasMore) {
      var prev = h(
        'button',
        { type: 'button', class: 'admin-btn admin-btn--ghost admin-btn--sm' },
        'Previous'
      );
      var next = h(
        'button',
        { type: 'button', class: 'admin-btn admin-btn--ghost admin-btn--sm' },
        'Next'
      );
      if (page === 0) prev.disabled = true;
      if (!hasMore) next.disabled = true;
      prev.addEventListener('click', function () {
        if (page > 0) loadHistory(userId, mount, page - 1);
      });
      next.addEventListener('click', function () {
        if (hasMore) loadHistory(userId, mount, page + 1);
      });
      mount.appendChild(
        h('div', { class: 'admin-pager' }, [
          prev,
          h('span', { class: 'admin-pager__info' }, 'Page ' + (page + 1)),
          next
        ])
      );
    }
  }

  function openDetail(userId) {
    dom.clear(CONTAINER);
    CONTAINER.appendChild(h('div', { class: 'admin-loading' }, 'Loading user…'));
    api
      .get('/api/v1/users/' + encodeURIComponent(userId))
      .then(function (data) {
        dom.clear(CONTAINER);
        var u = data.user || {};
        var favorites = u.favorites || [];

        var back = h(
          'button',
          { type: 'button', class: 'admin-btn admin-btn--secondary' },
          '← Back to Users'
        );
        back.addEventListener('click', function () {
          render(CONTAINER);
        });

        CONTAINER.appendChild(h('div', { class: 'admin-toolbar' }, [back]));
        CONTAINER.appendChild(
          h('section', { class: 'admin-card' }, [
            h('div', { class: 'admin-userhead' }, [
              avatar(u, true),
              h('div', [
                h('h2', { class: 'admin-userhead__name' }, u.name || u.email || 'User'),
                h('div', { class: 'admin-userhead__email' }, u.email || '')
              ]),
              h('div', { class: 'admin-userhead__role' }, rolePill(u.role))
            ]),
            h('dl', { class: 'admin-deflist' }, [
              dt(
                'Role',
                h('span', [
                  rolePill(u.role),
                  h('span', { class: 'admin-deflist__note' }, ' — managed by an operator')
                ])
              ),
              dt('Joined', fmtDate(u.created_at)),
              dt('Last login', fmtDate(u.last_login_at)),
              dt('Max file size', u.max_file_size ? String(u.max_file_size) : '—')
            ])
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
          h('section', { class: 'admin-card' }, [
            h('h2', { class: 'admin-card__title' }, 'Favorites'),
            favBody
          ])
        );

        // History (paginated: 10/page, mirroring the account page).
        var histMount = h('div', {});
        CONTAINER.appendChild(
          h('section', { class: 'admin-card' }, [
            h('h2', { class: 'admin-card__title' }, 'History'),
            histMount
          ])
        );
        loadHistory(userId, histMount, 0);
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        dom.clear(CONTAINER);
        var back = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost' }, '← Back');
        back.addEventListener('click', function () {
          render(CONTAINER);
        });
        CONTAINER.appendChild(
          h('div', { class: 'admin-error-state' }, [h('p', "Couldn't load this user."), back])
        );
      });
  }

  function dt(term, value) {
    return h('div', { class: 'admin-deflist__pair' }, [h('dt', term), h('dd', value)]);
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
          'aria-label': 'Search users'
        });
        search.addEventListener('input', function () {
          renderList(search.value);
        });
        container.appendChild(h('div', { class: 'admin-toolbar' }, [search]));

        if (USERS.length === 0) {
          container.appendChild(
            ADMIN.emptyState({
              icon: 'users',
              title: 'No users yet',
              text: 'Signed-in users will appear here once Google sign-in is live.'
            })
          );
          return;
        }

        var table = h('table', { class: 'admin-table admin-users' }, [
          h(
            'thead',
            h('tr', [h('th', 'User'), h('th', 'Role'), h('th', 'Joined'), h('th', 'Last login')])
          ),
          h('tbody')
        ]);
        container.appendChild(h('div', { class: 'admin-tablecard' }, [table]));
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
