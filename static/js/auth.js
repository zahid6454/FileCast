// Site-wide auth & account touchpoints (Phase 5 §10). Loaded on every page via
// base.html, AFTER nav.js (so window.FILECAST exists) and after tool-config/
// shared (so window.TOOL_CONFIG exists for the synchronous ×2).
//
// Everything degrades silently: if the API is down or the user is anonymous, no
// network fires that isn't gated by the fc_logged_in cookie (P12/D10), and every
// tool keeps working. Safe DOM only — user-controlled strings (email, name,
// history rows, avatar URL) reach the page via textContent / setAttribute /
// <img src>, NEVER innerHTML (P23). No inline handlers (P7).
(function () {
  'use strict';

  var F = window.FILECAST;
  if (!F || !F.apiBase) return; // no config island → no-op (progressive enhancement)
  var API = F.apiBase.replace(/\/$/, '');

  var TRUST_LINE = 'We only store which tools you used — never your files.';

  // Banner caps (§10 T2).
  var BANNER_MAX_DISMISSES = 3;
  var BANNER_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
  var K_DISMISS = 'fc_signin_banner_dismisses';
  var K_SNOOZE = 'fc_signin_banner_snooze_until';

  var bannerShownThisPageview = false;

  // --- tiny helpers -------------------------------------------------------

  function cookie(name) {
    var m = document.cookie.match('(?:^|;\\s*)' + name + '=([^;]*)');
    return m ? m[1] : null;
  }
  function hasLoggedIn() {
    return cookie('fc_logged_in') === '1';
  }
  function clearLoggedIn() {
    document.cookie = 'fc_logged_in=; Max-Age=0; Path=/';
  }

  function ls(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function lsSet(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch (e) {
      /* storage unavailable — non-fatal */
    }
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // el('span', {class:'x', text:'hi'}, [childNodes]) — attrs.text sets
  // textContent (safe); every other key is setAttribute. No innerHTML path.
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') node.textContent = attrs[k];
        else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      });
    }
    if (children) {
      children.forEach(function (c) {
        if (c) node.appendChild(c);
      });
    }
    return node;
  }

  function icon(id, cls) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    if (cls) svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  // The official multi-color Google "G" (brand asset — fixed colors, not tokens).
  function googleIcon() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'user-menu__gicon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    [
      [
        '#4285F4',
        'M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.59-5.17 3.59-8.82z'
      ],
      [
        '#34A853',
        'M12 24c3.24 0 5.95-1.08 7.96-2.91l-3.86-3c-1.08.72-2.45 1.16-4.1 1.16-3.15 0-5.82-2.13-6.77-4.99H1.24v3.09C3.24 21.3 7.31 24 12 24z'
      ],
      [
        '#FBBC05',
        'M5.23 14.26c-.24-.72-.38-1.49-.38-2.26s.14-1.54.38-2.26V6.65H1.24C.45 8.24 0 10.06 0 12s.45 3.76 1.24 5.35l3.99-3.09z'
      ],
      [
        '#EA4335',
        'M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.24 2.7 1.24 6.65l3.99 3.09C6.18 6.88 8.85 4.75 12 4.75z'
      ]
    ].forEach(function (p) {
      var path = document.createElementNS(ns, 'path');
      path.setAttribute('fill', p[0]);
      path.setAttribute('d', p[1]);
      svg.appendChild(path);
    });
    return svg;
  }

  // Idempotent /me getter (§15-D): whichever of auth.js / account.js runs first
  // starts the request; both reuse the same promise. Resolves to the user
  // object, rejects on 401/failure. Only ever called when fc_logged_in is set.
  function getMe() {
    if (!F.me) {
      F.me = fetch(API + '/api/v1/auth/me', { credentials: 'include' })
        .then(function (r) {
          if (!r.ok) throw new Error('unauthed');
          return r.json();
        })
        .then(function (d) {
          return d.user;
        });
    }
    return F.me;
  }

  // =======================================================================
  // Header user menu (#user-menu)
  // =======================================================================

  function signInHref(next) {
    var href = API + '/api/v1/auth/google';
    if (next) href += '?next=' + encodeURIComponent(next);
    return href;
  }

  // --- theme control (a signed-in privilege) ------------------------------

  function resolvedTheme() {
    var t = document.documentElement.dataset.theme;
    if (t === 'light' || t === 'dark') return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  // Broadcast so every mounted switch (dropdown + drawer) repaints in sync, and
  // so a switch built BEFORE reconcileThemeFromMe resolves picks up the DB theme.
  function emitThemeChange() {
    try {
      document.dispatchEvent(new CustomEvent('filecast:theme'));
    } catch (e) {
      /* CustomEvent unavailable — non-fatal */
    }
  }

  function applyThemeChoice(theme) {
    lsSet('fc_theme', theme);
    document.documentElement.dataset.theme = theme;
    emitThemeChange();
    putTheme(theme); // fire-and-forget DB sync
  }

  // A "Dark mode" row with an animated switch (on = dark), shared by the dropdown
  // and the mobile drawer. role="switch" + aria-checked make it accessible; the
  // .theme-switch track/knob animate via CSS. Only ever built for signed-in users.
  function themeToggleControl(cls) {
    var btn = el('button', { class: cls + ' theme-switch', type: 'button', role: 'switch' });
    var iconSlot = icon('icon-moon', 'user-menu__item-icon');
    var label = el('span', { class: 'theme-switch__label', text: 'Dark mode' });
    var track = el('span', { class: 'theme-switch__track', 'aria-hidden': 'true' }, [
      el('span', { class: 'theme-switch__knob' })
    ]);
    btn.appendChild(iconSlot);
    btn.appendChild(label);
    btn.appendChild(track);
    function paint() {
      var dark = resolvedTheme() === 'dark';
      // Icon + label reflect the CURRENT mode (moon/"Dark mode" when dark,
      // sun/"Light mode" when light); the switch shows the same on/off state.
      iconSlot.firstChild.setAttribute('href', dark ? '#icon-moon' : '#icon-sun');
      label.textContent = dark ? 'Dark mode' : 'Light mode';
      btn.setAttribute('aria-label', dark ? 'Dark mode' : 'Light mode');
      btn.setAttribute('aria-checked', dark ? 'true' : 'false');
      btn.classList.toggle('is-on', dark);
    }
    paint();
    // Repaint whenever the theme changes anywhere (another switch, or the
    // one-shot DB reconciliation that may resolve after this switch is built).
    document.addEventListener('filecast:theme', paint);
    btn.addEventListener('click', function (e) {
      e.stopPropagation(); // keep the menu/drawer open
      applyThemeChoice(resolvedTheme() === 'dark' ? 'light' : 'dark');
    });
    return btn;
  }

  // --- header user menu ---------------------------------------------------

  function googleButton() {
    return el(
      'a',
      {
        class: 'user-menu__signin',
        href: signInHref(null),
        title: TRUST_LINE,
        'aria-label': 'Sign in with Google'
      },
      [googleIcon(), el('span', { class: 'user-menu__signin-label', text: 'Sign in' })]
    );
  }

  // The full Google-branded button (used everywhere a "Sign in with Google" CTA
  // appears except the compact header pill above). Reuses the multi-color G.
  function googleBrandedButton(next) {
    var g = googleIcon();
    g.setAttribute('class', 'btn-google__icon');
    return el(
      'a',
      {
        class: 'btn-google',
        href: signInHref(next),
        'aria-label': 'Sign in with Google'
      },
      [g, el('span', { text: 'Sign in with Google' })]
    );
  }

  function renderSignIn(menu) {
    clear(menu);
    menu.appendChild(googleButton());
  }

  function dropdownItem(label, href, iconId, onClick) {
    var attrs = { class: 'user-menu__item', role: 'menuitem' };
    var tag = href ? 'a' : 'button';
    if (href) attrs.href = href;
    else attrs.type = 'button';
    var kids = [];
    if (iconId) kids.push(icon(iconId, 'user-menu__item-icon'));
    kids.push(el('span', { text: label }));
    var node = el(tag, attrs, kids);
    if (onClick) node.addEventListener('click', onClick);
    return node;
  }

  function renderSignedIn(menu, user) {
    clear(menu);

    var toggle = el('button', {
      class: 'user-menu__toggle',
      type: 'button',
      'aria-haspopup': 'true',
      'aria-expanded': 'false',
      'aria-label': 'Account menu'
    });
    // Avatar-only trigger (the picture identifies the account; no name clutter).
    // Falls back to a name label only when Google gave us no avatar.
    if (user.avatar_url) {
      var img = el('img', { class: 'user-menu__avatar', alt: '', referrerpolicy: 'no-referrer' });
      img.setAttribute('src', user.avatar_url); // lh3.googleusercontent.com <img>
      toggle.appendChild(img);
    } else {
      toggle.appendChild(
        el('span', { class: 'user-menu__name', text: user.name || user.email || 'Account' })
      );
    }
    toggle.appendChild(el('span', { class: 'user-menu__caret', 'aria-hidden': 'true' }));

    var menuList = el('div', { class: 'user-menu__dropdown', role: 'menu', hidden: 'hidden' });
    menuList.appendChild(dropdownItem('My Account', '/account/', 'icon-user'));
    if (user.role === 'admin')
      menuList.appendChild(dropdownItem('Admin', '/admin/', 'icon-shield'));
    menuList.appendChild(el('div', { class: 'user-menu__sep', role: 'separator' }));
    // Dark-mode switch in the middle (a signed-in perk).
    menuList.appendChild(themeToggleControl('user-menu__item user-menu__item--toggle'));
    menuList.appendChild(el('div', { class: 'user-menu__sep', role: 'separator' }));
    menuList.appendChild(dropdownItem('Sign Out', null, 'icon-logout', signOut));

    function setOpen(open) {
      menuList.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(menuList.hidden);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setOpen(false);
    });
    document.addEventListener('click', function (e) {
      if (menuList.hidden) return;
      if (!menu.contains(e.target)) setOpen(false);
    });

    menu.appendChild(toggle);
    menu.appendChild(menuList);
  }

  // --- mobile: account section at the BOTTOM of the nav drawer -------------

  function renderDrawer(user) {
    var drawer = document.getElementById('nav-drawer');
    if (!drawer) return;
    var old = drawer.querySelector('.nav-account');
    if (old) old.remove();

    var box = el('div', { class: 'nav-account' });
    if (!user) {
      box.appendChild(googleButton());
    } else {
      box.appendChild(accountDrawerLink(user));
      if (user.role === 'admin') {
        box.appendChild(drawerLink('Admin', '/admin/', 'icon-shield'));
      }
      box.appendChild(themeToggleControl('nav-account__link nav-account__toggle'));
      var out = el('button', { class: 'nav-account__link', type: 'button' }, [
        icon('icon-logout', 'nav-account__icon'),
        el('span', { text: 'Sign Out' })
      ]);
      out.addEventListener('click', signOut);
      box.appendChild(out);
    }
    drawer.appendChild(box);
  }

  function drawerLink(label, href, iconId) {
    return el('a', { class: 'nav-account__link', href: href }, [
      icon(iconId, 'nav-account__icon'),
      el('span', { text: label })
    ]);
  }

  // My Account uses the Google avatar as its "icon"; falls back to icon-user when
  // Google gave us no picture (the account is still identified by the label).
  function accountDrawerLink(user) {
    var link = el('a', { class: 'nav-account__link', href: '/account/' });
    if (user.avatar_url) {
      var img = el('img', { class: 'nav-account__avatar', alt: '', referrerpolicy: 'no-referrer' });
      img.setAttribute('src', user.avatar_url);
      link.appendChild(img);
    } else {
      link.appendChild(icon('icon-user', 'nav-account__icon'));
    }
    link.appendChild(el('span', { text: 'My Account' }));
    return link;
  }

  function signOut() {
    fetch(API + '/api/v1/auth/logout', { method: 'POST', credentials: 'include' })
      .then(reload)
      .catch(reload);
    function reload() {
      clearLoggedIn();
      window.location.reload();
    }
  }

  function initUserMenu() {
    var menu = document.getElementById('user-menu');
    if (!hasLoggedIn()) {
      if (menu) renderSignIn(menu); // zero network for anonymous visitors (P12)
      renderDrawer(null);
      return;
    }
    getMe()
      .then(function (user) {
        if (menu) renderSignedIn(menu, user);
        renderDrawer(user);
      })
      .catch(function () {
        clearLoggedIn();
        document.documentElement.dataset.auth = 'out'; // drop the signed-in marker
        if (menu) renderSignIn(menu);
        renderDrawer(null);
      });
  }

  // =======================================================================
  // Favorites heart (tool pages, signed-in only)
  // =======================================================================

  function setHeart(btn, on) {
    btn.classList.toggle('is-fav', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', on ? 'Remove from favorites' : 'Save to favorites');
  }

  function initFavHeart(user) {
    var cfg = window.TOOL_CONFIG;
    if (!cfg) return;
    var btn = document.getElementById('tool-fav');
    if (!btn) return;

    if (!btn.querySelector('svg')) btn.appendChild(icon('icon-heart', 'tool-fav__icon'));

    var toolId = cfg.id;
    var fav = (user.favorites || []).indexOf(toolId) !== -1;
    setHeart(btn, fav);
    btn.hidden = false;

    btn.addEventListener('click', function () {
      var next = !fav;
      fav = next;
      setHeart(btn, next); // optimistic
      var req = next
        ? fetch(API + '/api/v1/favorites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ tool_id: toolId })
          })
        : fetch(API + '/api/v1/favorites/' + encodeURIComponent(toolId), {
            method: 'DELETE',
            credentials: 'include'
          });
      req
        .then(function (r) {
          if (!r.ok) throw new Error('fav-failed');
        })
        .catch(function () {
          fav = !next; // revert on failure
          setHeart(btn, fav);
        });
    });
  }

  // =======================================================================
  // Doubled per-tool-type limits (§6.1) — mutate the live TOOL_CONFIG
  // =======================================================================

  // "12MB" / "500 KB" → bytes, or null if it doesn't parse.
  function sizeToBytes(str) {
    var m = /^\s*([\d.]+)\s*(KB|MB|GB|B)?\s*$/i.exec(str || '');
    if (!m) return null;
    var n = parseFloat(m[1]);
    if (isNaN(n)) return null;
    var unit = (m[2] || 'B').toUpperCase();
    var mult = unit === 'GB' ? 1073741824 : unit === 'MB' ? 1048576 : unit === 'KB' ? 1024 : 1;
    return Math.round(n * mult);
  }

  // Double only the leading number in a display string ("25MB" → "50MB"); if it
  // doesn't parse, leave it untouched (cosmetic only — bytes are authoritative).
  function doubleSizeString(str) {
    return String(str).replace(/^\s*([\d.]+)/, function (_, num) {
      var d = parseFloat(num) * 2;
      return (Number.isInteger(d) ? d : d.toFixed(1)).toString();
    });
  }

  function updateUploadHint(cfg) {
    var hint = document.querySelector('.upload-zone__hint');
    if (!hint || !cfg.max_file_size) return;
    // Rebuild the hint text from the (now doubled) config, safe via textContent.
    var accepts = (cfg.accept_extensions || []).join(', ');
    var isMulti = typeof cfg.max_files === 'number';
    var text = 'Accepts: ' + accepts + ' — Max: ' + cfg.max_file_size;
    if (isMulti) text += ' per file, ' + cfg.max_files + ' files';
    // Only overwrite when we actually have an accepts list to rebuild with;
    // otherwise leave the server-rendered hint as-is.
    if (accepts) hint.textContent = text;
  }

  // Synchronous ×2 from the cookie (before /me), so a fast user is never wrongly
  // capped. Applies to every tool type (§6.2). Reconciled by /me if the user has
  // an absolute override.
  function applyDoubledLimitsSync() {
    var cfg = window.TOOL_CONFIG;
    if (!cfg || !hasLoggedIn()) return;
    if (typeof cfg.max_file_size_bytes === 'number') cfg.max_file_size_bytes *= 2;
    if (cfg.max_file_size) cfg.max_file_size = doubleSizeString(cfg.max_file_size);
    if (typeof cfg.max_files === 'number') cfg.max_files *= 2;
    updateUploadHint(cfg);
  }

  // On /me: a per-user absolute override (user.max_file_size) beats the ×2 for
  // client-side tools. Currently always null (D9), but implement the hook.
  // Server-side tools always use the flat ×2 (server enforces it), so skip them.
  function reconcileLimitsFromMe(user) {
    var cfg = window.TOOL_CONFIG;
    if (!cfg || cfg.type === 'server-side') return;
    if (!user.max_file_size) return;
    var bytes = sizeToBytes(user.max_file_size);
    if (!bytes) return;
    cfg.max_file_size_bytes = bytes;
    cfg.max_file_size = user.max_file_size;
    updateUploadHint(cfg);
  }

  // =======================================================================
  // Post-conversion touchpoint: banner (anon) / "Saved ✓" (signed-in)
  // =======================================================================

  function slot() {
    return document.getElementById('signin-slot');
  }

  function showSavedBadge() {
    var s = slot();
    if (!s) return;
    clear(s);
    var badge = el('div', { class: 'signin-saved', role: 'status' }, [
      el('span', { text: 'Saved to your history ✓' })
    ]);
    s.appendChild(badge);
    s.hidden = false;
  }

  function bannerAllowed() {
    if (bannerShownThisPageview) return false;
    var dismisses = parseInt(ls(K_DISMISS) || '0', 10) || 0;
    if (dismisses >= BANNER_MAX_DISMISSES) return false;
    var snooze = parseInt(ls(K_SNOOZE) || '0', 10) || 0;
    if (Date.now() < snooze) return false;
    return true;
  }

  function showSignInBanner() {
    var s = slot();
    if (!s || !bannerAllowed()) return;
    bannerShownThisPageview = true;
    clear(s);

    var benefits = el('ul', { class: 'signin-banner__benefits' }, [
      el('li', { text: '30-day conversion history' }),
      el('li', { text: 'Favorite your most-used tools' }),
      el('li', { text: 'Higher file-size limits' }),
      el('li', { text: 'Saved quality preferences' })
    ]);

    var signInBtn = googleBrandedButton(null);
    signInBtn.classList.add('signin-banner__cta');

    var laterBtn = el(
      'button',
      {
        class: 'signin-banner__dismiss',
        type: 'button',
        'aria-label': 'Dismiss'
      },
      [el('span', { text: 'Maybe later ×' })]
    );
    laterBtn.addEventListener('click', function () {
      var dismisses = (parseInt(ls(K_DISMISS) || '0', 10) || 0) + 1;
      lsSet(K_DISMISS, String(dismisses));
      lsSet(K_SNOOZE, String(Date.now() + BANNER_SNOOZE_MS));
      s.hidden = true;
      clear(s);
    });

    var banner = el(
      'div',
      { class: 'signin-banner', role: 'region', 'aria-label': 'Create an account' },
      [
        el('div', { class: 'signin-banner__head' }, [
          el('span', { class: 'signin-banner__lock', 'aria-hidden': 'true', text: '🔒' }),
          el('strong', { text: 'Want to track your conversions?' })
        ]),
        benefits,
        el('p', { class: 'signin-banner__trust', text: TRUST_LINE }),
        el('div', { class: 'signin-banner__actions' }, [signInBtn, laterBtn])
      ]
    );

    s.appendChild(banner);
    s.hidden = false;
  }

  // Decide from SYNCHRONOUSLY-known state only (§15-C) — never from a pending
  // /me. Attached in init (not inside a promise) so a fast conversion can't fire
  // before the listener exists.
  function onConversion(e) {
    if (e && e.detail && e.detail.saved === true) {
      showSavedBadge(); // truthful: implies signed-in + persisted (D3/P5)
      return;
    }
    if (!hasLoggedIn()) {
      showSignInBanner(); // anonymous → capped banner
    }
    // else: signed-in but not saved (rare history miss) → show nothing.
  }

  // =======================================================================
  // Theme DB-sync (§10 / P20) — localStorage stays the runtime source
  // =======================================================================

  var lastSyncedTheme = null;
  function putTheme(theme) {
    if (!theme || theme === lastSyncedTheme) return;
    lastSyncedTheme = theme;
    fetch(API + '/api/v1/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ theme: theme })
    }).catch(function () {
      lastSyncedTheme = null; // allow a retry on the next toggle
    });
  }

  // One-shot reconciliation with the DB theme on sign-in (both directions).
  function reconcileThemeFromMe(user) {
    var prefs = (user && user.preferences) || {};
    var dbTheme = prefs.theme;
    var localTheme = ls('fc_theme');
    if (!localTheme && (dbTheme === 'light' || dbTheme === 'dark')) {
      // Fresh browser: adopt the DB theme once (no local choice to flash from).
      lsSet('fc_theme', dbTheme);
      document.documentElement.dataset.theme = dbTheme;
      lastSyncedTheme = dbTheme;
      emitThemeChange(); // resync any switch built before this reconciliation
    } else if (localTheme && !dbTheme) {
      // Local choice made while anonymous → seed the DB once.
      putTheme(localTheme);
    } else if (dbTheme) {
      lastSyncedTheme = dbTheme; // in sync; avoid a redundant PUT on first toggle
    }
  }

  // =======================================================================
  // Init
  // =======================================================================

  function init() {
    // Synchronous, cookie-only work first (no network, order-independent).
    applyDoubledLimitsSync();
    document.addEventListener('filecast:conversion', onConversion);
    initUserMenu();

    // Signed-in enrichments that need /me (favorites list, absolute limit
    // override, theme reconciliation). Reuses the cached promise; no-op + no
    // network for anonymous visitors.
    if (hasLoggedIn()) {
      getMe()
        .then(function (user) {
          initFavHeart(user);
          reconcileLimitsFromMe(user);
          reconcileThemeFromMe(user);
        })
        .catch(function () {
          /* not actually signed in — user menu already handled the fallback */
        });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
