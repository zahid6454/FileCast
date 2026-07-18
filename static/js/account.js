// Account page (Phase 5 §9). Runs ONLY on /account/. Fills #account-app with the
// signed-in sections (profile, favorites, history, preferences, "Your Data",
// sign out). Reuses window.FILECAST.me (the /me promise auth.js starts) so the
// page and header don't both fetch /me. Signed-out / stale-cookie → leaves the
// server-rendered sign-in prompt untouched.
//
// Safe DOM only: every user-controlled value (name, email, history rows, tool
// names, avatar URL) reaches the page via textContent / <img src> / setAttribute,
// NEVER innerHTML (P23). No inline handlers (P7).
(function () {
  'use strict';

  var F = window.FILECAST;
  if (!F || !F.apiBase) return;
  var app = document.getElementById('account-app');
  if (!app) return; // not the account page
  var API = F.apiBase.replace(/\/$/, '');

  // --- helpers ------------------------------------------------------------

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
  function lsSet(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch (e) {
      /* ignore */
    }
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

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

  function resolvedTheme() {
    var t = document.documentElement.dataset.theme;
    if (t === 'light' || t === 'dark') return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

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

  function api(path, opts) {
    return fetch(API + path, Object.assign({ credentials: 'include' }, opts || {}));
  }

  function putPreferences(patch) {
    return api('/api/v1/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
  }

  function section(title) {
    return el('section', { class: 'account-card' }, [
      el('h2', { class: 'account-card__title', text: title })
    ]);
  }

  function formatKb(kb) {
    if (kb == null) return '—';
    if (kb >= 1024) return (kb / 1024).toFixed(1) + ' MB';
    return kb + ' KB';
  }

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
  }

  // --- 1. Profile ---------------------------------------------------------

  function profileSection(user) {
    var card = section('Profile');

    // Meta on the left, avatar on the right — both Google-sourced and read-only
    // (we never store an editable profile; the picture identifies the account).
    var head = el('div', { class: 'account-profile' });
    var meta = el('div', { class: 'account-profile__meta' }, [
      el('div', { class: 'account-profile__name', text: user.name || '' }),
      el('div', { class: 'account-profile__email', text: user.email || '' }),
      el('div', {
        class: 'account-profile__since',
        text: user.created_at ? 'Member since ' + formatDate(user.created_at) : ''
      })
    ]);
    head.appendChild(meta);
    if (user.avatar_url) {
      var img = el('img', {
        class: 'account-profile__avatar',
        alt: '',
        referrerpolicy: 'no-referrer'
      });
      img.setAttribute('src', user.avatar_url);
      head.appendChild(img);
    }
    card.appendChild(head);

    return card;
  }

  function field(labelText, control) {
    return el('label', { class: 'account-field' }, [
      el('span', { class: 'account-field__label', text: labelText }),
      control
    ]);
  }

  // --- 3. Conversion history ---------------------------------------------

  function historySection(toolsById) {
    var card = section('Conversion history (last 30 days)');
    var body = el('div', { class: 'account-history' }, [
      el('p', { class: 'account-empty', text: 'Loading…' })
    ]);
    card.appendChild(body);

    api('/api/v1/user/history?limit=100')
      .then(function (r) {
        return r.ok ? r.json() : { history: [] };
      })
      .catch(function () {
        return { history: [] };
      })
      .then(function (data) {
        var rows = data.history || [];
        clear(body);
        if (rows.length === 0) {
          body.appendChild(
            el('p', {
              class: 'account-empty',
              text: 'No conversions yet. Your history will appear here after you convert a file.'
            })
          );
          return;
        }
        var table = el('table', { class: 'account-table' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { text: 'Tool' }),
              el('th', { text: 'Date' }),
              el('th', { text: 'Size' }),
              el('th', { text: 'Status' })
            ])
          ])
        ]);
        var tbody = el('tbody');
        rows.forEach(function (row) {
          var tool = toolsById[row.tool_id];
          var toolCell = tool
            ? el('td', {}, [el('a', { href: tool.slug + '/', text: tool.name })])
            : el('td', { text: row.tool_id });
          tbody.appendChild(
            el('tr', {}, [
              toolCell,
              el('td', { text: formatDate(row.created_at) }),
              el('td', { text: formatKb(row.file_size_kb) }),
              el('td', { text: row.status || '—' })
            ])
          );
        });
        table.appendChild(tbody);
        body.appendChild(table);
      });

    return card;
  }

  // --- 4. Preferences -----------------------------------------------------

  function preferencesSection(prefs) {
    var card = section('Preferences');

    // Default JPEG quality (10–100).
    var quality = el('input', {
      type: 'range',
      class: 'account-range',
      id: 'pref-jpeg-quality',
      min: '10',
      max: '100',
      step: '1'
    });
    quality.value = String(prefs.jpeg_quality || 80);
    var qVal = el('span', { class: 'account-range__val', text: quality.value });
    quality.addEventListener('input', function () {
      qVal.textContent = quality.value;
    });
    quality.addEventListener('change', function () {
      putPreferences({ jpeg_quality: parseInt(quality.value, 10) });
    });
    card.appendChild(
      field('Default JPEG quality', el('div', { class: 'account-range-row' }, [quality, qVal]))
    );

    // Default PDF compression.
    var pdf = selectControl('pref-pdf-compression', [
      ['low', 'Low'],
      ['medium', 'Medium'],
      ['high', 'High']
    ], prefs.pdf_compression || 'medium');
    pdf.addEventListener('change', function () {
      putPreferences({ pdf_compression: pdf.value });
    });
    card.appendChild(field('Default PDF compression', pdf));

    // Theme — a Dark-mode toggle (matches the header switch, per owner UX). Writes
    // localStorage['fc_theme'] + <html data-theme> + the DB, and broadcasts so the
    // header/drawer switch resyncs.
    card.appendChild(field('Theme', themeSwitch()));

    // Email opt-in — a notification preference, so it lives here (not on Profile).
    var optin = el('input', { type: 'checkbox', id: 'pref-email-updates' });
    if (prefs.email_updates) optin.checked = true;
    optin.addEventListener('change', function () {
      putPreferences({ email_updates: optin.checked });
    });
    card.appendChild(
      el('label', { class: 'account-check' }, [
        optin,
        el('span', { text: 'Send me updates about new tools' })
      ])
    );

    return card;
  }

  function selectControl(id, options, value) {
    var sel = el('select', { class: 'account-input', id: id });
    options.forEach(function (o) {
      var opt = el('option', { value: o[0], text: o[1] });
      if (o[0] === value) opt.setAttribute('selected', '');
      sel.appendChild(opt);
    });
    return sel;
  }

  // A Dark-mode toggle switch (same visual language as the header/drawer switch).
  // Icon + label reflect the current mode; the switch shows on (dark) / off.
  function themeSwitch() {
    var btn = el('button', {
      class: 'account-theme-switch theme-switch',
      type: 'button',
      role: 'switch',
      id: 'pref-theme'
    });
    var iconSlot = icon('icon-moon', 'account-theme-switch__icon');
    var label = el('span', { class: 'theme-switch__label', text: 'Dark mode' });
    var track = el('span', { class: 'theme-switch__track', 'aria-hidden': 'true' }, [
      el('span', { class: 'theme-switch__knob' })
    ]);
    btn.appendChild(iconSlot);
    btn.appendChild(label);
    btn.appendChild(track);
    function paint() {
      var dark = resolvedTheme() === 'dark';
      iconSlot.firstChild.setAttribute('href', dark ? '#icon-moon' : '#icon-sun');
      label.textContent = dark ? 'Dark mode' : 'Light mode';
      btn.setAttribute('aria-label', dark ? 'Dark mode' : 'Light mode');
      btn.setAttribute('aria-checked', dark ? 'true' : 'false');
      btn.classList.toggle('is-on', dark);
    }
    paint();
    document.addEventListener('filecast:theme', paint);
    btn.addEventListener('click', function () {
      var next = resolvedTheme() === 'dark' ? 'light' : 'dark';
      lsSet('fc_theme', next);
      document.documentElement.dataset.theme = next;
      try {
        document.dispatchEvent(new CustomEvent('filecast:theme'));
      } catch (e) {
        /* non-fatal */
      }
      putPreferences({ theme: next });
      paint();
    });
    return btn;
  }

  // --- 5. "Your Data" -----------------------------------------------------

  function dataSection() {
    var card = section('Your Data');

    card.appendChild(
      el('div', { class: 'account-data__cols' }, [
        el('div', {}, [
          el('div', { class: 'account-data__h', text: 'What we store' }),
          bullets(['Which tools you used', 'File size and date', 'Your favorites and preferences'])
        ]),
        el('div', {}, [
          el('div', { class: 'account-data__h', text: 'What we NEVER store' }),
          bullets(['Your files', 'File contents', 'File names', 'IP addresses'])
        ])
      ])
    );
    card.appendChild(
      el('p', {
        class: 'account-data__note',
        text: 'Never sold, never shared, never used for advertising. Delete your account and all data at any time.'
      })
    );

    var download = el('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, [
      icon('icon-download', 'btn__icon'),
      el('span', { text: 'Export My Data' })
    ]);
    download.addEventListener('click', function () {
      download.disabled = true;
      api('/api/v1/users/me/export')
        .then(function (r) {
          if (!r.ok) throw new Error('export-failed');
          return r.blob();
        })
        .then(function (blob) {
          var url = URL.createObjectURL(blob);
          var a = el('a', { href: url, download: 'filecast-account-data.json' });
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function () {
            URL.revokeObjectURL(url);
          }, 1000);
        })
        .catch(function () {
          /* no-op */
        })
        .then(function () {
          download.disabled = false;
        });
    });

    var del = el('button', { type: 'button', class: 'btn btn--danger btn--sm' }, [
      el('span', { text: 'Delete My Account' })
    ]);
    var actions = el('div', { class: 'account-data__actions' }, [download, del]);
    card.appendChild(actions);

    // Inline confirmation (a real, deliberate step — not a link).
    del.addEventListener('click', function () {
      del.disabled = true;
      var confirmPanel = el('div', { class: 'account-danger', role: 'alertdialog' }, [
        el('p', {
          class: 'account-danger__msg',
          text: 'This will permanently delete your account and all data. This cannot be undone.'
        })
      ]);
      var yes = el('button', { type: 'button', class: 'btn btn--danger btn--sm' }, [
        el('span', { text: 'Yes, delete everything' })
      ]);
      var no = el('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, [
        el('span', { text: 'Cancel' })
      ]);
      confirmPanel.appendChild(el('div', { class: 'account-danger__actions' }, [yes, no]));
      actions.parentNode.insertBefore(confirmPanel, actions.nextSibling);

      no.addEventListener('click', function () {
        confirmPanel.parentNode.removeChild(confirmPanel);
        del.disabled = false;
      });
      yes.addEventListener('click', function () {
        yes.disabled = true;
        api('/api/v1/users/me', { method: 'DELETE' })
          .then(function (r) {
            if (!r.ok) throw new Error('delete-failed');
            clearLoggedIn(); // server already cleared fc_session
            window.location.href = '/';
          })
          .catch(function () {
            yes.disabled = false;
          });
      });
    });

    return card;
  }

  function bullets(items) {
    var ul = el('ul', { class: 'account-data__list' });
    items.forEach(function (t) {
      ul.appendChild(el('li', { text: t }));
    });
    return ul;
  }

  // --- boot ---------------------------------------------------------------

  function render(user) {
    var prefs = user.preferences || {};
    clear(app);
    // Resolve tool metadata once for both favorites and history links.
    fetch('/tool-data.json')
      .then(function (r) {
        return r.ok ? r.json() : [];
      })
      .catch(function () {
        return [];
      })
      .then(function (tools) {
        var byId = {};
        (tools || []).forEach(function (t) {
          byId[t.id] = t;
        });
        clear(app);
        app.appendChild(profileSection(user));
        app.appendChild(favoritesSectionResolved(user, byId));
        app.appendChild(historySection(byId));
        app.appendChild(preferencesSection(prefs));
        app.appendChild(dataSection());
      });
  }

  // Favorites with tool map already resolved (avoids a second fetch).
  function favoritesSectionResolved(user, byId) {
    var card = section('Favorites');
    var grid = el('div', { class: 'account-fav-grid' });
    card.appendChild(grid);
    var ids = user.favorites || [];
    if (ids.length === 0) {
      grid.appendChild(
        el('p', {
          class: 'account-empty',
          text: 'No favorites yet. Click the heart on any tool page to bookmark it.'
        })
      );
      return card;
    }
    ids.forEach(function (id) {
      var tool = byId[id];
      var remove = el('button', {
        type: 'button',
        class: 'account-fav__remove',
        'aria-label': 'Remove favorite'
      }, [el('span', { 'aria-hidden': 'true', text: '×' })]);
      var favEl = tool
        ? el('div', { class: 'account-fav' }, [
            el('a', { class: 'account-fav__link', href: tool.slug + '/', text: tool.name }),
            remove
          ])
        : el('div', { class: 'account-fav account-fav--gone' }, [
            el('span', { class: 'account-fav__link', text: id }),
            remove
          ]);
      remove.addEventListener('click', function () {
        api('/api/v1/favorites/' + encodeURIComponent(id), { method: 'DELETE' })
          .then(function (r) {
            if (r.ok && favEl.parentNode) favEl.parentNode.removeChild(favEl);
          })
          .catch(function () {});
      });
      grid.appendChild(favEl);
    });
    return card;
  }

  function boot() {
    if (!hasLoggedIn()) return; // leave the server-rendered sign-in prompt
    // theme-init set <html data-auth="in"> pre-paint, so CSS has already hidden
    // the signed-out prompt — no flash. Show a placeholder until /me resolves.
    var loading = el('p', { class: 'account-empty', text: 'Loading your account…' });
    app.appendChild(loading);
    getMe()
      .then(render) // clears app (prompt + placeholder) and builds the sections
      .catch(function () {
        // Stale cookie: reveal the untouched server prompt, drop the marker.
        clearLoggedIn();
        if (loading.parentNode) loading.parentNode.removeChild(loading);
        document.documentElement.dataset.auth = 'out';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
