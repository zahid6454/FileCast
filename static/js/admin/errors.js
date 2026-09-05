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

    var pageSize = h(
      'select',
      { class: 'admin-input admin-errpagesize', 'aria-label': 'Errors per page' },
      PAGE_SIZES.map(function (size) {
        var opt = h('option', { value: String(size) }, size + ' per page');
        if (size === LIMIT) opt.setAttribute('selected', '');
        return opt;
      })
    );
    pageSize.addEventListener('change', function () {
      LIMIT = Number(pageSize.value) || 25;
      PAGE = 0;
      loadErrors();
    });

    CONTAINER.appendChild(
      h('div', { class: 'admin-toolbar' }, [
        search,
        pageSize,
        h('span', { class: 'admin-errcount admin-muted' }, '')
      ])
    );

    CONTAINER.appendChild(h('ul', { class: 'admin-errlist' }));
    CONTAINER.appendChild(h('div', { class: 'admin-errpager' }));
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
    var pageSizeEl = CONTAINER.querySelector('.admin-errpagesize');
    if (pageSizeEl) pageSizeEl.disabled = true;
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
