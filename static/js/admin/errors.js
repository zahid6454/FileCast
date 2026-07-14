// Errors tab (#errors) — a dedicated, full-detail view of the client error log.
//
// The dashboard's "Recent errors" widget is a 50-row glance; this tab pulls a
// larger window with client-side search across tool / type / message / browser.
// Like the dashboard feed this is the P23 hot spot: error_type/error_message/
// browser come from the PUBLIC, anonymous POST /errors, so every field is
// rendered via textContent (h()), never markup.
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

  function renderRows(filter) {
    var tbody = CONTAINER.querySelector('.admin-errtable tbody');
    var countEl = CONTAINER.querySelector('.admin-errcount');
    if (!tbody) return;
    dom.clear(tbody);
    var q = (filter || '').trim().toLowerCase();
    var shown = ERRORS.filter(function (e) {
      if (!q) return true;
      return (
        (e.error_message || '').toLowerCase().indexOf(q) >= 0 ||
        (e.error_type || '').toLowerCase().indexOf(q) >= 0 ||
        (e.browser || '').toLowerCase().indexOf(q) >= 0 ||
        (e.tool_id || '').toLowerCase().indexOf(q) >= 0 ||
        labelFor(e.tool_id).toLowerCase().indexOf(q) >= 0
      );
    });
    if (countEl) countEl.textContent = shown.length + ' of ' + ERRORS.length;
    if (shown.length === 0) {
      tbody.appendChild(h('tr', h('td', { colspan: '5', class: 'admin-empty' }, 'No matching errors.')));
      return;
    }
    shown.forEach(function (e) {
      tbody.appendChild(
        h('tr', { class: 'admin-errrow' }, [
          h('td', { class: 'admin-errrow__when' }, fmtDate(e.created_at)),
          h('td', labelFor(e.tool_id)),
          h('td', e.error_type ? h('span', { class: 'admin-badge admin-badge--error' }, e.error_type) : '—'),
          // P23: message is attacker-controlled → textContent via h().
          h('td', h('code', { class: 'admin-errrow__msg' }, e.error_message || '')),
          h('td', { class: 'admin-errrow__browser' }, e.browser || '—'),
        ])
      );
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
          container.appendChild(h('div', { class: 'admin-empty' }, 'No errors 🎉'));
          return;
        }

        var search = h('input', {
          type: 'search',
          class: 'admin-input admin-errsearch',
          placeholder: 'Search message, type, tool, browser…',
          'aria-label': 'Search errors',
        });
        search.addEventListener('input', function () {
          renderRows(search.value);
        });
        container.appendChild(
          h('div', { class: 'admin-toolbar' }, [
            search,
            h('span', { class: 'admin-errcount admin-muted' }, ''),
          ])
        );

        container.appendChild(
          h('div', { class: 'admin-tablewrap' }, [
            h('table', { class: 'admin-table admin-errtable' }, [
              h('thead', h('tr', [
                h('th', 'When'),
                h('th', 'Tool'),
                h('th', 'Type'),
                h('th', 'Message'),
                h('th', 'Browser'),
              ])),
              h('tbody'),
            ]),
          ])
        );
        renderRows('');
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
