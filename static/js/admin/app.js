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
    { id: 'errors', label: 'Errors' },
  ];
  var VALID = { dashboard: 1, tools: 1, announcements: 1, users: 1, errors: 1 };

  // Inline SVG tab icons (Feather-style, stroke=currentColor so they follow the
  // link colour). Built via dom.svg() — no external assets, P23-safe.
  var ICONS = {
    dashboard: [['rect', { x: 3, y: 3, width: 8, height: 8, rx: 1 }], ['rect', { x: 13, y: 3, width: 8, height: 8, rx: 1 }], ['rect', { x: 13, y: 13, width: 8, height: 8, rx: 1 }], ['rect', { x: 3, y: 13, width: 8, height: 8, rx: 1 }]],
    tools: [['line', { x1: 4, y1: 21, x2: 4, y2: 14 }], ['line', { x1: 4, y1: 10, x2: 4, y2: 3 }], ['line', { x1: 12, y1: 21, x2: 12, y2: 12 }], ['line', { x1: 12, y1: 8, x2: 12, y2: 3 }], ['line', { x1: 20, y1: 21, x2: 20, y2: 16 }], ['line', { x1: 20, y1: 12, x2: 20, y2: 3 }], ['line', { x1: 1, y1: 14, x2: 7, y2: 14 }], ['line', { x1: 9, y1: 8, x2: 15, y2: 8 }], ['line', { x1: 17, y1: 16, x2: 23, y2: 16 }]],
    announcements: [['path', { d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' }], ['path', { d: 'M13.73 21a2 2 0 0 1-3.46 0' }]],
    users: [['path', { d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' }], ['circle', { cx: 9, cy: 7, r: 4 }], ['path', { d: 'M23 21v-2a4 4 0 0 0-3-3.87' }], ['path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }]],
    errors: [['path', { d: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' }], ['line', { x1: 12, y1: 9, x2: 12, y2: 13 }], ['line', { x1: 12, y1: 17, x2: 12.01, y2: 17 }]],
    // empty-state icons
    megaphone: [['path', { d: 'M3 11l18-5v12L3 14v-3z' }], ['path', { d: 'M11.6 16.8a3 3 0 1 1-5.8-1.6' }]],
    check: [['path', { d: 'M22 11.08V12a10 10 0 1 1-5.93-9.14' }], ['polyline', { points: '22 4 12 14.01 9 11.01' }]],
    inbox: [['polyline', { points: '22 12 16 12 14 15 10 15 8 12 2 12' }], ['path', { d: 'M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z' }]],
    info: [['circle', { cx: 12, cy: 12, r: 10 }], ['line', { x1: 12, y1: 16, x2: 12, y2: 12 }], ['line', { x1: 12, y1: 8, x2: 12.01, y2: 8 }]],
    home: [['path', { d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }], ['polyline', { points: '9 22 9 12 15 12 15 22' }]],
    // hamburger toggle icons (open = three bars, close = ✕)
    menu: [['line', { x1: 3, y1: 6, x2: 21, y2: 6 }], ['line', { x1: 3, y1: 12, x2: 21, y2: 12 }], ['line', { x1: 3, y1: 18, x2: 21, y2: 18 }]],
    close: [['line', { x1: 18, y1: 6, x2: 6, y2: 18 }], ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }]],
  };

  // Build an inline SVG icon from ICONS (stroke=currentColor). P23-safe.
  function svgIcon(name, size, cls) {
    var kids = (ICONS[name] || []).map(function (s) {
      return dom.svg(s[0], s[1]);
    });
    return dom.svg('svg', {
      class: cls || 'admin-icon',
      viewBox: '0 0 24 24',
      width: String(size || 24),
      height: String(size || 24),
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    }, kids);
  }
  ADMIN.icon = svgIcon;

  function tabIcon(name) {
    return svgIcon(name, 16, 'admin-tabs__icon');
  }

  // Shared, professional empty state: icon medallion + title + text + optional CTA.
  ADMIN.emptyState = function (opts) {
    opts = opts || {};
    var kids = [
      h('div', { class: 'admin-emptystate__icon' }, [svgIcon(opts.icon || 'inbox', 28)]),
      h('h3', { class: 'admin-emptystate__title' }, opts.title || 'Nothing here yet'),
    ];
    if (opts.text) kids.push(h('p', { class: 'admin-emptystate__text' }, opts.text));
    if (opts.actionLabel && opts.onAction) {
      var btn = h('button', { type: 'button', class: 'admin-btn admin-btn--primary' }, opts.actionLabel);
      btn.addEventListener('click', opts.onAction);
      kids.push(btn);
    }
    return h('div', { class: 'admin-emptystate' }, kids);
  };

  var mount = null; // #admin-app
  var tabHost = null; // <main> where tabs render
  var toastHost = null;
  var bannerShown = false;
  var routerBound = false;
  var drawerBound = false; // Esc/outside-click listeners bound once (module-wide)
  var booting = false; // guards against re-entrant gate re-checks

  // Open/close the mobile tab drawer. Operates on the CURRENT topbar elements by
  // id so it stays correct across panel re-renders. On desktop the drawer class
  // is inert (the nav is laid out inline), so toggling it there is harmless.
  function setDrawer(open) {
    var navEl = document.getElementById('admin-nav');
    var ham = document.getElementById('admin-hamburger');
    if (!navEl || !ham) return;
    navEl.classList.toggle('admin-tabs--open', open);
    ham.setAttribute('aria-expanded', open ? 'true' : 'false');
    ham.setAttribute('aria-label', open ? 'Close menu' : 'Menu');
    dom.clear(ham);
    ham.appendChild(svgIcon(open ? 'close' : 'menu', 24, 'admin-hamburger__icon'));
  }

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

  var TOAST_ICON = { success: 'check', error: 'errors', info: 'info' };

  ADMIN.toast = function (message, type) {
    type = type || 'info';
    var host = ensureToastHost();
    var toast = h('div', { class: 'admin-toast admin-toast--' + type, role: 'status' }, [
      svgIcon(TOAST_ICON[type] || 'info', 18, 'admin-toast__icon'),
      h('span', { class: 'admin-toast__msg' }, message),
    ]);
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

  // opts.live: the change is served live from the API (the announcement bar is
  // fetched at runtime by nav.js), so it needs NO static rebuild — don't fire
  // the deploy flow and don't show the "pending rebuild" banner. Tool changes
  // (enable/disable, reorder, overlay edits) DO bake into static pages, so they
  // keep the deploy → 501 → banner path.
  ADMIN.notifySaved = function (opts) {
    if (opts && opts.live) {
      ADMIN.toast('Saved — live now', 'success');
      return;
    }
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
    // Coalesce concurrent gate re-checks: a demoted admin's dashboard fires
    // several calls that can each 401 and call onAuthError → boot(). Without a
    // guard that would be a burst of /me requests and duplicate renders. The
    // flag clears once a terminal screen has rendered.
    if (booting) return;
    booting = true;
    bannerShown = false;
    api
      .get('/api/v1/auth/me')
      .then(function (data) {
        booting = false;
        var user = data && data.user;
        if (user && user.role === 'admin') {
          renderPanel(user);
        } else {
          renderNoAccess(user);
        }
      })
      .catch(function () {
        // AuthError (401/403) or unreachable → sign-in.
        booting = false;
        renderSignIn();
      });
  }

  // --- screens ------------------------------------------------------------

  function signOut() {
    // Clear the session, then reload back to the sign-in screen. Always reload
    // (even on a failed logout) so the gate re-reads /me and shows the truth.
    api.post('/api/v1/auth/logout', {}).then(reload, reload);
    function reload() {
      window.location.reload();
    }
  }

  function renderSignIn() {
    tabHost = null; // no panel mounted → a stray hashchange must be a no-op
    dom.clear(mount);

    // Real sign-in = Google (same flow as the main site). Admin access is granted
    // by the DB role, not by this button: a Google user only reaches the panel if
    // their users.role is 'admin' (D6 — no self-service admin). ?next returns here.
    var apiBase = ((window.FILECAST && window.FILECAST.apiBase) || '').replace(/\/$/, '');
    var googleBtn = h(
      'a',
      { class: 'admin-btn admin-btn--primary', href: apiBase + '/api/v1/auth/google?next=/admin/' },
      'Sign in with Google'
    );

    // Dev-login: a local-only shortcut that skips Google and mints a session for a
    // synthetic admin/user account. Gated server-side (404 unless ENVIRONMENT=
    // development), so in prod the first click hides these honestly.
    var adminBtn = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost admin-btn--sm' }, 'Dev login as admin');
    var userBtn = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost admin-btn--sm' }, 'Dev login as user');
    var devRow = h('div', { class: 'admin-signin__dev' }, [adminBtn, userBtn]);
    var devNote = h('p', { class: 'admin-signin__note' }, 'Local development only — skips Google.');

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
          h('p', 'Sign in with your admin Google account to manage FileCast.'),
          googleBtn,
          h('a', { class: 'admin-btn admin-btn--ghost', href: '/' }, 'Go to the main site'),
          devNote,
          devRow,
        ]),
      ])
    );
  }

  function renderNoAccess(user) {
    tabHost = null;
    dom.clear(mount);
    var signout = h('button', { type: 'button', class: 'admin-btn admin-btn--primary' }, 'Sign out');
    signout.addEventListener('click', signOut);
    var who = user && user.email ? "You're signed in as " + user.email + ', which' : 'This account';
    mount.appendChild(
      h('div', { class: 'admin-gate' }, [
        h('div', { class: 'admin-gate__card' }, [
          h('h1', { class: 'admin-gate__title' }, 'No access'),
          h('p', who + " doesn't have access to the admin panel."),
          h('p', { class: 'admin-signin__note' }, 'Sign out to switch to an admin account.'),
          signout,
          h('a', { class: 'admin-btn admin-btn--ghost', href: '/' }, 'Back to FileCast'),
        ]),
      ])
    );
  }

  function renderPanel(user) {
    dom.clear(mount);

    var nav = h('nav', { class: 'admin-tabs', id: 'admin-nav', 'aria-label': 'Admin sections' });
    TABS.forEach(function (t) {
      nav.appendChild(
        h('a', { class: 'admin-tabs__link', href: '#' + t.id, dataset: { tab: t.id } }, [
          tabIcon(t.id),
          h('span', { class: 'admin-tabs__label' }, t.label),
        ])
      );
    });

    // Hamburger: collapses the tab nav into a drawer on narrow screens (matches
    // the main site's header). Hidden on desktop via CSS.
    var hamburger = h('button', {
      type: 'button',
      class: 'admin-hamburger',
      id: 'admin-hamburger',
      'aria-controls': 'admin-nav',
      'aria-expanded': 'false',
      'aria-label': 'Menu',
    }, [svgIcon('menu', 24, 'admin-hamburger__icon')]);
    hamburger.addEventListener('click', function (e) {
      e.stopPropagation();
      setDrawer(hamburger.getAttribute('aria-expanded') !== 'true');
    });

    var signout = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost' }, 'Sign out');
    signout.addEventListener('click', signOut);

    tabHost = h('main', { class: 'admin-main', id: 'admin-tab' });

    mount.appendChild(
      h('div', { class: 'admin-shell' }, [
        h('header', { class: 'admin-topbar' }, [
          h('div', { class: 'admin-topbar__brand' }, 'FileCast Admin'),
          nav,
          h('div', { class: 'admin-topbar__actions' }, [
            h('span', { class: 'admin-topbar__user' }, user.email || ''),
            h('a', { class: 'admin-btn admin-btn--ghost admin-btn--sm', href: '/' }, 'View site'),
            signout,
          ]),
          hamburger,
        ]),
        h('div', { class: 'admin-banner-slot', id: 'admin-banner-slot' }),
        tabHost,
      ])
    );

    if (!routerBound) {
      window.addEventListener('hashchange', route);
      routerBound = true;
    }

    // Close the drawer on Escape or an outside click. Bound once; the handlers
    // re-resolve the current elements by id, so they survive panel re-renders.
    if (!drawerBound) {
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') setDrawer(false);
      });
      document.addEventListener('click', function (e) {
        var ham = document.getElementById('admin-hamburger');
        if (!ham || ham.getAttribute('aria-expanded') !== 'true') return;
        var navEl = document.getElementById('admin-nav');
        if (navEl && !navEl.contains(e.target) && !ham.contains(e.target)) {
          setDrawer(false);
        }
      });
      drawerBound = true;
    }

    // Load the shared catalog once, then route (dashboard labels need it). On an
    // auth error we hand off to the gate and MUST NOT also route — otherwise a
    // tab would render into the panel we're about to tear down and re-fire the
    // same 401s. So route() lives in the success and non-auth-error paths only.
    api
      .get('/api/v1/tools')
      .then(function (data) {
        ADMIN.catalog.rebuild((data && data.tools) || []);
        route();
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        route(); // labels degrade to raw ids; tabs still render
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
    setDrawer(false); // a tab was chosen → collapse the mobile drawer
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
