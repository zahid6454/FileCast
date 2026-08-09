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

  // `count` renders a muted chip beside the heading (e.g. "Favorites  7") so the
  // card says how much is in it without a second line of copy.
  function section(title, count) {
    var head = el('h2', { class: 'account-card__title', text: title });
    if (count != null) {
      head.appendChild(el('span', { class: 'account-card__count', text: String(count) }));
    }
    return el('section', { class: 'account-card' }, [head]);
  }

  function formatKb(kb) {
    if (kb == null) return '—';
    // Rows written before FC.sizeKb floored sub-KB inputs at 1 stored a literal 0
    // for small files (a 700-byte SVG). "0 KB" next to a success reads as a bug,
    // so render the truth: it was smaller than the column can express.
    if (kb <= 0) return '< 1 KB';
    if (kb >= 1024) return (kb / 1024).toFixed(1) + ' MB';
    return kb + ' KB';
  }

  // Full timestamp: "08:45 PM · 29 Jul 2026". Replaces the old relative label
  // ("Yesterday", "2 days ago") — history is a record, and a record should say
  // when something happened, not how long ago it was read.
  //
  // Built from toLocale* rather than hand-formatted, so the day/month order
  // follows the reader's locale (29 Jul 2026 in en-GB, Jul 29 2026 in en-US) the
  // same way every other date on this page does. That also rules out an English
  // ordinal suffix ("29th"): Intl has no ordinal date format, and hardcoding one
  // would be wrong for every non-English visitor.
  // `short` drops the year — history is capped at 30 days, so the year is the
  // same on every row and costs ~45px of a phone's ~250px of usable row width.
  // Both variants are rendered and CSS picks one, so there is no resize listener
  // and no reflow on rotate.
  function formatTimestamp(iso, short) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    // hour12 is pinned rather than left to the locale: en-GB and most of Europe
    // default to a 24-hour clock, which would render "20:40" instead of the
    // "08:45 PM" this column is specified in. The DATE half stays locale-ordered.
    var time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    var opts = short
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' };
    return time + ' · ' + d.toLocaleDateString([], opts);
  }

  // Long form for the cell's tooltip — weekday included, nothing abbreviated.
  function formatTimestampFull(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString([], {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  }

  function formatMonthYear(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString([], { month: 'short', year: 'numeric' });
  }

  // --- 1. Profile ---------------------------------------------------------

  // A single stat tile. Returns the node with a `.set()` so async numbers (the
  // 30-day conversion count, which only the history fetch knows) can land later
  // without the tile having to be rebuilt.
  function statTile(value, label, hint) {
    var val = el('div', { class: 'account-stat__value', text: value });
    var tile = el('div', { class: 'account-stat', title: hint }, [
      val,
      el('div', { class: 'account-stat__label', text: label })
    ]);
    tile.set = function (v) {
      val.textContent = v;
    };
    return tile;
  }

  // The largest file this account can upload, as a real number.
  //
  // Limits are PER TOOL (tools/*.yaml, 5MB–50MB) and auth.js doubles the baked
  // limit for a signed-in user, so there is no single site-wide figure. We show
  // the doubled MODAL limit — the value most tools use — because understating is
  // the safe direction to be wrong in: a tool that allows more still accepts the
  // file, whereas an overstated cap sends people to a rejection. An admin-set
  // absolute override on the user wins outright, matching auth.js's precedence.
  function maxUpload(user, tools) {
    if (user.max_file_size) return String(user.max_file_size).replace(/(\d)([A-Za-z])/, '$1 $2');
    var counts = {};
    var best = null;
    (tools || []).forEach(function (t) {
      var b = t.max_file_size_bytes;
      if (!b) return;
      counts[b] = (counts[b] || 0) + 1;
      if (best == null || counts[b] > counts[best]) best = b;
    });
    if (best == null) return '—';
    return Math.round((best * 2) / (1024 * 1024)) + ' MB';
  }

  // Returns { card, setConversions } — the profile card plus a hook the history
  // fetch calls with its `total`, so one request feeds both cards.
  function profileSection(user, tools) {
    // No heading: the name, email and avatar identify this card on sight, so a
    // "Profile" label above them is pure repetition. The cards below it still
    // carry headings because their contents don't announce themselves.
    var card = el('section', { class: 'account-card account-card--profile' });

    // Identity row: avatar left (it anchors the card), name/email beside it.
    // Both are Google-sourced and read-only — we never store an editable profile.
    var head = el('div', { class: 'account-profile' });
    if (user.avatar_url) {
      var img = el('img', {
        class: 'account-profile__avatar',
        alt: '',
        referrerpolicy: 'no-referrer'
      });
      img.setAttribute('src', user.avatar_url);
      // Brand-gradient ring around the (non-editable, Google-sourced) avatar.
      head.appendChild(el('div', { class: 'account-profile__avatar-ring' }, [img]));
    }
    var meta = el('div', { class: 'account-profile__meta' }, [
      el('div', { class: 'account-profile__name', text: user.name || '' }),
      el('div', { class: 'account-profile__email', text: user.email || '' })
    ]);
    if (user.role === 'admin') {
      meta.appendChild(el('div', {}, [el('span', { class: 'account-badge', text: 'Admin' })]));
    }
    head.appendChild(meta);
    card.appendChild(head);

    // Stat strip — the card was mostly empty air with only name/email/join date
    // in it. Everything here is already on /me except the conversion count.
    var conversions = statTile('—', 'Conversions (30d)');
    var favTile = statTile(String((user.favorites || []).length), 'Favorites');
    favTile.classList.add('account-stat--fav'); // removals below update it in place
    card.appendChild(
      el('div', { class: 'account-stats' }, [
        favTile,
        conversions,
        statTile(
          maxUpload(user, tools),
          'Max upload',
          'Your signed-in limit on most tools (2× the anonymous limit). A few tools allow more.'
        ),
        statTile(formatMonthYear(user.created_at), 'Member since')
      ])
    );

    return {
      card: card,
      setConversions: function (n) {
        conversions.set(n == null ? '—' : String(n));
      }
    };
  }

  function field(labelText, control) {
    return el('label', { class: 'account-field' }, [
      el('span', { class: 'account-field__label', text: labelText }),
      control
    ]);
  }

  // --- 3. Conversion history ---------------------------------------------

  var HISTORY_PAGE = 10;
  // Higher than the history page size: a favorite is now a small badge, so a
  // page of 24 takes about the room 12 of the old tiles did.
  var FAVORITES_PAGE = 24;

  // Shared Prev/Next pager for history (server-paged) and favorites (paged
  // client-side from the ids /me already returned). `onGo(nextPage)` re-renders.
  function pager(page, pageCount, onGo) {
    var prev = el(
      'button',
      { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': 'Previous page' },
      [el('span', { text: 'Previous' })]
    );
    var next = el(
      'button',
      { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': 'Next page' },
      [el('span', { text: 'Next' })]
    );
    if (page === 0) prev.disabled = true;
    if (pageCount != null && page >= pageCount - 1) next.disabled = true;
    prev.addEventListener('click', function () {
      if (page > 0) onGo(page - 1);
    });
    next.addEventListener('click', function () {
      onGo(page + 1);
    });
    return {
      node: el('div', { class: 'account-pager' }, [
        prev,
        el('span', {
          class: 'account-pager__info',
          text: 'Page ' + (page + 1) + (pageCount ? ' of ' + pageCount : '')
        }),
        next
      ]),
      next: next
    };
  }

  // A green tick or a red cross — no label. The word "Success" repeated down
  // every row was ink without information; the glyph carries it in a quarter of
  // the width. The icon is aria-hidden and the meaning is exposed as text for
  // assistive tech, since a bare ✓ announces as nothing useful.
  function statusPill(status) {
    var ok = status === 'success' || status === 'ok';
    var known = ok || status === 'failed' || status === 'error';
    var label = ok ? 'Success' : known ? 'Failed' : status || 'Unknown';
    // role="img" + aria-label puts the accessible name on the element itself, so
    // the visible word is free to be display:none on phones without costing the
    // meaning. (Hiding it via a clip-path .sr-only instead left the absolutely
    // positioned text still driving the cell's intrinsic width — the <td> came
    // out 51px wide around an 18px glyph, which is what pushed the mobile row
    // onto a second line.)
    return el(
      'span',
      {
        class: 'account-status ' + (ok ? 'account-status--ok' : 'account-status--bad'),
        role: 'img',
        'aria-label': label,
        title: label
      },
      [
        icon(ok ? 'icon-check' : 'icon-x', 'account-status__icon'),
        el('span', { class: 'account-status__label', text: label })
      ]
    );
  }

  // The badge that identifies a tool everywhere on this page — "PNG → JPG" for a
  // conversion, and the tool's own name for the seven tools whose input and
  // output formats are the same (pdf-compress, image-resize, …), where a
  // "PDF → PDF" badge would say nothing. Falls back to formats, then the raw id,
  // so a tool that has since been removed from the catalogue still renders.
  function toolBadgeChildren(input, output, name) {
    if (input && output && input.toLowerCase() !== output.toLowerCase()) {
      return [
        el('span', { class: 'fc-badge__fmt', text: input.toUpperCase() }),
        el('span', { class: 'fc-badge__arrow', 'aria-hidden': 'true', text: '→' }),
        el('span', { class: 'fc-badge__fmt', text: output.toUpperCase() })
      ];
    }
    return [el('span', { class: 'fc-badge__fmt', text: name || input || '—' })];
  }

  function toolBadge(input, output, name) {
    return el('span', { class: 'fc-badge' }, toolBadgeChildren(input, output, name));
  }

  // One <tr>. `data-label` on each cell is what lets the same markup collapse to
  // stacked label/value pairs on narrow screens (see .account-table in the CSS)
  // instead of a table squeezed to unreadable columns.
  // The badge is the row's identity and its only link. It is NOT stretched over
  // the row: a whole-row hit target gave no clue where to click, and on touch a
  // horizontal drag could resolve as a tap and navigate. Hovering the badge
  // recolours it, which is the affordance.
  function historyRow(row, toolsById) {
    var tool = toolsById[row.tool_id];
    var label = toolBadgeChildren(row.input_format, row.output_format, tool && tool.name);
    var badge = tool
      ? el(
          'a',
          // `title` matters on phones, where the badge column is a fixed slice of
          // the row and a long tool name ellipsizes to fit.
          {
            class: 'fc-badge fc-badge--link',
            href: tool.slug + '/',
            'aria-label': tool.name,
            title: tool.name
          },
          label
        )
      : el('span', { class: 'fc-badge fc-badge--gone', title: row.tool_id }, label);

    var when = el('time', {}, [
      el('span', { class: 'account-when__full', text: formatTimestamp(row.created_at) }),
      el('span', { class: 'account-when__short', text: formatTimestamp(row.created_at, true) })
    ]);
    if (row.created_at) when.setAttribute('datetime', row.created_at);
    // Unabbreviated, with the weekday, on hover.
    when.setAttribute('title', formatTimestampFull(row.created_at));

    return el('tr', {}, [
      el('td', { 'data-label': 'Conversion' }, [badge]),
      el('td', {
        'data-label': 'Size',
        class: 'account-table__num',
        text: formatKb(row.file_size_kb)
      }),
      el('td', { 'data-label': 'Time' }, [when]),
      el('td', { 'data-label': 'Status' }, [statusPill(row.status)])
    ]);
  }

  function historyTable(rows, toolsById) {
    var tbody = el('tbody');
    rows.forEach(function (row) {
      tbody.appendChild(historyRow(row, toolsById));
    });
    return el('div', { class: 'account-table-wrap' }, [
      el('table', { class: 'account-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Conversion' }),
            el('th', { scope: 'col', class: 'account-table__num', text: 'Size' }),
            el('th', { scope: 'col', text: 'Time' }),
            el('th', { scope: 'col', class: 'account-table__status', text: 'Status' })
          ])
        ]),
        tbody
      ])
    ]);
  }

  function historySection(toolsById, onTotal) {
    var card = section('Conversion history', null);
    card.appendChild(
      el('p', { class: 'account-card__sub', text: 'Kept for 30 days, then deleted automatically.' })
    );
    var body = el('div', { class: 'account-history' }, [
      el('p', { class: 'account-empty', text: 'Loading…' })
    ]);
    card.appendChild(body);

    var page = 0;
    var reportedTotal = false;

    function load() {
      api('/api/v1/user/history?limit=' + HISTORY_PAGE + '&offset=' + page * HISTORY_PAGE)
        .then(function (r) {
          return r.ok ? r.json() : { history: [], has_more: false };
        })
        .catch(function () {
          return { history: [], has_more: false };
        })
        .then(renderPage);
    }

    function renderPage(data) {
      var rows = data.history || [];
      if (!reportedTotal && onTotal) {
        reportedTotal = true;
        // Older API builds have no `total`; fall back to what this page proves.
        onTotal(data.total != null ? data.total : rows.length + (data.has_more ? '+' : ''));
      }
      clear(body);
      if (rows.length === 0 && page === 0) {
        body.appendChild(
          el('p', {
            class: 'account-empty',
            text: 'No conversions yet. Your history will appear here after you convert a file.'
          })
        );
        return;
      }
      body.appendChild(historyTable(rows, toolsById));

      // Pager — only when there's more than one page's worth.
      if (page > 0 || data.has_more) {
        var pages = data.total != null ? Math.max(1, Math.ceil(data.total / HISTORY_PAGE)) : null;
        var p = pager(page, pages, function (to) {
          page = to;
          load();
        });
        // Without `total` we cannot compute a page count, so has_more is the only
        // thing that can disable Next.
        if (pages == null && !data.has_more) p.next.disabled = true;
        body.appendChild(p.node);
      }
    }

    load();
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
    var pdf = selectControl(
      'pref-pdf-compression',
      [
        ['low', 'Low'],
        ['medium', 'Medium'],
        ['high', 'High']
      ],
      prefs.pdf_compression || 'medium'
    );
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
        var profile = profileSection(user, tools);
        app.appendChild(profile.card);
        app.appendChild(favoritesSectionResolved(user, byId));
        // The history fetch is the only source of the 30-day count, so it feeds
        // the Profile stat tile rather than us issuing a second request.
        app.appendChild(historySection(byId, profile.setConversions));
        app.appendChild(preferencesSection(prefs));
        app.appendChild(dataSection());
      });
  }

  // Favorites with tool map already resolved (avoids a second fetch).
  //
  // Paged client-side: /me already returns every favorite id, so unlike history
  // there is nothing to fetch per page — but the list is unbounded and a heavy
  // user would otherwise get a wall of tiles, so it uses the same pager.
  function favoritesSectionResolved(user, byId) {
    var ids = (user.favorites || []).slice();
    var card = section('Favorites', ids.length || null);
    var body = el('div', { class: 'account-fav-body' });
    card.appendChild(body);
    var page = 0;

    function emptyState() {
      return el('p', {
        class: 'account-empty',
        text: 'No favorites yet. Click the heart on any tool page to bookmark it.'
      });
    }

    // Keep the heading chip and the Profile stat tile honest after a removal.
    function syncCounts() {
      var chip = card.querySelector('.account-card__count');
      if (chip) {
        if (ids.length === 0) chip.parentNode.removeChild(chip);
        else chip.textContent = String(ids.length);
      }
      var favStat = document.querySelector('.account-stat--fav .account-stat__value');
      if (favStat) favStat.textContent = String(ids.length);
    }

    // A favorite is the same conversion badge the history table uses — "PNG →
    // JPG" instead of "PNG to JPG Converter" with a heart. Same vocabulary in
    // both cards, and the whole list now fits where two rows of tiles did.
    function tile(id) {
      var tool = byId[id];
      var remove = el(
        'button',
        {
          type: 'button',
          class: 'account-fav__remove',
          'aria-label': 'Remove ' + (tool ? tool.name : id) + ' from favorites'
        },
        [el('span', { 'aria-hidden': 'true', text: '×' })]
      );
      var label = tool
        ? toolBadgeChildren(tool.input_format, tool.output_format, tool.name)
        : [el('span', { class: 'fc-badge__fmt', text: id })];
      // The badge is the link; the remove button sits on top of it, so its click
      // must not follow the link.
      var favEl = tool
        ? el('div', { class: 'account-fav' }, [
            el(
              'a',
              {
                class: 'fc-badge fc-badge--link account-fav__link',
                href: tool.slug + '/',
                'aria-label': tool.name
              },
              label
            ),
            remove
          ])
        : el('div', { class: 'account-fav account-fav--gone' }, [
            el('span', { class: 'fc-badge fc-badge--gone account-fav__link' }, label),
            remove
          ]);
      remove.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        remove.disabled = true;
        api('/api/v1/favorites/' + encodeURIComponent(id), { method: 'DELETE' })
          .then(function (r) {
            if (!r.ok) throw new Error('remove-failed');
            ids.splice(ids.indexOf(id), 1);
            syncCounts();
            // Re-render rather than detaching the tile: removing the last item on
            // the final page has to fall back a page, not leave it blank.
            var last = Math.max(0, Math.ceil(ids.length / FAVORITES_PAGE) - 1);
            if (page > last) page = last;
            renderPage();
          })
          .catch(function () {
            remove.disabled = false;
          });
      });
      return favEl;
    }

    function renderPage() {
      clear(body);
      if (ids.length === 0) {
        body.appendChild(emptyState());
        return;
      }
      var grid = el('div', { class: 'account-fav-grid' });
      ids.slice(page * FAVORITES_PAGE, (page + 1) * FAVORITES_PAGE).forEach(function (id) {
        grid.appendChild(tile(id));
      });
      body.appendChild(grid);

      var pages = Math.ceil(ids.length / FAVORITES_PAGE);
      if (pages > 1) {
        body.appendChild(
          pager(page, pages, function (to) {
            page = to;
            renderPage();
          }).node
        );
      }
    }

    renderPage();
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
