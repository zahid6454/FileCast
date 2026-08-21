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
      ADMIN.notifySaved({ live: true });
      // Reload the current page rather than patch in place — a status change
      // can move a message out of the active filter (e.g. marking a message
      // read while "Unread" is selected), which also shifts total/has_more.
      loadMessages();
    });
  }

  function detailRow(term, value) {
    return h('div', { class: 'admin-errrow__drow' }, [h('dt', term), h('dd', value || '—')]);
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
    var detail = h('div', { class: 'admin-errrow__detail', hidden: !expanded }, [
      h('p', { class: 'admin-errrow__msg admin-errrow__msg--prose' }, m.body || '(empty message)'),
      h('dl', { class: 'admin-errrow__dl' }, [
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
        class: 'admin-errrow__summary',
        'aria-expanded': expanded ? 'true' : 'false'
      },
      [
        h(
          'span',
          { class: 'admin-badge admin-badge--' + (STATUS_BADGE[m.status] || 'inactive') },
          STATUS_LABEL[m.status] || m.status
        ),
        h('span', { class: 'admin-errrow__tool' }, m.title || '(no subject)'),
        h('span', { class: 'admin-errrow__snippet' }, m.body || ''),
        h('time', { class: 'admin-errrow__time' }, fmtDate(m.created_at)),
        h('span', { class: 'admin-errrow__chev', 'aria-hidden': 'true' }, '▸')
      ]
    );
    summary.addEventListener('click', function () {
      var open = summary.getAttribute('aria-expanded') === 'true';
      summary.setAttribute('aria-expanded', open ? 'false' : 'true');
      detail.hidden = open;
      EXPANDED_ID = open ? null : m.id;
    });

    return h('li', { class: 'admin-errrow' }, [summary, detail]);
  }

  function clearSearch() {
    var input = CONTAINER && CONTAINER.querySelector('.admin-msgsearch');
    if (input) input.value = '';
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
    var filterEl = CONTAINER.querySelector('.admin-msgfilter');
    if (filterEl) filterEl.disabled = false;
    dom.clear(list);
    var q = ((searchInput && searchInput.value) || '').trim().toLowerCase();
    var shown = MESSAGES.filter(function (m) {
      return matches(m, q);
    });
    if (countEl) {
      countEl.textContent = q
        ? shown.length + ' of ' + MESSAGES.length + ' on this page'
        : TOTAL + (TOTAL === 1 ? ' message' : ' messages');
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

  function renderShell() {
    dom.clear(CONTAINER);
    SHELL_BUILT = false;

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
      'aria-label': 'Search messages'
    });
    search.addEventListener('input', function () {
      renderList();
    });

    var filter = h(
      'select',
      { class: 'admin-input admin-msgfilter', 'aria-label': 'Filter by status' },
      [
        h('option', { value: '' }, 'All'),
        h('option', { value: 'new' }, 'Unread'),
        h('option', { value: 'read' }, 'Read')
      ]
    );
    filter.value = STATUS_FILTER;
    filter.addEventListener('change', function () {
      STATUS_FILTER = filter.value;
      PAGE = 0;
      loadMessages();
    });

    CONTAINER.appendChild(
      h('div', { class: 'admin-toolbar' }, [
        search,
        filter,
        h('span', { class: 'admin-msgcount admin-muted' }, '')
      ])
    );

    CONTAINER.appendChild(h('ul', { class: 'admin-msglist' }));
    CONTAINER.appendChild(h('div', { class: 'admin-msgpager' }));
    SHELL_BUILT = true;
    renderList();
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
    var filterEl = CONTAINER.querySelector('.admin-msgfilter');
    if (filterEl) filterEl.disabled = true;
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

  function render(container) {
    CONTAINER = container;
    EXPANDED_ID = null; // fresh tab entry — start with every row collapsed
    PAGE = 0;
    STATUS_FILTER = '';
    SHELL_BUILT = false;
    dom.clear(container);
    container.appendChild(h('div', { class: 'admin-loading' }, 'Loading messages…'));
    loadMessages();
  }

  ADMIN.tabs.messages = { render: render };
})();
