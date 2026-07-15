// Errors tab (#errors) — a dedicated, full-detail view of the client error log.
//
// Rendered as readable cards (not a cramped table): each card leads with the
// tool, a coloured error-type badge and the time, shows the full message in a
// legible mono block, and has a Details disclosure (browser / raw tool id /
// error # / exact timestamp) plus a Copy-message button. Client-side search
// spans every field. This is a P23 hot spot — error_type/error_message/browser
// come from the PUBLIC, anonymous POST /errors — so every field reaches the DOM
// via textContent (h()), never markup.
(function () {
  'use strict';
  var ADMIN = (window.ADMIN = window.ADMIN || {});
  ADMIN.tabs = ADMIN.tabs || {};
  var dom = ADMIN.dom;
  var api = ADMIN.api;
  var h = dom.h;

  var CONTAINER = null;
  var ERRORS = [];
  var LIMIT = 200;

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
    return h('div', { class: 'admin-errrow__drow' }, [
      h('dt', term),
      h('dd', value || '—'),
    ]);
  }

  // A compact one-line row (card background) that expands inline to full detail.
  function row(e) {
    var copyBtn = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost admin-errrow__copy' }, 'Copy message');
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
        detailRow('Timestamp', fmtDate(e.created_at)),
      ]),
      copyBtn,
    ]);

    // The whole summary line is the toggle (real <button> → keyboard-operable).
    var summary = h('button', {
      type: 'button',
      class: 'admin-errrow__summary',
      'aria-expanded': 'false',
    }, [
      e.error_type
        ? h('span', { class: 'admin-badge admin-badge--error' }, e.error_type)
        : h('span', { class: 'admin-badge admin-badge--role' }, 'error'),
      h('span', { class: 'admin-errrow__tool' }, labelFor(e.tool_id)),
      // One-line snippet; CSS truncates with an ellipsis.
      h('span', { class: 'admin-errrow__snippet' }, e.error_message || '(no message)'),
      h('time', { class: 'admin-errrow__time' }, fmtDate(e.created_at)),
      h('span', { class: 'admin-errrow__chev', 'aria-hidden': 'true' }, '▸'),
    ]);
    summary.addEventListener('click', function () {
      var open = summary.getAttribute('aria-expanded') === 'true';
      summary.setAttribute('aria-expanded', open ? 'false' : 'true');
      detail.hidden = open;
    });

    return h('li', { class: 'admin-errrow' }, [summary, detail]);
  }

  function renderCards(filter) {
    var list = CONTAINER.querySelector('.admin-errlist');
    var countEl = CONTAINER.querySelector('.admin-errcount');
    if (!list) return;
    dom.clear(list);
    var q = (filter || '').trim().toLowerCase();
    var shown = ERRORS.filter(function (e) {
      return matches(e, q);
    });
    if (countEl) countEl.textContent = shown.length + ' of ' + ERRORS.length;
    if (shown.length === 0) {
      list.appendChild(h('li', { class: 'admin-empty' }, 'No matching errors.'));
      return;
    }
    shown.forEach(function (e) {
      list.appendChild(row(e));
    });
  }

  function render(container) {
    CONTAINER = container;
    dom.clear(container);
    container.appendChild(h('div', { class: 'admin-loading' }, 'Loading errors…'));

    api
      .get('/api/v1/stats/errors?limit=' + LIMIT)
      .then(function (data) {
        ERRORS = (data && data.errors) || [];
        dom.clear(container);

        if (ERRORS.length === 0) {
          container.appendChild(
            ADMIN.emptyState({
              icon: 'check',
              title: 'No errors',
              text: 'Nothing has gone wrong recently. Client-side errors reported by the site will show up here.',
            })
          );
          return;
        }

        var search = h('input', {
          type: 'search',
          class: 'admin-input admin-errsearch',
          placeholder: 'Search message, type, tool, browser…',
          'aria-label': 'Search errors',
        });
        search.addEventListener('input', function () {
          renderCards(search.value);
        });
        container.appendChild(
          h('div', { class: 'admin-toolbar' }, [
            search,
            h('span', { class: 'admin-errcount admin-muted' }, ''),
          ])
        );

        container.appendChild(h('ul', { class: 'admin-errlist' }));
        renderCards('');
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        dom.clear(container);
        var retry = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost' }, 'Retry');
        retry.addEventListener('click', function () {
          render(container);
        });
        container.appendChild(
          h('div', { class: 'admin-error-state' }, [h('p', "Couldn't load errors."), retry])
        );
      });
  }

  ADMIN.tabs.errors = { render: render };
})();
