// Admin SPA boot + shell — Phase 4 §4/§5/§7. Loaded LAST (defer preserves
// order), so every tab's render() and ADMIN.dom/api are defined when it runs.
//
// Responsibilities:
//   - Auth gate (D6): GET /auth/me on boot; anon → sign-in, non-admin →
//     no-access, admin → panel. Role is read live from the server, never cached.
//   - One shared ADMIN.catalog from the boot GET /tools (§4.4) — no per-tab
//     tool fetches, no N+1.
//   - Hash router (#dashboard default) over the four tabs.
//   - Toast + the honest save→publish flow: each successful mutation calls
//     ADMIN.notifySaved() → success toast + a debounced POST /admin/deploy →
//     501 sentinel → persistent info-styled "pending rebuild" banner (§7). The
//     Phase 7 run_id-poll path is written but dormant behind the 501 guard.
//   - Any AuthError from api.js (mid-session 401/403) re-invokes the gate (R8).
//   - Dev-login buttons that self-hide in prod on first click (dev-login 404s
//     unless ENVIRONMENT=development — R11).
(function () {
  'use strict';
  var ADMIN = (window.ADMIN = window.ADMIN || {});
  var dom = ADMIN.dom;
  var api = ADMIN.api;
  var h = dom.h;

  var TABS = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'tools', label: 'Tools' },
    { id: 'announcements', label: 'Announcements' },
    { id: 'users', label: 'Users' },
  ];
  var VALID = { dashboard: 1, tools: 1, announcements: 1, users: 1 };

  var mount = null; // #admin-app
  var tabHost = null; // <main> where tabs render
  var toastHost = null;
  var bannerShown = false;
  var routerBound = false;

  // --- shared catalog (§4.4) ---------------------------------------------

  ADMIN.catalog = {
    byId: {},
    list: [],
    categoryOrder: [],
    rebuild: function (tools) {
      this.list = tools || [];
      this.byId = {};
      this.categoryOrder = [];
      var self = this;
      this.list.forEach(function (t) {
        self.byId[t.id] = t;
        var cat = t.category || 'other';
        if (self.categoryOrder.indexOf(cat) < 0) self.categoryOrder.push(cat);
      });
    },
    patch: function (id, fields) {
      this.byId[id] = Object.assign({}, this.byId[id], fields);
    },
    label: function (id) {
      var t = this.byId[id];
      return t ? t.display_name || t.name || id : id;
    },
  };

  // --- toasts -------------------------------------------------------------

  function ensureToastHost() {
    if (toastHost && document.body.contains(toastHost)) return toastHost;
    toastHost = h('div', { class: 'admin-toasts', 'aria-live': 'polite', 'aria-atomic': 'false' });
    document.body.appendChild(toastHost);
    return toastHost;
  }

  ADMIN.toast = function (message, type) {
    var host = ensureToastHost();
    var toast = h('div', { class: 'admin-toast admin-toast--' + (type || 'info'), role: 'status' }, message);
    host.appendChild(toast);
    requestAnimationFrame(function () {
      toast.classList.add('is-visible');
    });
    setTimeout(function () {
      toast.classList.remove('is-visible');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 3200);
  };

  // --- save → publish flow (§7) ------------------------------------------

  var deployTimer = null;

  ADMIN.notifySaved = function () {
    ADMIN.toast('Saved', 'success');
    // Debounce/coalesce a burst of edits into one deploy call.
    if (deployTimer) clearTimeout(deployTimer);
    deployTimer = setTimeout(fireDeploy, 700);
  };

  function fireDeploy() {
    deployTimer = null;
    api
      .post('/api/v1/admin/deploy', {})
      .then(function (res) {
        if (res && res.notImplemented) {
          showPendingRebuildBanner();
          return;
        }
        // Phase 7 dormant path: a real 2xx with a run_id → poll to completion.
        if (res && res.run_id) {
          pollDeploy(res.run_id);
        }
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        // A deploy error must never mask the save success — surface calmly.
        ADMIN.toast('Publish could not start (saved to the database).', 'info');
      });
  }

  // Dormant until Phase 7 wires a real deploy (501 short-circuits above).
  function pollDeploy(runId) {
    api
      .get('/api/v1/admin/deploy/' + encodeURIComponent(runId))
      .then(function (res) {
        if (res && res.notImplemented) return;
        if (res && (res.status === 'completed' || res.status === 'success')) {
          ADMIN.toast('Published', 'success');
          return;
        }
        setTimeout(function () {
          pollDeploy(runId);
        }, 4000);
      })
      .catch(function () {
        /* silent — dormant path */
      });
  }

  function showPendingRebuildBanner() {
    if (bannerShown) return;
    var slot = document.getElementById('admin-banner-slot');
    if (!slot) return;
    bannerShown = true;
    var dismiss = h('button', { type: 'button', class: 'admin-iconbtn', 'aria-label': 'Dismiss' }, '✕');
    dismiss.addEventListener('click', function () {
      dom.clear(slot);
      bannerShown = false;
    });
    slot.appendChild(
      h('div', { class: 'admin-banner admin-banner--info', role: 'status' }, [
        h('span', { class: 'admin-banner__text' },
          'Changes are saved to the database. Publishing to the live site needs a rebuild ' +
            '(not wired until Phase 7). Locally, re-run python build.py to see them.'),
        dismiss,
      ])
    );
  }

  // --- auth gate (§5) -----------------------------------------------------

  ADMIN.onAuthError = function () {
    // Re-read role from the server and route accordingly (expiry/demotion).
    boot();
  };

  function boot() {
    bannerShown = false;
    api
      .get('/api/v1/auth/me')
      .then(function (data) {
        var user = data && data.user;
        if (user && user.role === 'admin') {
          renderPanel(user);
        } else {
          renderNoAccess();
        }
      })
      .catch(function () {
        // AuthError (401/403) or unreachable → sign-in.
        renderSignIn();
      });
  }

  // --- screens ------------------------------------------------------------

  function renderSignIn() {
    tabHost = null; // no panel mounted → a stray hashchange must be a no-op
    dom.clear(mount);
    var adminBtn = h('button', { type: 'button', class: 'admin-btn admin-btn--primary' }, 'Dev login as admin');
    var userBtn = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost' }, 'Dev login as user');
    var devRow = h('div', { class: 'admin-signin__dev' }, [adminBtn, userBtn]);
    var devNote = h('p', { class: 'admin-signin__note' }, 'Local development sign-in.');

    function devLogin(role) {
      api
        .post('/api/v1/auth/dev-login', { role: role })
        .then(function () {
          window.location.reload();
        })
        .catch(function (err) {
          if (err && err.status === 404) {
            // Prod: dev-login is disabled — hide the buttons honestly.
            dom.clear(devRow);
            devNote.textContent = 'Dev login is disabled on this server.';
          } else {
            ADMIN.toast('Dev login failed', 'error');
          }
        });
    }
    adminBtn.addEventListener('click', function () {
      devLogin('admin');
    });
    userBtn.addEventListener('click', function () {
      devLogin('user');
    });

    mount.appendChild(
      h('div', { class: 'admin-gate' }, [
        h('div', { class: 'admin-gate__card' }, [
          h('h1', { class: 'admin-gate__title' }, 'FileCast Admin'),
          h('p', 'Sign in to access the FileCast admin panel.'),
          h('a', { class: 'admin-btn admin-btn--ghost', href: '/' }, 'Go to the main site'),
          devNote,
          devRow,
        ]),
      ])
    );
  }

  function renderNoAccess() {
    tabHost = null;
    dom.clear(mount);
    mount.appendChild(
      h('div', { class: 'admin-gate' }, [
        h('div', { class: 'admin-gate__card' }, [
          h('h1', { class: 'admin-gate__title' }, 'No access'),
          h('p', "You don't have access to the admin panel."),
          h('a', { class: 'admin-btn admin-btn--primary', href: '/' }, 'Back to FileCast'),
        ]),
      ])
    );
  }

  function renderPanel(user) {
    dom.clear(mount);

    var nav = h('nav', { class: 'admin-tabs', 'aria-label': 'Admin sections' });
    TABS.forEach(function (t) {
      nav.appendChild(h('a', { class: 'admin-tabs__link', href: '#' + t.id, dataset: { tab: t.id } }, t.label));
    });

    var signout = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost' }, 'Sign out');
    signout.addEventListener('click', function () {
      api.post('/api/v1/auth/logout', {}).then(function () {
        window.location.reload();
      });
    });

    tabHost = h('main', { class: 'admin-main', id: 'admin-tab' });

    mount.appendChild(
      h('div', { class: 'admin-shell' }, [
        h('header', { class: 'admin-topbar' }, [
          h('div', { class: 'admin-topbar__brand' }, 'FileCast Admin'),
          nav,
          h('div', { class: 'admin-topbar__actions' }, [
            h('span', { class: 'admin-topbar__user' }, user.email || ''),
            signout,
          ]),
        ]),
        h('div', { class: 'admin-banner-slot', id: 'admin-banner-slot' }),
        tabHost,
      ])
    );

    if (!routerBound) {
      window.addEventListener('hashchange', route);
      routerBound = true;
    }

    // Load the shared catalog once, then route (dashboard labels need it).
    api
      .get('/api/v1/tools')
      .then(function (data) {
        ADMIN.catalog.rebuild((data && data.tools) || []);
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        // Labels degrade to raw ids; tabs still render.
      })
      .then(function () {
        route();
      });
  }

  // --- router -------------------------------------------------------------

  function currentTab() {
    var hash = (window.location.hash || '').replace(/^#/, '');
    return VALID[hash] ? hash : 'dashboard';
  }

  function route() {
    if (!tabHost) return;
    var active = currentTab();
    var links = mount.querySelectorAll('.admin-tabs__link');
    links.forEach(function (a) {
      if (a.dataset.tab === active) {
        a.setAttribute('aria-current', 'page');
      } else {
        a.removeAttribute('aria-current');
      }
    });
    var tab = ADMIN.tabs && ADMIN.tabs[active];
    if (tab && typeof tab.render === 'function') {
      tab.render(tabHost);
    }
  }

  // --- start --------------------------------------------------------------

  function start() {
    mount = document.getElementById('admin-app');
    if (!mount) return;
    ensureToastHost();
    boot();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
