// Site-wide navigation + progressive-enhancement behaviors (Phase 3).
// Loaded deferred on every page via base.html, AFTER filecast-config.js (so
// window.FILECAST.apiBase is available). No hostname hack, no inline handlers —
// everything here is bound in JS to stay CSP-clean under `script-src 'self'`.
//
// Responsibilities (each guarded so it no-ops where its DOM is absent):
//   1. Theme-toggle button — cycle light → dark → system (theme-init.js already
//      applied the stored choice before first paint; this owns the button only).
//   2. Hamburger drawer (<768px) — open/close the nav, aria-expanded, Esc/outside.
//   3. Category dropdowns — toggle visibility + aria-expanded (contents are
//      server-rendered from nav_categories, so NO per-page JSON fetch here).
//   4. Hero/404 search — ONLY if #hero-search exists: fetch tool-data.json once
//      and drive a fully keyboard-navigable combobox (P21 fetch-gating + P22 a11y).
//   5. Announcement bar — fetch the active announcement; show/dismiss, or stay
//      hidden on any failure (silent progressive enhancement).
(function () {
  'use strict';

  // -------------------------------------------------------------------------
  // 1. Theme toggle (simple light ↔ dark)
  // -------------------------------------------------------------------------
  // A plain two-state toggle: the page starts on the resolved theme (an explicit
  // stored choice, else the OS preference) and each click flips light ↔ dark —
  // no intermediate "system" step, so there is never a wasted click.
  function readStored() {
    try {
      var t = localStorage.getItem('fc_theme');
      return t === 'light' || t === 'dark' ? t : null;
    } catch (e) {
      return null;
    }
  }

  function systemPrefersDark() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (e) {
      return false;
    }
  }

  // The theme currently in effect: an explicit choice wins, else the OS setting.
  function effectiveTheme() {
    return readStored() || (systemPrefersDark() ? 'dark' : 'light');
  }

  function applyTheme(state) {
    var root = document.documentElement;
    try {
      localStorage.setItem('fc_theme', state);
    } catch (e) {
      // Storage unavailable: still reflect the live choice on <html>.
    }
    root.dataset.theme = state;
  }

  var THEME_LABELS = {
    light: 'Theme: light. Switch to dark.',
    dark: 'Theme: dark. Switch to light.'
  };

  function reflectThemeButton(btn, state) {
    btn.dataset.themeState = state; // CSS shows the matching sprite icon
    btn.setAttribute('aria-label', THEME_LABELS[state] || THEME_LABELS.light);
  }

  function initThemeToggle() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    reflectThemeButton(btn, effectiveTheme());
    btn.addEventListener('click', function () {
      var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      reflectThemeButton(btn, next);
    });
  }

  // -------------------------------------------------------------------------
  // 2. Hamburger drawer
  // -------------------------------------------------------------------------
  function initHamburger() {
    var btn = document.getElementById('hamburger');
    var drawer = document.getElementById('nav-drawer');
    if (!btn || !drawer) return;

    function setOpen(open) {
      drawer.classList.toggle('header__nav--open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(btn.getAttribute('aria-expanded') !== 'true');
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setOpen(false);
    });

    document.addEventListener('click', function (e) {
      if (btn.getAttribute('aria-expanded') !== 'true') return;
      if (!drawer.contains(e.target) && e.target !== btn) setOpen(false);
    });
  }

  // -------------------------------------------------------------------------
  // 3. Category dropdowns (contents server-rendered — toggle only)
  // -------------------------------------------------------------------------
  function initDropdowns() {
    var toggles = document.querySelectorAll('.nav-dropdown__toggle');
    if (!toggles.length) return;

    function closeAll(except) {
      document.querySelectorAll('.nav-dropdown--open').forEach(function (d) {
        if (d !== except) {
          d.classList.remove('nav-dropdown--open');
          var t = d.querySelector('.nav-dropdown__toggle');
          if (t) t.setAttribute('aria-expanded', 'false');
        }
      });
    }

    toggles.forEach(function (toggle) {
      var parent = toggle.closest('.nav-dropdown');
      if (!parent) return;
      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = !parent.classList.contains('nav-dropdown--open');
        closeAll(parent);
        parent.classList.toggle('nav-dropdown--open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.nav-dropdown')) closeAll(null);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAll(null);
    });
  }

  // -------------------------------------------------------------------------
  // 4. Hero / 404 search (fetch ONLY when #hero-search exists — P21)
  // -------------------------------------------------------------------------
  function initHeroSearch() {
    var input = document.getElementById('hero-search');
    if (!input) return; // P21: no fetch on pages without the search box
    var results = document.getElementById('hero-search-results');
    if (!results) return;

    var tools = [];
    var loaded = false;
    var activeIndex = -1;
    var matches = [];

    fetch('/tool-data.json')
      .then(function (r) {
        if (!r.ok) throw new Error('tool-data ' + r.status);
        return r.json();
      })
      .then(function (data) {
        tools = Array.isArray(data) ? data : [];
        loaded = true;
        // If the user already typed while the fetch was in flight, render now.
        if (input.value.trim()) render(input.value);
      })
      .catch(function () {
        // Silent: the input degrades to a plain (inert) field. No console spam.
      });

    function filter(query) {
      var q = query.toLowerCase().trim();
      if (!q) return [];
      return tools
        .filter(function (t) {
          return (
            (t.name || '').toLowerCase().indexOf(q) !== -1 ||
            (t.input_format || '').toLowerCase().indexOf(q) !== -1 ||
            (t.output_format || '').toLowerCase().indexOf(q) !== -1 ||
            (t.tagline || '').toLowerCase().indexOf(q) !== -1
          );
        })
        .slice(0, 8);
    }

    function close() {
      results.classList.add('hidden');
      results.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      activeIndex = -1;
      matches = [];
    }

    function setActive(i) {
      var opts = results.querySelectorAll('.hero-search__option');
      opts.forEach(function (o) { o.classList.remove('hero-search__option--active'); });
      activeIndex = i; // update state first — never let a UI side-effect below strand it
      if (i >= 0 && i < opts.length) {
        opts[i].classList.add('hero-search__option--active');
        input.setAttribute('aria-activedescendant', opts[i].id);
        if (typeof opts[i].scrollIntoView === 'function') {
          try { opts[i].scrollIntoView({ block: 'nearest' }); } catch (e) {}
        }
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function render(query) {
      matches = filter(query);
      if (!matches.length) {
        close();
        return;
      }
      var html = '';
      matches.forEach(function (t, i) {
        var label = t.input_format && t.output_format && t.input_format !== t.output_format
          ? t.input_format + ' → ' + t.output_format
          : t.name;
        html +=
          '<li class="hero-search__option" role="option" id="hero-search-opt-' + i + '">' +
          '<span class="hero-search__option-name">' + escapeHtml(t.name) + '</span>' +
          '<span class="hero-search__option-meta">' + escapeHtml(label) + '</span></li>';
      });
      results.innerHTML = html;
      results.classList.remove('hidden');
      input.setAttribute('aria-expanded', 'true');
      activeIndex = -1;
      input.removeAttribute('aria-activedescendant');
    }

    function escapeHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function navigate(i) {
      if (i < 0 || i >= matches.length) return;
      var slug = matches[i].slug;
      if (slug) window.location.href = slug.charAt(slug.length - 1) === '/' ? slug : slug + '/';
    }

    input.addEventListener('input', function () {
      if (!loaded) return; // data not ready yet; onload re-renders
      render(input.value);
    });

    input.addEventListener('keydown', function (e) {
      if (results.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(activeIndex + 1 >= matches.length ? 0 : activeIndex + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(activeIndex - 1 < 0 ? matches.length - 1 : activeIndex - 1);
      } else if (e.key === 'Enter') {
        if (activeIndex >= 0) {
          e.preventDefault();
          navigate(activeIndex);
        }
      } else if (e.key === 'Escape') {
        close();
      }
    });

    results.addEventListener('click', function (e) {
      var opt = e.target.closest('.hero-search__option');
      if (!opt) return;
      var opts = Array.prototype.slice.call(results.querySelectorAll('.hero-search__option'));
      navigate(opts.indexOf(opt));
    });

    document.addEventListener('click', function (e) {
      if (e.target !== input && !results.contains(e.target)) close();
    });
  }

  // -------------------------------------------------------------------------
  // 5. Announcement bar
  // -------------------------------------------------------------------------
  // Only accept an absolute http(s) URL or a root-relative same-origin path.
  // Blocks javascript:/data:/etc. (defense-in-depth: the announcement message
  // is admin-controlled and `script-src 'self'` already neuters javascript:
  // navigation, but the CSP is only enforced on the deploy preview).
  function isSafeLink(href) {
    if (!href || typeof href !== 'string') return false;
    if (/^https?:\/\//i.test(href)) return true;
    // Root-relative same-origin only. Validate against the real origin rather
    // than trusting the two-char prefix — browsers fold `\` -> `/`, so a
    // `/\evil.com` (prefix looks root-relative) resolves offsite (//evil.com).
    if (href.charAt(0) === '/' && href.charAt(1) !== '/') {
      try {
        return new URL(href, window.location.href).origin === window.location.origin;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  function initAnnouncement() {
    var bar = document.getElementById('announcement-bar');
    if (!bar) return;
    var apiBase = window.FILECAST && window.FILECAST.apiBase;
    if (!apiBase) return; // no origin configured → stay hidden

    fetch(apiBase.replace(/\/$/, '') + '/api/v1/announcements/active')
      .then(function (r) {
        if (!r.ok) throw new Error('announcements ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var a = data && data.announcement;
        if (!a || !a.message) return; // no active row → stay hidden

        var dismissed = null;
        try {
          dismissed = localStorage.getItem('fc_announcement_dismissed');
        } catch (e) {}
        if (dismissed && String(dismissed) === String(a.id)) return;

        var msg = document.getElementById('announcement-bar__message');
        if (msg) msg.textContent = a.message;

        var link = document.getElementById('announcement-bar__link');
        if (link) {
          if (isSafeLink(a.link)) {
            link.href = a.link;
            link.classList.remove('hidden');
          } else {
            link.classList.add('hidden');
          }
        }

        var type = a.type || 'info';
        bar.classList.add('announcement-bar--' + type);
        bar.classList.remove('hidden');

        var dismiss = document.getElementById('announcement-bar__dismiss');
        if (dismiss) {
          dismiss.addEventListener('click', function () {
            bar.classList.add('hidden');
            try {
              localStorage.setItem('fc_announcement_dismissed', String(a.id));
            } catch (e) {}
          });
        }
      })
      .catch(function () {
        // API down/absent/non-2xx → bar stays hidden. No console error.
      });
  }

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------
  function init() {
    initThemeToggle();
    initHamburger();
    initDropdowns();
    initHeroSearch();
    initAnnouncement();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
