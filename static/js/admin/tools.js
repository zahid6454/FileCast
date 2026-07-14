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

  function label(tool) {
    return tool.display_name || tool.name || tool.id;
  }

  var HOMEPAGE_CAP = 4; // tools shown per category on the homepage (home.html)

  // Replicate the homepage's per-category selection (home.html): featured tools
  // (homepage_order asc) first, then the rest in display order, ENABLED only,
  // capped at HOMEPAGE_CAP. Returns which tool ids land on the homepage plus, per
  // category, the length of the contiguous top block (so a divider can sit right
  // after it in the common case; disabled non-homepage tools don't break it).
  function computeHomepage(grouped) {
    var setById = {};
    var cutoffByCat = {};
    grouped.order.forEach(function (cat) {
      var group = grouped.groups[cat]; // display (sort_order) order
      var enabled = group.filter(function (t) {
        return t.enabled;
      });
      var featured = enabled
        .filter(function (t) {
          return t.homepage_order != null;
        })
        .slice()
        .sort(function (a, b) {
          return a.homepage_order - b.homepage_order;
        });
      var rest = enabled.filter(function (t) {
        return t.homepage_order == null;
      });
      var pick = featured.concat(rest).slice(0, HOMEPAGE_CAP);
      pick.forEach(function (t) {
        setById[t.id] = true;
      });
      // Walk the display order: count homepage tools, skip disabled non-homepage
      // rows (they sit above the line, clearly marked), stop at the first ENABLED
      // non-homepage tool.
      var seen = 0;
      var cutoff = 0;
      for (var i = 0; i < group.length && seen < pick.length; i++) {
        var t = group[i];
        if (setById[t.id]) {
          seen++;
          cutoff = i + 1;
        } else if (t.enabled) {
          break;
        }
      }
      cutoffByCat[cat] = cutoff;
    });
    return { setById: setById, cutoffByCat: cutoffByCat };
  }

  function homepageDivider() {
    return h('li', { class: 'admin-tool-divider', 'aria-hidden': 'true' }, [
      h('span', { class: 'admin-tool-divider__label' }, 'Shown on the homepage ↑'),
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
    // Prefer the site's display name (e.g. data-conversion → "Text Conversion");
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
      ' line appear on the homepage (up to four per category); the rest live on the category page. Disabled tools keep their slot. Changes publish on the next rebuild.',
    ]);
    return h('div', { class: 'admin-callout' }, [
      icon ? h('span', { class: 'admin-callout__icon' }, [icon]) : null,
      body,
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

  function buildRow(tool, straggler) {
    var row = h('li', {
      class: 'admin-tool',
      draggable: 'true',
      dataset: { toolId: tool.id, category: tool.category || 'other' },
    });

    var handle = h('span', {
      class: 'admin-tool__handle',
      'aria-hidden': 'true',
      title: 'Drag to reorder',
    }, '≡');

    var up = h('button', {
      type: 'button',
      class: 'admin-tool__up admin-iconbtn',
      'aria-label': 'Move ' + label(tool) + ' up',
    }, '▲');
    var down = h('button', {
      type: 'button',
      class: 'admin-tool__down admin-iconbtn',
      'aria-label': 'Move ' + label(tool) + ' down',
    }, '▼');
    up.addEventListener('click', function () {
      moveRow(row, -1);
    });
    down.addEventListener('click', function () {
      moveRow(row, 1);
    });

    var nameBtn = h('button', {
      type: 'button',
      class: 'admin-tool__name',
    }, label(tool));
    nameBtn.addEventListener('click', function () {
      openSlideout(tool);
    });

    if (!tool.enabled) {
      nameBtn.appendChild(h('span', { class: 'admin-tool__off' }, 'disabled'));
    }

    var toggle = h('button', {
      type: 'button',
      role: 'switch',
      class: 'admin-switch',
      'aria-checked': tool.enabled ? 'true' : 'false',
      'aria-label': 'Enable ' + label(tool),
    }, [h('span', { class: 'admin-switch__thumb', 'aria-hidden': 'true' })]);
    toggle.addEventListener('click', function () {
      toggleTool(tool, toggle, nameBtn);
    });

    // A homepage tool that isn't in the contiguous top block (e.g. curated via
    // homepage_order, or a top tool was disabled) gets an explicit badge so the
    // divider line never misrepresents it.
    var homeBadge = straggler
      ? h('span', { class: 'admin-tool__home', title: 'Shown on the homepage' }, [
          ADMIN.icon ? ADMIN.icon('home', 12) : null,
          h('span', 'Homepage'),
        ])
      : null;

    dom.append(row, [
      handle,
      h('span', { class: 'admin-tool__moves' }, [up, down]),
      nameBtn,
      homeBadge,
      h('span', { class: 'admin-tool__spacer' }),
      toggle,
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
      if (dragEl.dataset.category !== row.dataset.category) return; // same category only
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      clearDropTargets();
      row.classList.add('admin-tool--dragover');
    });
    row.addEventListener('dragleave', function () {
      row.classList.remove('admin-tool--dragover');
    });
    row.addEventListener('drop', function (e) {
      if (!dragEl || dragEl === row) return;
      if (dragEl.dataset.category !== row.dataset.category) return;
      e.preventDefault();
      var section = row.closest('.admin-toollist');
      var rect = row.getBoundingClientRect();
      var after = e.clientY > rect.top + rect.height / 2;
      section.insertBefore(dragEl, after ? row.nextElementSibling : row);
      clearDropTargets();
      refreshMoveButtons(section);
      persistOrder();
    });
  }

  function clearDropTargets() {
    if (!CONTAINER) return;
    CONTAINER.querySelectorAll('.admin-tool--dragover').forEach(function (el) {
      el.classList.remove('admin-tool--dragover');
    });
  }

  // --- toggle -------------------------------------------------------------

  function toggleTool(tool, toggle, nameBtn) {
    var next = toggle.getAttribute('aria-checked') !== 'true';
    // optimistic
    toggle.setAttribute('aria-checked', next ? 'true' : 'false');
    setDisabledBadge(nameBtn, !next);
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

    var nameInput = h('input', { type: 'text', id: 'so-name', class: 'admin-input', value: tool.display_name || '' });
    var enabledInput = h('input', { type: 'checkbox', id: 'so-enabled' });
    if (tool.enabled) enabledInput.checked = true;
    var maintInput = h('textarea', { id: 'so-maint', class: 'admin-input', rows: '3' });
    maintInput.value = tool.maintenance_message || '';
    var sizeInput = h('input', { type: 'text', id: 'so-size', class: 'admin-input', value: tool.custom_max_file_size || '', placeholder: 'e.g. 50MB' });

    var closeBtn = h('button', { type: 'button', class: 'admin-iconbtn admin-slideout__close', 'aria-label': 'Close' }, '✕');
    closeBtn.addEventListener('click', closeSlideout);

    var saveBtn = h('button', { type: 'button', class: 'admin-btn admin-btn--primary' }, 'Save changes');
    saveBtn.addEventListener('click', function () {
      saveSlideout(tool, {
        display_name: nameInput.value,
        enabled: enabledInput.checked,
        maintenance_message: maintInput.value,
        custom_max_file_size: sizeInput.value,
      });
    });

    var panel = h('aside', { class: 'admin-slideout', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Edit ' + label(tool) }, [
      h('div', { class: 'admin-slideout__head' }, [
        h('h2', { class: 'admin-slideout__title' }, label(tool)),
        closeBtn,
      ]),
      h('div', { class: 'admin-slideout__body' }, [
        field('Display name', nameInput),
        h('label', { class: 'admin-check' }, [enabledInput, h('span', 'Enabled')]),
        field('Maintenance message', maintInput),
        field('Override max file size', sizeInput),
        h('p', { class: 'admin-slideout__meta' }, tool.category ? 'Category: ' + tool.category : ''),
      ]),
      h('div', { class: 'admin-slideout__foot' }, [saveBtn]),
    ]);

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
      control,
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
    if (values.maintenance_message !== (tool.maintenance_message || '')) patch.maintenance_message = values.maintenance_message;
    if (values.custom_max_file_size !== (tool.custom_max_file_size || '')) patch.custom_max_file_size = values.custom_max_file_size;

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

        if (tools.length === 0) {
          container.appendChild(h('div', { class: 'admin-empty' }, 'No tools found.'));
          return;
        }

        var grouped = groupByCategory(tools);
        var hp = computeHomepage(grouped);
        var wrap = h('div', { class: 'admin-tools' });
        wrap.appendChild(buildCallout());
        grouped.order.forEach(function (cat) {
          var list = h('ul', { class: 'admin-toollist', dataset: { category: cat } });
          var group = grouped.groups[cat];
          var cutoff = hp.cutoffByCat[cat] || 0;
          group.forEach(function (tool, i) {
            var straggler = !!hp.setById[tool.id] && i >= cutoff;
            list.appendChild(buildRow(tool, straggler));
            // Labeled divider right after the contiguous homepage block.
            if (cutoff > 0 && i === cutoff - 1 && cutoff < group.length) {
              list.appendChild(homepageDivider());
            }
          });
          wrap.appendChild(
            h('section', { class: 'admin-toolgroup' }, [
              h('h2', { class: 'admin-toolgroup__title' }, catTitle(cat)),
              list,
            ])
          );
          refreshMoveButtons(list);
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
