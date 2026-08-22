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
  var MESSAGES = []; // current page only — server-paginated, not the whole inbox
  var LIMIT = 25;
  var PAGE = 0;
  var STATUS_FILTER = ''; // '' = all, else 'new' | 'read'
  var TOTAL = 0;
  var HAS_MORE = false;
  // Search text survives a tab switch (see LOADED below) even though the
  // input node itself doesn't — it lives in a fresh container each time
  // render() is called, so its value can't be the source of truth.
  var SEARCH_TEXT = '';
  // {new, read} inbox-wide totals for the toolbar badges — independent of
  // STATUS_FILTER/search, so they need their own fetch (GET .../counts).
  var COUNTS = null;
  // True once this tab has completed a real fetch at least once. Re-entering
  // the tab (switching away and back) with LOADED true skips the network
  // round-trip entirely and just re-renders the last-known MESSAGES/COUNTS —
  // messages don't need to be live-fresh on every click through the admin
  // nav, and this avoids the previous behavior of discarding the page/filter/
  // search the admin had set up every time they left and returned. A real
  // page reload still starts fresh (LOADED is a module-level var, gone on
  // reload). Only a successful load sets it — an error leaves it false so
  // the next tab entry retries instead of re-showing the error state.
  var LOADED = false;
  // True once the toolbar (search + filter select) exists in the DOM. Paging,
  // filtering, and status changes must NOT tear it down and rebuild it — that
  // would wipe whatever the admin typed into search and steal focus on every
  // click. Only the very first successful load (or a fresh tab entry / a
  // transition out of the true-empty-inbox state) builds it.
  var SHELL_BUILT = false;
  // Bumped on every fetch; a response is applied only if it's still current —
  // guards against a slow "Next" response landing after a faster "Previous"
  // (or a rapid double-click) and clobbering newer state with stale rows.
  var REQUEST_SEQ = 0;
  // renderList() rebuilds every row from scratch on each call (search, and
  // a status mutation via setStatus) — without tracking which one was open,
  // marking a message read while its detail is expanded would snap it shut
  // on the very re-render the click itself triggered.
  var EXPANDED_ID = null;

  var STATUS_BADGE = { new: 'unread', read: 'read' };
  var STATUS_LABEL = { new: 'Unread', read: 'Read' };
  var FILTER_OPTIONS = [
    { value: '', label: 'All' },
    { value: 'new', label: 'Unread' },
    { value: 'read', label: 'Read' }
  ];

  function filterLabel(value) {
    var match = FILTER_OPTIONS.filter(function (opt) {
      return opt.value === value;
    })[0];
    return match ? match.label : 'All';
  }

  // Closes the status-filter dropdown if it's open. Reads live off CONTAINER
  // (module-level, always the current tab render) rather than a captured
  // node — see the module-level click/keydown listeners below, which are
  // registered once at script load and must keep working across every
  // renderShell() rebuild.
  function closeFilterMenu(focusToggle) {
    if (!CONTAINER) return;
    var wrap = CONTAINER.querySelector('.admin-msgfilter');
    if (!wrap || !wrap.classList.contains('admin-dropdown--open')) return;
    wrap.classList.remove('admin-dropdown--open');
    var toggle = wrap.querySelector('.admin-dropdown__toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', 'false');
      if (focusToggle) toggle.focus();
    }
  }

  // Registered once (not per renderShell) — renderShell() reruns on every
  // tab re-entry with a fresh CONTAINER, so listeners bound inside it would
  // pile up across re-entries. These check CONTAINER live instead of
  // capturing a node, so they keep working after any number of rebuilds.
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.admin-msgfilter')) closeFilterMenu(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeFilterMenu(true);
  });

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
    return api.put('/api/v1/admin/messages/' + m.id, { status: status }).then(function () {
      // Not ADMIN.notifySaved({live:true}) — that's the generic "Saved — live
      // now" every other tab's live mutation reuses verbatim, which reads oddly
      // for a status flip. notifySaved({live:true}) does nothing beyond that
      // toast (app.js), so a direct, specific toast loses nothing.
      ADMIN.toast(status === 'read' ? 'Marked as read' : 'Marked as unread', 'success');
      // Reload the current page rather than patch in place — a status change
      // can move a message out of the active filter (e.g. marking a message
      // read while "Unread" is selected), which also shifts total/has_more.
      loadMessages();
      // A status flip is the only thing that changes the unread/read totals —
      // plain paging/filtering doesn't, so this is the one other call site
      // that needs a fresh count (see render()'s initial load for the other).
      loadCounts();
    });
  }

  function detailRow(term, value) {
    return h('div', { class: 'admin-msgrow__drow' }, [h('dt', term), h('dd', value || '—')]);
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
    } else {
      var unreadBtn = h(
        'button',
        { type: 'button', class: 'admin-btn admin-btn--ghost admin-btn--sm' },
        'Mark unread'
      );
      unreadBtn.addEventListener('click', function () {
        setStatus(m, 'new').catch(function (err) {
          if (err && err.isAuthError) return ADMIN.onAuthError(err);
          ADMIN.toast('Could not update status', 'error');
        });
      });
      actions.push(unreadBtn);
    }

    var expanded = m.id === EXPANDED_ID;
    var detail = h('div', { class: 'admin-msgrow__detail', hidden: !expanded }, [
      h('p', { class: 'admin-msgrow__msg' }, m.body || '(empty message)'),
      h('dl', { class: 'admin-msgrow__dl' }, [
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
        class: 'admin-msgrow__summary',
        'aria-expanded': expanded ? 'true' : 'false'
      },
      [
        h(
          'span',
          { class: 'admin-badge admin-badge--' + (STATUS_BADGE[m.status] || 'inactive') },
          STATUS_LABEL[m.status] || m.status
        ),
        h('span', { class: 'admin-msgrow__tool' }, m.title || '(no subject)'),
        h('span', { class: 'admin-msgrow__snippet' }, m.body || ''),
        h('time', { class: 'admin-msgrow__time' }, fmtDate(m.created_at)),
        h('span', { class: 'admin-msgrow__chev', 'aria-hidden': 'true' }, '▸')
      ]
    );
    summary.addEventListener('click', function () {
      var open = summary.getAttribute('aria-expanded') === 'true';
      summary.setAttribute('aria-expanded', open ? 'false' : 'true');
      detail.hidden = open;
      EXPANDED_ID = open ? null : m.id;
    });

    // A message row's left edge is status-driven (unread=red, read=green) —
    // unlike errors.js's rows, which are always red because every row there
    // genuinely is an error. Messages get their own class family (below)
    // rather than borrowing errrow's, so that distinction is structural, not
    // a color patched on top of a mismatched default.
    var statusClass = m.status === 'read' ? 'admin-msgrow--read' : 'admin-msgrow--unread';
    return h('li', { class: 'admin-msgrow ' + statusClass }, [summary, detail]);
  }

  function clearSearch() {
    var input = CONTAINER && CONTAINER.querySelector('.admin-msgsearch');
    if (input) input.value = '';
    SEARCH_TEXT = '';
    renderList();
  }

  function renderList() {
    var list = CONTAINER.querySelector('.admin-msglist');
    var countEl = CONTAINER.querySelector('.admin-msgcount');
    var searchInput = CONTAINER.querySelector('.admin-msgsearch');
    if (!list) return;
    // Undo showListLoading()'s disable — a fresh fetch has landed, the filter
    // is interactive again. The pager below gets fresh (enabled-by-default)
    // buttons rebuilt from scratch, so it needs no equivalent reset here.
    var filterToggleEl = CONTAINER.querySelector('.admin-msgfilter .admin-dropdown__toggle');
    if (filterToggleEl) filterToggleEl.disabled = false;
    dom.clear(list);
    var q = ((searchInput && searchInput.value) || '').trim().toLowerCase();
    var shown = MESSAGES.filter(function (m) {
      return matches(m, q);
    });
    if (countEl) {
      // Unfiltered case is covered by the unread/read badges (.admin-msgcounts)
      // instead — this text is only useful once a search narrows the page.
      countEl.textContent = q ? shown.length + ' of ' + MESSAGES.length + ' on this page' : '';
    }
    if (shown.length === 0) {
      var emptyLi = h('li', { class: 'admin-msg-emptyrow' });
      emptyLi.appendChild(
        ADMIN.emptyState({
          icon: 'inbox',
          title: 'No matching messages',
          text: q ? 'Nothing on this page matches "' + q + '".' : 'No messages have this status.',
          actionLabel: q ? 'Clear search' : null,
          onAction: q ? clearSearch : null
        })
      );
      list.appendChild(emptyLi);
    } else {
      shown.forEach(function (m) {
        list.appendChild(row(m));
      });
    }

    var pagerHost = CONTAINER.querySelector('.admin-msgpager');
    if (pagerHost) {
      dom.clear(pagerHost);
      if (PAGE > 0 || HAS_MORE) {
        var pageCount = Math.max(1, Math.ceil(TOTAL / LIMIT));
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
        if (PAGE === 0) prev.disabled = true;
        if (!HAS_MORE) next.disabled = true;
        prev.addEventListener('click', function () {
          if (PAGE > 0) {
            PAGE -= 1;
            loadMessages();
          }
        });
        next.addEventListener('click', function () {
          if (HAS_MORE) {
            PAGE += 1;
            loadMessages();
          }
        });
        pagerHost.appendChild(
          h('div', { class: 'admin-pager' }, [
            prev,
            h('span', { class: 'admin-pager__info' }, 'Page ' + (PAGE + 1) + ' of ' + pageCount),
            next
          ])
        );
      }
    }
  }

  // Same chevron-down glyph as the site nav's category dropdown
  // (.nav-dropdown__caret in base.html) — an inline currentColor SVG, not a
  // background-image, so it follows dark mode via admin.css's token-only rule
  // instead of needing its own light/dark variants.
  function caretIcon() {
    return dom.svg(
      'svg',
      {
        class: 'admin-dropdown__caret',
        'aria-hidden': 'true',
        focusable: 'false',
        viewBox: '0 0 24 24'
      },
      [
        dom.svg('path', {
          d: 'M6 9l6 6 6-6',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': '2',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round'
        })
      ]
    );
  }

  function renderShell() {
    dom.clear(CONTAINER);
    SHELL_BUILT = false;
    LOADED = true;

    if (TOTAL === 0 && !STATUS_FILTER) {
      CONTAINER.appendChild(
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
      'aria-label': 'Search messages',
      value: SEARCH_TEXT
    });
    search.addEventListener('input', function () {
      SEARCH_TEXT = search.value;
      renderList();
    });

    var filterToggle = h(
      'button',
      {
        type: 'button',
        class: 'admin-dropdown__toggle',
        'aria-haspopup': 'listbox',
        'aria-expanded': 'false'
      },
      [h('span', { class: 'admin-msgfilter__label' }, filterLabel(STATUS_FILTER)), caretIcon()]
    );
    var filterLabelEl = filterToggle.querySelector('.admin-msgfilter__label');

    var filterItems = FILTER_OPTIONS.map(function (opt) {
      var item = h(
        'button',
        {
          type: 'button',
          class: 'admin-dropdown__item',
          role: 'option',
          'aria-selected': opt.value === STATUS_FILTER ? 'true' : 'false'
        },
        opt.label
      );
      item.addEventListener('click', function () {
        closeFilterMenu(true);
        if (STATUS_FILTER === opt.value) return;
        STATUS_FILTER = opt.value;
        PAGE = 0;
        filterLabelEl.textContent = opt.label;
        filterItems.forEach(function (other) {
          other.setAttribute('aria-selected', other === item ? 'true' : 'false');
        });
        loadMessages();
      });
      return item;
    });
    filterItems.forEach(function (item, idx) {
      item.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          (filterItems[idx + 1] || filterItems[0]).focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          (filterItems[idx - 1] || filterItems[filterItems.length - 1]).focus();
        }
      });
    });

    var filterMenu = h(
      'div',
      { class: 'admin-dropdown__menu', role: 'listbox', 'aria-label': 'Filter by status' },
      filterItems
    );

    var filterWrap = h('div', { class: 'admin-msgfilter admin-dropdown' }, [
      filterToggle,
      filterMenu
    ]);
    function openFilterMenu() {
      filterWrap.classList.add('admin-dropdown--open');
      filterToggle.setAttribute('aria-expanded', 'true');
      var current = filterMenu.querySelector('[aria-selected="true"]') || filterItems[0];
      if (current) current.focus();
    }
    filterToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = !filterWrap.classList.contains('admin-dropdown--open');
      // Only one dropdown exists on this tab today, but closing any other
      // open one first keeps this consistent with the site nav's closeAll()
      // behavior if a second admin dropdown ever lands next to it.
      closeFilterMenu(false);
      if (open) openFilterMenu();
    });
    // ArrowDown/Up while the closed toggle has focus opens straight to the
    // first/last option — the native <select> this replaced supported the
    // same shortcut, so keyboard users lose nothing by the switch.
    filterToggle.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        openFilterMenu();
      }
    });
    // A native <select>'s open list captures Tab itself; this hand-built menu
    // doesn't, so without an explicit close-on-blur, tabbing out of it (as
    // opposed to clicking away or hitting Escape) would leave it visually
    // open while focus has already moved elsewhere on the page.
    filterWrap.addEventListener('focusout', function (e) {
      if (!filterWrap.contains(e.relatedTarget)) closeFilterMenu(false);
    });

    var counts = h('div', { class: 'admin-msgcounts' });

    CONTAINER.appendChild(
      h('div', { class: 'admin-toolbar' }, [
        search,
        filterWrap,
        h('span', { class: 'admin-msgcount admin-muted' }, ''),
        counts
      ])
    );

    CONTAINER.appendChild(h('ul', { class: 'admin-msglist' }));
    CONTAINER.appendChild(h('div', { class: 'admin-msgpager' }));
    SHELL_BUILT = true;
    renderList();
    renderCounts();
  }

  // Swap just the list body for a loading placeholder ahead of a page/filter/
  // status-change fetch — the toolbar (search text, filter selection) stays
  // put. Only called when the shell already exists; the very first load shows
  // its own full-container loading state instead (see render()).
  function showListLoading() {
    var list = CONTAINER.querySelector('.admin-msglist');
    if (list) {
      dom.clear(list);
      list.appendChild(h('li', { class: 'admin-loading' }, 'Loading…'));
    }
    closeFilterMenu(false);
    var filterToggleEl = CONTAINER.querySelector('.admin-msgfilter .admin-dropdown__toggle');
    if (filterToggleEl) filterToggleEl.disabled = true;
    var pagerHost = CONTAINER.querySelector('.admin-msgpager');
    if (pagerHost) {
      Array.prototype.forEach.call(pagerHost.querySelectorAll('button'), function (b) {
        b.disabled = true;
      });
    }
  }

  function loadMessages() {
    var seq = ++REQUEST_SEQ;
    if (SHELL_BUILT) showListLoading();
    var url = '/api/v1/admin/messages?limit=' + LIMIT + '&offset=' + PAGE * LIMIT;
    if (STATUS_FILTER) url += '&status=' + encodeURIComponent(STATUS_FILTER);
    api
      .get(url)
      .then(function (data) {
        if (seq !== REQUEST_SEQ) return; // a newer request has since superseded this one
        MESSAGES = (data && data.messages) || [];
        TOTAL = (data && data.total) || 0;
        HAS_MORE = !!(data && data.has_more);
        // A status change (or a filter switch) can shrink the current filter's
        // result set out from under an already-paginated view — e.g. marking
        // the last "Unread" message on page 2 as read leaves page 2 pointing
        // past the end. Step back one page rather than showing a dangling
        // "Page 3 of 2" with no way back except spotting the disabled Next.
        if (MESSAGES.length === 0 && PAGE > 0) {
          PAGE -= 1;
          loadMessages();
          return;
        }
        if (SHELL_BUILT) {
          renderList();
        } else {
          renderShell();
        }
      })
      .catch(function (err) {
        if (seq !== REQUEST_SEQ) return;
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        dom.clear(CONTAINER);
        SHELL_BUILT = false;
        var retry = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost' }, 'Retry');
        retry.addEventListener('click', function () {
          loadMessages();
        });
        CONTAINER.appendChild(
          h('div', { class: 'admin-error-state' }, [h('p', "Couldn't load messages."), retry])
        );
      });
  }

  // Unread/read totals for the toolbar badges — a separate call from
  // loadMessages() because it must stay independent of STATUS_FILTER (the
  // badges always reflect the whole inbox, not just the active filter).
  // Best-effort: a failure here just leaves the badges showing their last
  // known values (or blank on first load) rather than derailing the tab.
  var COUNTS_SEQ = 0;
  function loadCounts() {
    // Same stale-response guard as loadMessages()'s REQUEST_SEQ: two mark-
    // read/unread clicks fired close together each start their own
    // loadCounts(), and without this the earlier request landing after the
    // later one would paint a superseded, wrong total over the current one.
    var seq = ++COUNTS_SEQ;
    api
      .get('/api/v1/admin/messages/counts')
      .then(function (data) {
        if (seq !== COUNTS_SEQ) return;
        COUNTS = data || { new: 0, read: 0 };
        renderCounts();
      })
      .catch(function () {});
  }

  function renderCounts() {
    var host = CONTAINER && CONTAINER.querySelector('.admin-msgcounts');
    if (!host || !COUNTS) return;
    dom.clear(host);
    // Own class family, not .admin-badge — that's the per-row status pill,
    // and reusing it here would make '.admin-badge--read' match both a row's
    // "Read" pill and this toolbar's "N read" count.
    host.appendChild(
      h(
        'span',
        { class: 'admin-msgcounts__badge admin-msgcounts__badge--unread' },
        COUNTS.new + ' unread'
      )
    );
    host.appendChild(
      h(
        'span',
        { class: 'admin-msgcounts__badge admin-msgcounts__badge--read' },
        COUNTS.read + ' read'
      )
    );
  }

  function render(container) {
    CONTAINER = container;
    if (LOADED) {
      // Tab re-entry: reuse the last-loaded page/filter/search rather than
      // refetching and resetting them — see LOADED's declaration above.
      // loadCounts() still fires unconditionally, though: it's cheap and
      // independent of the cached list, and without it a single transient
      // failure on the very first load would leave COUNTS null (and the
      // badges permanently blank) for the rest of the session — LOADED has
      // no equivalent "retry next time" flag the way loadMessages() does.
      renderShell();
      loadCounts();
      return;
    }
    EXPANDED_ID = null; // fresh tab entry — start with every row collapsed
    PAGE = 0;
    STATUS_FILTER = '';
    SHELL_BUILT = false;
    dom.clear(container);
    container.appendChild(h('div', { class: 'admin-loading' }, 'Loading messages…'));
    loadMessages();
    loadCounts();
  }

  ADMIN.tabs.messages = { render: render };
})();
