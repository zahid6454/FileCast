// Tools tab (#tools) — Phase 4 §8.2.
//
// Groups the boot catalog by category (incl. disabled tools — C1), toggles
// enable/disable, reorders via native HTML5 drag-and-drop AND keyboard
// move-up/down buttons (WCAG 2.1.1 — R16), and edits a tool in a slide-out.
// Reorder is category-constrained but always sends the FULL global order in ONE
// PUT /tools/reorder (C2/R6). Every mutation is optimistic and reverts on a
// failed write (R17); each success → save toast + deploy flow (§7).
(function () {
  'use strict';
  var ADMIN = (window.ADMIN = window.ADMIN || {});
  ADMIN.tabs = ADMIN.tabs || {};
  var dom = ADMIN.dom;
  var api = ADMIN.api;
  var h = dom.h;

  var CONTAINER = null; // active tab container (for re-render on revert)

  // --- Sync Tools (Admin-Tool-Sync-Plan.md D7) -----------------------------
  //
  // Lives here, not in app.js's Publish banner: Publish ships unsaved edits
  // made in this admin session, while Sync Tools pulls in tools that arrived
  // through a separate git merge — a different trigger and mental model, so
  // it gets its own control next to the list it affects. Wired the same way
  // app.js drives Publish (dispatch → poll to a terminal conclusion), just
  // scoped to this tab's own button instead of the app-shell banner.
  var seedInFlight = false;
  var SEED_POLL_INTERVAL_MS = 3000;
  var SEED_POLL_MAX_ERRORS = 3;

  function buildSyncButton() {
    var btn = h(
      'button',
      {
        type: 'button',
        class: 'admin-btn admin-btn--secondary admin-btn--sm',
        disabled: seedInFlight ? true : null
      },
      seedInFlight ? 'Syncing…' : 'Sync Tools'
    );
    btn.addEventListener('click', function () {
      if (!seedInFlight) fireSeed(btn);
    });
    return btn;
  }

  function resetSyncButton(btn) {
    seedInFlight = false;
    btn.disabled = false;
    btn.textContent = 'Sync Tools';
  }

  function fireSeed(btn) {
    seedInFlight = true;
    btn.disabled = true;
    btn.textContent = 'Syncing…';
    api
      .post('/api/v1/admin/seed-tools', {})
      .then(function (res) {
        if (res && res.notImplemented) {
          resetSyncButton(btn);
          ADMIN.toast('Sync Tools is not configured yet.', 'info');
          return;
        }
        if (res && res.run_id) {
          pollSeed(res.run_id, btn);
        } else {
          resetSyncButton(btn);
        }
      })
      .catch(function (err) {
        resetSyncButton(btn);
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        ADMIN.toast('Sync could not start.', 'error');
      });
  }

  // Poll the seed run to a terminal state. Same conclusion-not-status contract
  // as app.js's pollDeploy: GitHub's `status` reaching 'completed' covers
  // failure/cancelled too, so only `conclusion === 'success'` means the sync
  // actually ran. A poll error retries a bounded number of times before
  // giving up, for the same reason app.js bounds it — an invalid run_id 502s
  // on every attempt, so unbounded retry would poll forever.
  function pollSeed(runId, btn, errors) {
    var failures = errors || 0;
    api
      .get('/api/v1/admin/seed-tools/' + encodeURIComponent(runId))
      .then(function (res) {
        if (res && res.notImplemented) {
          resetSyncButton(btn);
          return;
        }
        if (res && res.status === 'completed') {
          resetSyncButton(btn);
          if (res.conclusion === 'success') {
            ADMIN.toast('Tools synced', 'success');
            refreshAfterSync();
            // seed.py wrote straight to Postgres — the static site won't
            // reflect it until the next rebuild, same as any other tool
            // mutation, so raise the same Publish banner they do.
            if (ADMIN.notifySaved) ADMIN.notifySaved({ silent: true });
          } else {
            ADMIN.toast('Sync failed', 'error');
          }
          return;
        }
        setTimeout(function () {
          pollSeed(runId, btn, 0);
        }, SEED_POLL_INTERVAL_MS);
      })
      .catch(function () {
        if (failures + 1 >= SEED_POLL_MAX_ERRORS) {
          resetSyncButton(btn);
          return;
        }
        setTimeout(function () {
          pollSeed(runId, btn, failures + 1);
        }, SEED_POLL_INTERVAL_MS);
      });
  }

  // A sync can take long enough (checkout + deps + seed.py against Postgres)
  // that the admin may have navigated to a different tab before it resolves.
  // CONTAINER is app.js's single shared <main> — EVERY tab renders into that
  // same node (app.js:route()) — so a bare render(CONTAINER) here would blow
  // away whatever tab the admin is now looking at (and any unsaved input in
  // it) the moment this sync happens to finish. Only re-render in place when
  // the Tools tab is still what's showing (its render() always leaves an
  // '.admin-tools' wrapper, populated or empty); otherwise just refresh the
  // shared catalog quietly so the next real visit to Tools is current.
  function refreshAfterSync() {
    if (CONTAINER && CONTAINER.querySelector('.admin-tools')) {
      render(CONTAINER);
      return;
    }
    api.get('/api/v1/tools').then(function (data) {
      if (ADMIN.catalog) ADMIN.catalog.rebuild((data && data.tools) || []);
    });
  }

  function label(tool) {
    return tool.display_name || tool.name || tool.id;
  }

  var HOMEPAGE_CAP = 4; // tools shown per category on the homepage (home.html)

  function isEnabled(row) {
    var sw = row.querySelector('.admin-switch');
    return !!sw && sw.getAttribute('aria-checked') === 'true';
  }

  // Place the "Shown on the homepage" divider from the CURRENT DOM order, so it
  // stays correct live after every reorder/toggle (not just at load). Mirrors
  // home.html exactly: the first HOMEPAGE_CAP ENABLED tools of a category, in
  // sort_order, land on the homepage; the divider sits right after the last of
  // them. Disabled tools keep their slot but don't count toward the cap, so one
  // between homepage tools stays above the line while trailing ones fall below.
  function refreshDivider(section) {
    var rows = Array.prototype.slice.call(section.querySelectorAll('.admin-tool'));
    var seen = 0;
    var cutoff = 0; // number of rows that sit above the divider
    for (var i = 0; i < rows.length && seen < HOMEPAGE_CAP; i++) {
      if (isEnabled(rows[i])) {
        seen++;
        cutoff = i + 1;
      }
    }
    var existing = section.querySelector('.admin-tool-divider');
    if (existing) existing.remove();
    // Only draw it when a tool actually sits below the line.
    if (cutoff > 0 && cutoff < rows.length) {
      var anchor = rows[cutoff - 1];
      anchor.parentNode.insertBefore(homepageDivider(), anchor.nextSibling);
    }
  }

  function homepageDivider() {
    return h('li', { class: 'admin-tool-divider', 'aria-hidden': 'true' }, [
      h('span', { class: 'admin-tool-divider__label' }, 'Shown on the homepage ↑')
    ]);
  }

  // Group a sort_order-ordered list into { category: [tools] }, preserving
  // first-appearance category order as the canonical walk (R6).
  function groupByCategory(tools) {
    var order = [];
    var groups = {};
    tools.forEach(function (t) {
      var cat = t.category || 'other';
      if (!groups[cat]) {
        groups[cat] = [];
        order.push(cat);
      }
      groups[cat].push(t);
    });
    return { order: order, groups: groups };
  }

  function catTitle(cat) {
    // Prefer the site's display name (e.g. developer-tools → "Developer Tools");
    // fall back to a humanized slug for any category not in the map.
    var names = (window.FILECAST && window.FILECAST.categories) || {};
    if (names[cat]) return names[cat];
    return cat.charAt(0).toUpperCase() + cat.slice(1).replace(/-/g, ' ');
  }

  // Explains how the toggle + ordering map to what visitors actually see, so the
  // tab isn't ambiguous about its effect on the live site.
  function buildCallout() {
    var icon = ADMIN.icon ? ADMIN.icon('info', 20) : null;
    var body = h('div', { class: 'admin-callout__body' }, [
      h('strong', 'Toggle'),
      ' shows or hides a tool across the whole site. ',
      h('strong', 'Drag ≡ or use ▲ ▼'),
      ' to set the order within a category. Tools above the ',
      h('strong', '“Shown on the homepage”'),
      ' line appear on the homepage (up to four per category); the rest live on the category page. Disabled tools keep their slot. Changes save immediately — click ',
      h('strong', 'Publish'),
      ' in the banner above to make them live.'
    ]);
    return h('div', { class: 'admin-callout' }, [
      icon ? h('span', { class: 'admin-callout__icon' }, [icon]) : null,
      body
    ]);
  }

  // Read the current DOM row order (top-to-bottom = global order) as an id array.
  function currentOrder() {
    var rows = CONTAINER.querySelectorAll('.admin-tool');
    return Array.prototype.map.call(rows, function (row) {
      return row.dataset.toolId;
    });
  }

  // Persist the current global order. Optimistic: DOM already moved; revert by
  // re-rendering from the server on failure.
  function persistOrder() {
    var order = currentOrder();
    api
      .put('/api/v1/tools/reorder', { order: order })
      .then(function () {
        ADMIN.notifySaved();
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        ADMIN.toast('Reorder failed — reverting', 'error');
        render(CONTAINER);
      });
  }

  function refreshMoveButtons(section) {
    var rows = section.querySelectorAll('.admin-tool');
    rows.forEach(function (row, i) {
      var up = row.querySelector('.admin-tool__up');
      var down = row.querySelector('.admin-tool__down');
      if (up) up.disabled = i === 0;
      if (down) down.disabled = i === rows.length - 1;
    });
  }

  // --- rows ---------------------------------------------------------------

  function buildRow(tool) {
    var row = h('li', {
      class: 'admin-tool',
      draggable: 'true',
      dataset: { toolId: tool.id, category: tool.category || 'other' }
    });

    var handle = h(
      'span',
      {
        class: 'admin-tool__handle',
        'aria-hidden': 'true',
        title: 'Drag to reorder'
      },
      '≡'
    );

    var up = h(
      'button',
      {
        type: 'button',
        class: 'admin-tool__up admin-iconbtn',
        'aria-label': 'Move ' + label(tool) + ' up'
      },
      '▲'
    );
    var down = h(
      'button',
      {
        type: 'button',
        class: 'admin-tool__down admin-iconbtn',
        'aria-label': 'Move ' + label(tool) + ' down'
      },
      '▼'
    );
    up.addEventListener('click', function () {
      moveRow(row, -1);
    });
    down.addEventListener('click', function () {
      moveRow(row, 1);
    });

    var nameBtn = h(
      'button',
      {
        type: 'button',
        class: 'admin-tool__name'
      },
      label(tool)
    );
    nameBtn.addEventListener('click', function () {
      openSlideout(tool);
    });

    if (!tool.enabled) {
      nameBtn.appendChild(h('span', { class: 'admin-tool__off' }, 'disabled'));
    }

    var toggle = h(
      'button',
      {
        type: 'button',
        role: 'switch',
        class: 'admin-switch',
        'aria-checked': tool.enabled ? 'true' : 'false',
        'aria-label': 'Enable ' + label(tool)
      },
      [h('span', { class: 'admin-switch__thumb', 'aria-hidden': 'true' })]
    );
    toggle.addEventListener('click', function () {
      toggleTool(tool, toggle, nameBtn);
    });

    dom.append(row, [
      handle,
      h('span', { class: 'admin-tool__moves' }, [up, down]),
      nameBtn,
      h('span', { class: 'admin-tool__spacer' }),
      toggle
    ]);

    bindDrag(row);
    return row;
  }

  // The nearest tool row in a direction, skipping non-tool siblings (the
  // homepage divider), so reordering ignores the divider entirely.
  function adjacentTool(row, dir) {
    var el = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
    while (el && !el.classList.contains('admin-tool')) {
      el = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
    }
    return el;
  }

  function moveRow(row, dir) {
    var sibling = adjacentTool(row, dir);
    if (!sibling) return;
    var section = row.closest('.admin-toollist');
    if (dir < 0) {
      section.insertBefore(row, sibling);
    } else {
      section.insertBefore(sibling, row);
    }
    refreshMoveButtons(section);
    refreshDivider(section);
    // Keep focus on the row we just moved. The button we pressed may now be
    // disabled (row landed at a category boundary) — a disabled button can't
    // hold focus and it would fall to <body>, so fall back to the opposite,
    // still-enabled move button.
    var up = row.querySelector('.admin-tool__up');
    var down = row.querySelector('.admin-tool__down');
    var target = dir < 0 ? up : down;
    if (target && target.disabled) target = dir < 0 ? down : up;
    if (target && !target.disabled) target.focus();
    persistOrder();
  }

  // --- native drag-and-drop (category-constrained) ------------------------

  var dragEl = null;

  function bindDrag(row) {
    row.addEventListener('dragstart', function (e) {
      dragEl = row;
      row.classList.add('admin-tool--dragging');
      // Highlight the category you can drop within — reordering is
      // category-constrained (a tool's category comes from its config, not here).
      var group = row.closest('.admin-toolgroup');
      if (group) group.classList.add('admin-toolgroup--dropzone');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        // Some browsers require data to be set for the drag to initiate.
        e.dataTransfer.setData('text/plain', row.dataset.toolId);
      }
    });
    row.addEventListener('dragend', function () {
      row.classList.remove('admin-tool--dragging');
      clearDropTargets();
      dragEl = null;
    });
    row.addEventListener('dragover', function (e) {
      if (!dragEl || dragEl === row) return;
      // preventDefault everywhere so the drop fires and we can respond (either a
      // same-category reorder or a clear cross-category "not allowed" hint).
      e.preventDefault();
      var same = dragEl.dataset.category === row.dataset.category;
      if (e.dataTransfer) e.dataTransfer.dropEffect = same ? 'move' : 'none';
      clearDropTargets();
      row.classList.add(same ? 'admin-tool--dragover' : 'admin-tool--nodrop');
    });
    row.addEventListener('dragleave', function () {
      row.classList.remove('admin-tool--dragover');
      row.classList.remove('admin-tool--nodrop');
    });
    row.addEventListener('drop', function (e) {
      if (!dragEl || dragEl === row) return;
      e.preventDefault();
      if (dragEl.dataset.category !== row.dataset.category) {
        // Cross-category drops aren't possible — say so instead of doing nothing.
        clearDropTargets();
        ADMIN.toast('Tools can only be reordered within their own category', 'info');
        return;
      }
      var section = row.closest('.admin-toollist');
      var rect = row.getBoundingClientRect();
      var after = e.clientY > rect.top + rect.height / 2;
      section.insertBefore(dragEl, after ? row.nextElementSibling : row);
      clearDropTargets();
      refreshMoveButtons(section);
      refreshDivider(section);
      persistOrder();
    });
  }

  function clearDropTargets() {
    if (!CONTAINER) return;
    CONTAINER.querySelectorAll('.admin-tool--dragover, .admin-tool--nodrop').forEach(function (el) {
      el.classList.remove('admin-tool--dragover');
      el.classList.remove('admin-tool--nodrop');
    });
    CONTAINER.querySelectorAll('.admin-toolgroup--dropzone').forEach(function (el) {
      el.classList.remove('admin-toolgroup--dropzone');
    });
  }

  // --- toggle -------------------------------------------------------------

  function toggleTool(tool, toggle, nameBtn) {
    var next = toggle.getAttribute('aria-checked') !== 'true';
    var section = toggle.closest('.admin-toollist');
    // optimistic
    toggle.setAttribute('aria-checked', next ? 'true' : 'false');
    setDisabledBadge(nameBtn, !next);
    if (section) refreshDivider(section); // membership changed → move the line
    api
      .put('/api/v1/tools/' + encodeURIComponent(tool.id), { enabled: next })
      .then(function (res) {
        tool.enabled = next;
        if (ADMIN.catalog) ADMIN.catalog.patch(tool.id, { enabled: next });
        ADMIN.notifySaved();
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        // revert
        toggle.setAttribute('aria-checked', next ? 'false' : 'true');
        setDisabledBadge(nameBtn, next);
        if (section) refreshDivider(section);
        ADMIN.toast('Could not update — reverted', 'error');
      });
  }

  function setDisabledBadge(nameBtn, disabled) {
    var badge = nameBtn.querySelector('.admin-tool__off');
    if (disabled && !badge) {
      nameBtn.appendChild(h('span', { class: 'admin-tool__off' }, 'disabled'));
    } else if (!disabled && badge) {
      badge.remove();
    }
  }

  // --- slide-out edit -----------------------------------------------------

  var slideoutOpener = null; // element to restore focus to on close
  var slideoutKeydown = null; // Escape handler, bound while open

  function openSlideout(tool) {
    closeSlideout();
    slideoutOpener = document.activeElement; // the tool-name button that opened us
    var overlay = h('div', { class: 'admin-overlay' });
    overlay.addEventListener('click', closeSlideout);

    var nameInput = h('input', {
      type: 'text',
      id: 'so-name',
      class: 'admin-input',
      value: tool.display_name || ''
    });
    var enabledInput = h('input', { type: 'checkbox', id: 'so-enabled' });
    if (tool.enabled) enabledInput.checked = true;
    var maintInput = h('textarea', { id: 'so-maint', class: 'admin-input', rows: '3' });
    maintInput.value = tool.maintenance_message || '';
    var sizeInput = h('input', {
      type: 'text',
      id: 'so-size',
      class: 'admin-input',
      value: tool.custom_max_file_size || '',
      placeholder: 'e.g. 50MB'
    });

    var closeBtn = h(
      'button',
      { type: 'button', class: 'admin-iconbtn admin-slideout__close', 'aria-label': 'Close' },
      '✕'
    );
    closeBtn.addEventListener('click', closeSlideout);

    var saveBtn = h(
      'button',
      { type: 'button', class: 'admin-btn admin-btn--primary' },
      'Save changes'
    );
    saveBtn.addEventListener('click', function () {
      saveSlideout(tool, {
        display_name: nameInput.value,
        enabled: enabledInput.checked,
        maintenance_message: maintInput.value,
        custom_max_file_size: sizeInput.value
      });
    });

    var panel = h(
      'aside',
      {
        class: 'admin-slideout',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Edit ' + label(tool)
      },
      [
        h('div', { class: 'admin-slideout__head' }, [
          h('h2', { class: 'admin-slideout__title' }, label(tool)),
          closeBtn
        ]),
        h('div', { class: 'admin-slideout__body' }, [
          field('Display name', nameInput),
          h('label', { class: 'admin-check' }, [enabledInput, h('span', 'Enabled')]),
          field('Maintenance message', maintInput),
          field('Override max file size', sizeInput),
          h(
            'p',
            { class: 'admin-slideout__meta' },
            tool.category ? 'Category: ' + tool.category : ''
          )
        ]),
        h('div', { class: 'admin-slideout__foot' }, [saveBtn])
      ]
    );

    document.body.appendChild(overlay);
    document.body.appendChild(panel);

    // Real-modal semantics for keyboard/AT users: make the background inert so
    // Tab can't reach the tab nav / tool rows behind the overlay, and wire
    // Escape-to-close. The slide-out + overlay live on <body>, outside #admin-app.
    var appRoot = document.getElementById('admin-app');
    if (appRoot) appRoot.inert = true;
    slideoutKeydown = function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSlideout();
      }
    };
    document.addEventListener('keydown', slideoutKeydown);

    // next frame → slide in
    requestAnimationFrame(function () {
      overlay.classList.add('is-open');
      panel.classList.add('is-open');
    });
    nameInput.focus();
  }

  function field(labelText, control) {
    return h('label', { class: 'admin-field' }, [
      h('span', { class: 'admin-field__label' }, labelText),
      control
    ]);
  }

  function closeSlideout() {
    document.querySelectorAll('.admin-slideout, .admin-overlay').forEach(function (el) {
      el.remove();
    });
    if (slideoutKeydown) {
      document.removeEventListener('keydown', slideoutKeydown);
      slideoutKeydown = null;
    }
    var appRoot = document.getElementById('admin-app');
    if (appRoot) appRoot.inert = false;
    // Restore focus to the control that opened the dialog (if it still exists).
    if (slideoutOpener && document.contains(slideoutOpener)) {
      slideoutOpener.focus();
    }
    slideoutOpener = null;
  }

  function saveSlideout(tool, values) {
    // Only send changed fields.
    var patch = {};
    if (values.display_name !== (tool.display_name || '')) patch.display_name = values.display_name;
    if (values.enabled !== tool.enabled) patch.enabled = values.enabled;
    if (values.maintenance_message !== (tool.maintenance_message || ''))
      patch.maintenance_message = values.maintenance_message;
    if (values.custom_max_file_size !== (tool.custom_max_file_size || ''))
      patch.custom_max_file_size = values.custom_max_file_size;

    if (Object.keys(patch).length === 0) {
      closeSlideout();
      return;
    }
    api
      .put('/api/v1/tools/' + encodeURIComponent(tool.id), patch)
      .then(function (res) {
        var updated = (res && res.tool) || Object.assign({}, tool, patch);
        if (ADMIN.catalog) ADMIN.catalog.patch(tool.id, updated);
        closeSlideout();
        ADMIN.notifySaved();
        render(CONTAINER); // reflect new label/state
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        ADMIN.toast('Save failed', 'error');
      });
  }

  // --- render -------------------------------------------------------------

  function render(container) {
    CONTAINER = container;
    dom.clear(container);
    container.appendChild(h('div', { class: 'admin-loading' }, 'Loading tools…'));

    api
      .get('/api/v1/tools')
      .then(function (data) {
        var tools = (data && data.tools) || [];
        if (ADMIN.catalog) ADMIN.catalog.rebuild(tools);
        dom.clear(container);

        // The actions row (Sync Tools) renders even with zero tools — an
        // empty table is exactly the state that most needs a sync, e.g. a
        // fresh production deploy that hasn't been seeded yet.
        var wrap = h('div', { class: 'admin-tools' });
        wrap.appendChild(h('div', { class: 'admin-tools-actions' }, [buildSyncButton()]));

        if (tools.length === 0) {
          wrap.appendChild(h('div', { class: 'admin-empty' }, 'No tools found.'));
          container.appendChild(wrap);
          return;
        }

        wrap.appendChild(buildCallout());
        var grouped = groupByCategory(tools);
        grouped.order.forEach(function (cat) {
          var list = h('ul', { class: 'admin-toollist', dataset: { category: cat } });
          grouped.groups[cat].forEach(function (tool) {
            list.appendChild(buildRow(tool));
          });
          wrap.appendChild(
            h('section', { class: 'admin-toolgroup' }, [
              h('h2', { class: 'admin-toolgroup__title' }, catTitle(cat)),
              list
            ])
          );
          refreshMoveButtons(list);
          refreshDivider(list); // draw the homepage line from the rendered order
        });
        container.appendChild(wrap);
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        dom.clear(container);
        var retry = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost' }, 'Retry');
        retry.addEventListener('click', function () {
          render(container);
        });
        container.appendChild(
          h('div', { class: 'admin-error-state' }, [h('p', "Couldn't load tools."), retry])
        );
      });
  }

  ADMIN.tabs.tools = { render: render };
})();
