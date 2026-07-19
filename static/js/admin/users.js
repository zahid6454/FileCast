// Users tab (#users) — Phase 4 §8.4, relaxed by Phase 5.5.
//
// List + client-side search over the loaded users. Row → detail with history,
// favorites, and role. Role is now ADMIN-EDITABLE (Phase 5.5 relaxes R7): a
// per-row Grant/Revoke toggle, plus a "Staff & invites" panel to invite admins
// by email (pending until their first Google login) and cancel pending invites.
// This is NOT self-service escalation (D9 KEPT): every action is require_admin,
// the toggle is disabled for yourself and for configured owners
// (INITIAL_ADMIN_EMAILS), and the server re-enforces all guards (self → 409,
// owner → 403, last-admin → 409). All user-supplied fields render via
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
  var OWNERS = {}; // lowercased owner email -> true (INITIAL_ADMIN_EMAILS)
  var PENDING = []; // [{ email, granted_at, granted_by_email }]
  var STAFF_LOADED = false; // did GET /admin/staff succeed this render?
  var SEARCH = null; // the search <input>, for filter-preserving re-renders

  function selfEmail() {
    var u = ADMIN.currentUser;
    return u && u.email ? String(u.email).toLowerCase() : '';
  }
  function isSelf(email) {
    return !!email && email === selfEmail();
  }
  function isOwner(email) {
    return !!email && OWNERS[email] === true;
  }

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

  // --- role toggle (Phase 5.5) --------------------------------------------

  // Grant/Revoke admin for one row. Disabled (with a reason) for yourself and for
  // configured owners; the server re-enforces both regardless. Optimistically
  // patches the local role on success and re-renders the (filtered) list.
  function roleToggle(u) {
    var email = (u.email || '').toLowerCase();
    var isAdmin = u.role === 'admin';
    var btn = h(
      'button',
      {
        type: 'button',
        class:
          'admin-btn admin-btn--sm ' + (isAdmin ? 'admin-btn--danger' : 'admin-btn--secondary'),
        dataset: { roleToggle: email }
      },
      isAdmin ? 'Revoke admin' : 'Make admin'
    );
    var reason = null;
    if (isSelf(email)) reason = 'You can’t change your own role';
    else if (isOwner(email)) reason = 'Configured owner — set via INITIAL_ADMIN_EMAILS';
    if (reason) {
      btn.disabled = true;
      btn.setAttribute('title', reason);
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation(); // don't open the row detail
      toggleRole(u, btn);
    });
    return btn;
  }

  function toggleRole(u, btn) {
    var email = (u.email || '').toLowerCase();
    var promote = u.role !== 'admin';
    btn.disabled = true;
    var req = promote
      ? api.post('/api/v1/admin/staff', { email: email })
      : api.del('/api/v1/admin/staff/' + encodeURIComponent(email));
    req
      .then(function () {
        u.role = promote ? 'admin' : 'user';
        ADMIN.toast(promote ? 'Granted admin' : 'Revoked admin', 'success');
        renderList(SEARCH ? SEARCH.value : '');
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        ADMIN.toast((err && err.message) || 'Could not update role', 'error');
        btn.disabled = false;
      });
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
        h('tr', h('td', { colspan: '5', class: 'admin-empty' }, 'No matching users.'))
      );
      return;
    }
    shown.forEach(function (u) {
      var actionCell = h('td', { class: 'admin-users__actions' }, roleToggle(u));
      // The action cell is interactive on its own; a click there must not also
      // open the row detail (handled by stopPropagation in the button).
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
        h('td', { class: 'admin-users__date' }, fmtDate(u.last_login_at)),
        actionCell
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
                  h('span', { class: 'admin-deflist__note' }, ' — change it from the Users list')
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

  // --- staff & invites panel (Phase 5.5) ----------------------------------

  function invite(raw, input) {
    var email = (raw || '').trim().toLowerCase();
    if (!email) return;
    api
      .post('/api/v1/admin/staff', { email: email })
      .then(function (res) {
        input.value = '';
        var status = res && res.status;
        if (status === 'pending') {
          ADMIN.toast('Invited ' + email + ' — tell them to sign in at /admin/', 'success');
        } else if (status === 'promoted') {
          ADMIN.toast('Granted admin to ' + email, 'success');
        } else if (status === 'owner') {
          ADMIN.toast(email + ' is a configured owner (already admin)', 'info');
        } else {
          ADMIN.toast('Invited ' + email, 'success');
        }
        render(CONTAINER); // refetch users + staff so both lists reflect the change
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        ADMIN.toast((err && err.message) || 'Invite failed', 'error');
      });
  }

  function cancelInvite(email) {
    api
      .del('/api/v1/admin/staff/' + encodeURIComponent(email))
      .then(function () {
        ADMIN.toast('Invite cancelled', 'success');
        render(CONTAINER);
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        ADMIN.toast((err && err.message) || 'Could not cancel', 'error');
      });
  }

  function staffPanel() {
    var input = h('input', {
      type: 'email',
      class: 'admin-input admin-staff__input',
      placeholder: 'name@example.com',
      'aria-label': 'Invite admin by email'
    });
    var inviteBtn = h(
      'button',
      { type: 'button', class: 'admin-btn admin-btn--primary' },
      'Invite admin'
    );
    inviteBtn.addEventListener('click', function () {
      invite(input.value, input);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') invite(input.value, input);
    });

    var kids = [
      h('h2', { class: 'admin-card__title' }, 'Staff & invites'),
      h(
        'p',
        { class: 'admin-staff__hint' },
        'Invite an admin by email. They become admin the first time they sign in ' +
          'with that Google account. Email delivery isn’t wired yet — send them to /admin/.'
      ),
      h('div', { class: 'admin-staff__invite' }, [input, inviteBtn])
    ];

    // Pending invites (unconsumed grants).
    if (PENDING.length > 0) {
      var items = PENDING.map(function (p) {
        var cancel = h(
          'button',
          { type: 'button', class: 'admin-btn admin-btn--ghost admin-btn--sm' },
          'Cancel'
        );
        cancel.addEventListener('click', function () {
          cancelInvite(p.email);
        });
        var meta =
          'invited ' +
          fmtDate(p.granted_at) +
          (p.granted_by_email ? ' by ' + p.granted_by_email : '');
        return h('li', { class: 'admin-staff__row' }, [
          h('div', { class: 'admin-staff__who' }, [
            h('span', { class: 'admin-staff__email' }, p.email),
            h('span', { class: 'admin-staff__meta' }, meta)
          ]),
          cancel
        ]);
      });
      kids.push(h('h3', { class: 'admin-staff__subhead' }, 'Pending invites'));
      kids.push(h('ul', { class: 'admin-staff__list' }, items));
    }

    // Configured owners (immutable — INITIAL_ADMIN_EMAILS).
    var ownerEmails = Object.keys(OWNERS);
    if (ownerEmails.length > 0) {
      var ownerItems = ownerEmails.sort().map(function (e) {
        return h('li', { class: 'admin-staff__row' }, [
          h('div', { class: 'admin-staff__who' }, [
            h('span', { class: 'admin-staff__email' }, e),
            h('span', { class: 'admin-staff__meta' }, 'configured owner — always admin')
          ]),
          h('span', { class: 'admin-badge admin-badge--admin' }, 'owner')
        ]);
      });
      kids.push(h('h3', { class: 'admin-staff__subhead' }, 'Owners'));
      kids.push(h('ul', { class: 'admin-staff__list' }, ownerItems));
    }

    return h('section', { class: 'admin-card admin-staff' }, kids);
  }

  // --- render -------------------------------------------------------------

  function renderAll(container) {
    dom.clear(container);

    SEARCH = h('input', {
      type: 'search',
      class: 'admin-input admin-users__search',
      placeholder: 'Search by email or name…',
      'aria-label': 'Search users'
    });
    SEARCH.addEventListener('input', function () {
      renderList(SEARCH.value);
    });
    container.appendChild(h('div', { class: 'admin-toolbar' }, [SEARCH]));

    if (USERS.length === 0) {
      container.appendChild(
        ADMIN.emptyState({
          icon: 'users',
          title: 'No users yet',
          text: 'Signed-in users will appear here once someone signs in with Google.'
        })
      );
    } else {
      var table = h('table', { class: 'admin-table admin-users' }, [
        h(
          'thead',
          h('tr', [
            h('th', 'User'),
            h('th', 'Role'),
            h('th', 'Joined'),
            h('th', 'Last login'),
            h('th', 'Actions')
          ])
        ),
        h('tbody')
      ]);
      container.appendChild(h('div', { class: 'admin-tablecard' }, [table]));
      renderList('');
    }

    // The staff panel needs the owners/pending lists from GET /admin/staff; if
    // that call failed we degrade to the plain list (row toggles still work, the
    // server enforces the owner guard).
    if (STAFF_LOADED) container.appendChild(staffPanel());
  }

  function render(container) {
    CONTAINER = container;
    dom.clear(container);
    container.appendChild(h('div', { class: 'admin-loading' }, 'Loading users…'));

    api
      .get('/api/v1/users')
      .then(function (data) {
        USERS = (data && data.users) || [];
        // Best-effort staff fetch — never let it fail the whole tab.
        return api.get('/api/v1/admin/staff').then(
          function (staff) {
            OWNERS = {};
            ((staff && staff.owners) || []).forEach(function (e) {
              OWNERS[String(e).toLowerCase()] = true;
            });
            PENDING = (staff && staff.pending) || [];
            STAFF_LOADED = true;
          },
          function (err) {
            // A genuine auth failure must still drop to the gate (R8) — only a
            // non-auth staff error degrades to the plain list.
            if (err && err.isAuthError) throw err;
            OWNERS = {};
            PENDING = [];
            STAFF_LOADED = false;
          }
        );
      })
      .then(function () {
        renderAll(container);
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
