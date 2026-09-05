// Errors tab (#errors) — a dedicated, full-detail view of the client error log.
//
// Rendered as readable cards (not a cramped table): each card leads with the
// tool, a coloured error-type badge and the time, shows the full message in a
// legible mono block, and has a Details disclosure (browser / raw tool id /
// error # / exact timestamp) plus a Copy-message button. This is a P23 hot
// spot — error_type/error_message/browser come from the PUBLIC, anonymous
// POST /errors — so every field reaches the DOM via textContent (h()), never
// markup.
//
// Server-paginated (mirrors messages.js): the log can run into the thousands,
// so only one page is ever fetched at a time. Search is client-side but
// page-scoped — it filters the currently loaded page, not the whole log.
(function () {
  'use strict';
  var ADMIN = (window.ADMIN = window.ADMIN || {});
  ADMIN.tabs = ADMIN.tabs || {};
  var dom = ADMIN.dom;
  var api = ADMIN.api;
  var h = dom.h;

  var CONTAINER = null;
  var ERRORS = []; // current page only — server-paginated, not the whole log
  var PAGE_SIZES = [10, 25, 50, 100];
  var LIMIT = 25;
  var PAGE = 0;
  var TOTAL = 0;
  var HAS_MORE = false;
  // Search text survives a tab switch (see LOADED below) even though the
  // input node itself doesn't — it lives in a fresh container each time
  // render() is called, so its value can't be the source of truth.
  var SEARCH_TEXT = '';
  // True once this tab has completed a real fetch at least once. Re-entering
  // the tab reuses the last-loaded page/page-size/search rather than
  // refetching and resetting them. A real page reload starts fresh (LOADED
  // is a module-level var, gone on reload). Only a successful load sets it —
  // an error leaves it false so the next tab entry retries.
  var LOADED = false;
  // True once the toolbar (search + page-size select) exists in the DOM.
  // Paging must NOT tear it down and rebuild it — that would wipe whatever
  // the admin typed into search and steal focus on every click.
  var SHELL_BUILT = false;
  // Bumped on every fetch; a response is applied only if it's still current —
  // guards against a slow "Previous" response landing after a faster "Next"
  // (or a rapid double-click) and clobbering newer state with stale rows.
  var REQUEST_SEQ = 0;

  // Closes the page-size dropdown if it's open. Reads live off CONTAINER
  // (module-level, always the current tab render) rather than a captured
  // node — the module-level click/keydown listeners below are registered
  // once at script load and must keep working across every renderShell()
  // rebuild (mirrors messages.js's closeFilterMenu).
  function closePageSizeMenu(focusToggle) {
    if (!CONTAINER) return;
    var wrap = CONTAINER.querySelector('.admin-errpagesize');
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
    if (!e.target.closest('.admin-errpagesize')) closePageSizeMenu(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closePageSizeMenu(true);
  });

  function labelFor(toolId) {
    if (ADMIN.catalog && typeof ADMIN.catalog.label === 'function') {
      return ADMIN.catalog.label(toolId);
    }
    return toolId || '—';
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  function matches(e, q) {
    if (!q) return true;
    return (
      (e.error_message || '').toLowerCase().indexOf(q) >= 0 ||
      (e.error_type || '').toLowerCase().indexOf(q) >= 0 ||
      (e.browser || '').toLowerCase().indexOf(q) >= 0 ||
      (e.tool_id || '').toLowerCase().indexOf(q) >= 0 ||
      labelFor(e.tool_id).toLowerCase().indexOf(q) >= 0
    );
  }

  function detailRow(term, value) {
    return h('div', { class: 'admin-errrow__drow' }, [h('dt', term), h('dd', value || '—')]);
  }

  // A compact one-line row (card background) that expands inline to full detail.
  function row(e) {
    var copyBtn = h(
      'button',
      { type: 'button', class: 'admin-btn admin-btn--ghost admin-errrow__copy' },
      'Copy message'
    );
    copyBtn.addEventListener('click', function () {
      try {
        navigator.clipboard.writeText(e.error_message || '').then(
          function () {
            ADMIN.toast('Message copied', 'success');
          },
          function () {
            ADMIN.toast('Copy failed', 'error');
          }
        );
      } catch (err) {
        ADMIN.toast('Copy not supported', 'error');
      }
    });

    var detail = h('div', { class: 'admin-errrow__detail', hidden: true }, [
      // Full message (P23: textContent via h()).
      h('code', { class: 'admin-errrow__msg' }, e.error_message || '(no message)'),
      h('dl', { class: 'admin-errrow__dl' }, [
        detailRow('Browser', e.browser),
        detailRow('Tool id', e.tool_id),
        detailRow('Error #', e.id != null ? String(e.id) : null),
        detailRow('Timestamp', fmtDate(e.created_at))
      ]),
      copyBtn
    ]);

    // The whole summary line is the toggle (real <button> → keyboard-operable).
    var summary = h(
      'button',
      {
        type: 'button',
        class: 'admin-errrow__summary',
        'aria-expanded': 'false'
      },
      [
        e.error_type
          ? h('span', { class: 'admin-badge admin-badge--error' }, e.error_type)
          : h('span', { class: 'admin-badge admin-badge--role' }, 'error'),
        h('span', { class: 'admin-errrow__tool' }, labelFor(e.tool_id)),
        // One-line snippet; CSS truncates with an ellipsis.
        h('span', { class: 'admin-errrow__snippet' }, e.error_message || '(no message)'),
        h('time', { class: 'admin-errrow__time' }, fmtDate(e.created_at)),
        h('span', { class: 'admin-errrow__chev', 'aria-hidden': 'true' }, '▸')
      ]
    );
    summary.addEventListener('click', function () {
      var open = summary.getAttribute('aria-expanded') === 'true';
      summary.setAttribute('aria-expanded', open ? 'false' : 'true');
      detail.hidden = open;
    });

    return h('li', { class: 'admin-errrow' }, [summary, detail]);
  }

  function clearSearch() {
    var input = CONTAINER && CONTAINER.querySelector('.admin-errsearch');
    if (input) input.value = '';
    SEARCH_TEXT = '';
    renderList();
  }

  function renderList() {
    var list = CONTAINER.querySelector('.admin-errlist');
    var countEl = CONTAINER.querySelector('.admin-errcount');
    var searchInput = CONTAINER.querySelector('.admin-errsearch');
    if (!list) return;
    // Undo showListLoading()'s disable — a fresh fetch has landed, the
    // page-size dropdown is interactive again. The pager below gets fresh
    // (enabled-by-default) buttons rebuilt from scratch, so it needs no
    // equivalent reset here.
    var pageSizeToggleEl = CONTAINER.querySelector('.admin-errpagesize .admin-dropdown__toggle');
    if (pageSizeToggleEl) pageSizeToggleEl.disabled = false;
    dom.clear(list);
    var q = ((searchInput && searchInput.value) || '').trim().toLowerCase();
    var shown = ERRORS.filter(function (e) {
      return matches(e, q);
    });
    if (countEl) {
      countEl.textContent = q
        ? shown.length + ' of ' + ERRORS.length + ' on this page'
        : ERRORS.length + ' of ' + TOTAL;
    }
    if (shown.length === 0) {
      var emptyLi = h('li', { class: 'admin-empty' });
      emptyLi.appendChild(
        ADMIN.emptyState({
          icon: 'check',
          title: 'No matching errors',
          text: q ? 'Nothing on this page matches "' + q + '".' : 'No errors on this page.',
          actionLabel: q ? 'Clear search' : null,
          onAction: q ? clearSearch : null
        })
      );
      list.appendChild(emptyLi);
    } else {
      shown.forEach(function (e) {
        list.appendChild(row(e));
      });
    }

    var pagerHost = CONTAINER.querySelector('.admin-errpager');
    if (pagerHost) {
      dom.clear(pagerHost);
      // Only takes up row space (via its margin-left:auto, see admin.css)
      // once it actually has content — an empty pager host on a single-page
      // result must not eat toolbar width that the search/count could use.
      pagerHost.hidden = !(PAGE > 0 || HAS_MORE);
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
            loadErrors();
          }
        });
        next.addEventListener('click', function () {
          if (HAS_MORE) {
            PAGE += 1;
            loadErrors();
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

  function renderShell() {
    dom.clear(CONTAINER);
    SHELL_BUILT = false;
    LOADED = true;

    if (TOTAL === 0) {
      CONTAINER.appendChild(
        ADMIN.emptyState({
          icon: 'check',
          title: 'No errors',
          text: 'Nothing has gone wrong recently. Client-side errors reported by the site will show up here.'
        })
      );
      return;
    }

    var search = h('input', {
      type: 'search',
      class: 'admin-input admin-errsearch',
      placeholder: 'Search message, type, tool, browser…',
      'aria-label': 'Search errors',
      value: SEARCH_TEXT
    });
    search.addEventListener('input', function () {
      SEARCH_TEXT = search.value;
      renderList();
    });

    var pageSizeToggle = h(
      'button',
      {
        type: 'button',
        class: 'admin-dropdown__toggle',
        'aria-haspopup': 'listbox',
        'aria-expanded': 'false'
      },
      [h('span', { class: 'admin-errpagesize__label' }, LIMIT + ' per page'), dom.caretIcon()]
    );
    var pageSizeLabelEl = pageSizeToggle.querySelector('.admin-errpagesize__label');

    var pageSizeItems = PAGE_SIZES.map(function (size) {
      var item = h(
        'button',
        {
          type: 'button',
          class: 'admin-dropdown__item',
          role: 'option',
          'aria-selected': size === LIMIT ? 'true' : 'false'
        },
        size + ' per page'
      );
      item.addEventListener('click', function () {
        closePageSizeMenu(true);
        if (size === LIMIT) return;
        LIMIT = size;
        PAGE = 0;
        pageSizeLabelEl.textContent = size + ' per page';
        pageSizeItems.forEach(function (other) {
          other.setAttribute('aria-selected', other === item ? 'true' : 'false');
        });
        loadErrors();
      });
      return item;
    });
    pageSizeItems.forEach(function (item, idx) {
      item.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          (pageSizeItems[idx + 1] || pageSizeItems[0]).focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          (pageSizeItems[idx - 1] || pageSizeItems[pageSizeItems.length - 1]).focus();
        }
      });
    });

    var pageSizeMenu = h(
      'div',
      { class: 'admin-dropdown__menu', role: 'listbox', 'aria-label': 'Errors per page' },
      pageSizeItems
    );

    var pageSizeWrap = h('div', { class: 'admin-errpagesize admin-dropdown' }, [
      pageSizeToggle,
      pageSizeMenu
    ]);
    function openPageSizeMenu() {
      pageSizeWrap.classList.add('admin-dropdown--open');
      pageSizeToggle.setAttribute('aria-expanded', 'true');
      var current = pageSizeMenu.querySelector('[aria-selected="true"]') || pageSizeItems[0];
      if (current) current.focus();
    }
    pageSizeToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = !pageSizeWrap.classList.contains('admin-dropdown--open');
      closePageSizeMenu(false);
      if (open) openPageSizeMenu();
    });
    // ArrowDown/Up while the closed toggle has focus opens straight to the
    // first/last option — the native <select> this replaced supported the
    // same shortcut, so keyboard users lose nothing by the switch.
    pageSizeToggle.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        openPageSizeMenu();
      }
    });
    // A native <select>'s open list captures Tab itself; this hand-built menu
    // doesn't, so without an explicit close-on-blur, tabbing out of it (as
    // opposed to clicking away or hitting Escape) would leave it visually
    // open while focus has already moved elsewhere on the page.
    pageSizeWrap.addEventListener('focusout', function (e) {
      if (!pageSizeWrap.contains(e.relatedTarget)) closePageSizeMenu(false);
    });

    CONTAINER.appendChild(
      h('div', { class: 'admin-toolbar' }, [
        search,
        pageSizeWrap,
        h('span', { class: 'admin-errcount admin-muted' }, ''),
        h('div', { class: 'admin-errpager', hidden: true })
      ])
    );

    CONTAINER.appendChild(h('ul', { class: 'admin-errlist' }));
    SHELL_BUILT = true;
    renderList();
  }

  // Swap just the list body for a loading placeholder ahead of a page/page-
  // size fetch — the toolbar (search text, page-size selection) stays put.
  // Only called when the shell already exists; the very first load shows its
  // own full-container loading state instead (see render()).
  function showListLoading() {
    var list = CONTAINER.querySelector('.admin-errlist');
    if (list) {
      dom.clear(list);
      list.appendChild(h('li', { class: 'admin-loading' }, 'Loading…'));
    }
    closePageSizeMenu(false);
    var pageSizeToggleEl = CONTAINER.querySelector('.admin-errpagesize .admin-dropdown__toggle');
    if (pageSizeToggleEl) pageSizeToggleEl.disabled = true;
    var pagerHost = CONTAINER.querySelector('.admin-errpager');
    if (pagerHost) {
      Array.prototype.forEach.call(pagerHost.querySelectorAll('button'), function (b) {
        b.disabled = true;
      });
    }
  }

  function loadErrors() {
    var seq = ++REQUEST_SEQ;
    if (SHELL_BUILT) showListLoading();
    api
      .get('/api/v1/stats/errors?limit=' + LIMIT + '&offset=' + PAGE * LIMIT)
      .then(function (data) {
        if (seq !== REQUEST_SEQ) return; // a newer request has since superseded this one
        ERRORS = (data && data.errors) || [];
        TOTAL = (data && data.total) || 0;
        HAS_MORE = !!(data && data.has_more);
        // A page-size change (or errors aging out) can leave the current page
        // pointing past the end — step back one page rather than showing a
        // dangling empty page with no way back except spotting a disabled Next.
        if (ERRORS.length === 0 && PAGE > 0) {
          PAGE -= 1;
          loadErrors();
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
          loadErrors();
        });
        CONTAINER.appendChild(
          h('div', { class: 'admin-error-state' }, [h('p', "Couldn't load errors."), retry])
        );
      });
  }

  function render(container) {
    CONTAINER = container;
    if (LOADED) {
      // Tab re-entry: reuse the last-loaded page/page-size/search rather than
      // refetching and resetting them — see LOADED's declaration above.
      renderShell();
      return;
    }
    PAGE = 0;
    SEARCH_TEXT = '';
    SHELL_BUILT = false;
    dom.clear(container);
    container.appendChild(h('div', { class: 'admin-loading' }, 'Loading errors…'));
    loadErrors();
  }

  ADMIN.tabs.errors = { render: render };
})();
