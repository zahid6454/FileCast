(function () {
  'use strict';

  // Shared "page grid" component (Tool Preview/Interaction Redesign §1) — one
  // thumbnail grid, five modes: click-to-mark (Remove/Extract),
  // drag/keyboard-to-reorder (Organize), a read-only confirmation strip
  // (Split's "preview" mode — "every page" v1 default, plus a v2 "at marked
  // points" sub-mode), and a read-only strip that also live-previews a
  // whole-document rotation (Rotate v1, reacting to the tool's own
  // #opt-rotation select). Each mode's converter file calls
  // window.FCPageGrid.init({ mode, onChange }) at load time; this module owns
  // everything else — DOM, the render Worker, selection state.
  //
  // shared.js (loaded before this file) never exposes a "file was just
  // selected" hook to converters — same note as image-cropper.js/
  // image-rotate-flip.js — so this file wires its own #file-input listener
  // directly, independent of shared.js's own state machine. window.convertFile
  // is untouched by this file: each converter keeps reading the same hidden
  // #opt-pages/#opt-order text input it always has, this component just keeps
  // that input's value in sync with the grid selection (visible, read-only,
  // for Remove/Extract/Organize — Split's onChange receives groups directly
  // instead, since it has no text input of its own).

  var THUMB_CSS_WIDTH = 120; // display width, in CSS px, requested from the render worker
  var MAX_DPR = 2; // cap devicePixelRatio scaling so a 3x/4x phone doesn't over-render

  var container = null;
  var statusEl = null;
  var listEl = null;
  var loadingEl = null;
  var optionsRowEl = null; // #tool-options — stays visible for every mode; see setOptionsInputReadOnly

  var opts = null; // { mode: 'remove'|'extract'|'organize', onChange: fn(spec) }
  var session = null; // rebuilt on every file pick; null before any pick / after fallback
  var hintEl = null;
  var splitModeButtons = null; // { every: <button>, marked: <button> } — 'preview' mode only

  function q(id) {
    return document.getElementById(id);
  }

  function getExt(name) {
    var m = /\.[^.]+$/.exec(name || '');
    return m ? m[0].toLowerCase() : '';
  }

  function announce(text) {
    var status = q('a11y-status');
    if (status) status.textContent = text;
  }

  // ---------------------------------------------------------------------
  // DOM setup — inserted right after #file-info, the same anchor point
  // image-cropper.js/image-rotate-flip.js use.
  // ---------------------------------------------------------------------
  function ensureUI() {
    if (container) return;
    var fileInfo = q('file-info');
    if (!fileInfo || !fileInfo.parentNode) return;

    container = document.createElement('div');
    container.className = 'page-grid hidden';
    container.id = 'page-grid';

    loadingEl = document.createElement('div');
    loadingEl.className = 'page-grid__loading';
    loadingEl.textContent = 'Loading pages…';

    statusEl = document.createElement('div');
    statusEl.className = 'page-grid__status hidden';
    statusEl.setAttribute('aria-hidden', 'true'); // visible text only — announcements go through #a11y-status

    listEl = document.createElement('div');
    listEl.className = 'page-grid__list hidden';
    listEl.setAttribute('role', opts.mode === 'organize' ? 'listbox' : 'group');

    hintEl = document.createElement('div');
    hintEl.className = 'page-grid__hint';
    hintEl.textContent = hintText();

    container.appendChild(loadingEl);
    container.appendChild(statusEl);
    container.appendChild(listEl);
    if (opts.mode === 'preview') {
      container.appendChild(buildSplitModeRow());
    }
    container.appendChild(hintEl);
    fileInfo.parentNode.insertBefore(container, fileInfo.nextSibling);

    optionsRowEl = q('tool-options');
  }

  // Split's read-only 'preview' mode has two sub-modes: "every page" (the
  // long-standing v1 default) and "at marked points" (v2 — click between
  // pages to mark a cut, grouped ranges become separate files). Rendered
  // once, next to the hint text, and never rebuilt — see switchSplitSubMode().
  function buildSplitModeRow() {
    var row = document.createElement('div');
    row.className = 'page-grid__split-modes';

    var everyBtn = document.createElement('button');
    everyBtn.type = 'button';
    everyBtn.className = 'page-grid__split-mode-btn is-active';
    everyBtn.textContent = 'Every page';
    everyBtn.setAttribute('aria-pressed', 'true');
    everyBtn.addEventListener('click', function () {
      switchSplitSubMode('every');
    });

    var markedBtn = document.createElement('button');
    markedBtn.type = 'button';
    markedBtn.className = 'page-grid__split-mode-btn';
    markedBtn.textContent = 'At marked points';
    markedBtn.setAttribute('aria-pressed', 'false');
    markedBtn.addEventListener('click', function () {
      switchSplitSubMode('marked');
    });

    row.appendChild(everyBtn);
    row.appendChild(markedBtn);
    splitModeButtons = { every: everyBtn, marked: markedBtn };
    return row;
  }

  function hintText() {
    if (opts.mode === 'organize') {
      return 'Drag a page to reorder it, or focus a page and use the arrow keys.';
    }
    if (opts.mode === 'extract') {
      return 'Click a page to select it for extraction.';
    }
    if (opts.mode === 'preview') {
      return session && session.splitSubMode === 'marked'
        ? 'Click the marker between two pages to cut there.'
        : 'Every page becomes its own PDF.';
    }
    if (opts.mode === 'rotate') {
      return 'Preview of how every page will look after rotating.';
    }
    return 'Click a page to mark it for removal.';
  }

  function updateHintText() {
    if (hintEl) hintEl.textContent = hintText();
  }

  // ---------------------------------------------------------------------
  // File selection -> load into the render worker
  // ---------------------------------------------------------------------
  // Tracks the most recently picked file so a slower-loading document from an
  // earlier pick can't win a race against a faster one picked right after it
  // — same pattern image-cropper.js uses for its own async image decode.
  var pendingFile = null;

  // shared.js enables the Convert button synchronously, in its own 'change'
  // listener on this same #file-input — a race otherwise: pdf.js parsing the
  // newly-picked file (buildGrid(), below) is async, so without this, the
  // grid-driven spec (Remove/Extract/Organize's mirrored input, or Split's
  // currentGroups) would keep reflecting the PREVIOUS file until that parse
  // finishes. A visitor who marks a selection, picks a different PDF, and
  // clicks Convert inside that window would silently apply the old file's
  // spec/groups to the new one. Resetting here runs in the same synchronous
  // 'change' dispatch as shared.js's own listener, so no click can land in
  // between — the actual grid (once it loads) overwrites this again anyway.
  function resetGridDrivenStateForNewPick() {
    if (opts.mode === 'preview') {
      if (typeof opts.onChange === 'function') opts.onChange(null);
      return;
    }
    if (opts.mode === 'remove' || opts.mode === 'extract' || opts.mode === 'organize') {
      var row = q('tool-options');
      var input = row && row.querySelector('.tool-options__input');
      if (input) input.value = '';
    }
  }

  function onFilePicked(file) {
    resetGridDrivenStateForNewPick();
    if (!file || getExt(file.name) !== '.pdf') {
      teardownSession();
      return;
    }
    var config = window.TOOL_CONFIG || {};
    if (!config.pdf_src || !config.pdf_render_worker_src) {
      // Preview unavailable (e.g. a build without the pdf.js assets wired up)
      // — fall back silently to the plain text box, same posture
      // image-cropper.js takes when its own markup anchor is missing.
      teardownSession();
      return;
    }

    ensureUI();
    if (!container) return; // page markup has no #file-info — nothing to attach to

    pendingFile = file;
    teardownWorker();
    showLoading();

    var worker = new Worker(
      config.pdf_render_worker_src +
        '?lib=' +
        encodeURIComponent(config.pdf_src) +
        (config.pdf_worker_src ? '&workerLib=' + encodeURIComponent(config.pdf_worker_src) : '')
    );

    session = {
      file: file,
      worker: worker,
      pageCount: 0,
      order: [], // organize mode: current display order, as original 0-based indices
      marked: new Set(), // remove/extract modes: original 0-based indices toggled on
      tileEls: [], // indexed by original 0-based page index
      observer: null,
      requestSeq: 0,
      dragOrigIdx: null
    };

    worker.onmessage = function (e) {
      if (pendingFile !== file) return; // superseded by a later pick
      onWorkerMessage(e.data || {});
    };
    worker.onerror = function () {
      if (pendingFile !== file) return;
      teardownSession();
    };

    file.arrayBuffer().then(
      function (bytes) {
        if (pendingFile !== file) return;
        worker.postMessage({ op: 'load', file: bytes }, [bytes]);
      },
      function () {
        teardownSession();
      }
    );
  }

  function onWorkerMessage(data) {
    if (data.type === 'loaded') {
      if (!data.ok) {
        teardownSession();
        return;
      }
      buildGrid(data.pageCount);
      return;
    }
    if (data.type === 'rendered') {
      if (!data.ok || !session) return;
      var tile = session.tileEls[data.pageIndex];
      if (tile) paintTile(tile, data.bitmap);
    }
  }

  // ---------------------------------------------------------------------
  // Grid construction
  // ---------------------------------------------------------------------
  function buildGrid(pageCount) {
    session.pageCount = pageCount;
    session.order = [];
    for (var i = 0; i < pageCount; i++) session.order.push(i);
    session.marked = new Set();
    session.cutPoints = new Set(); // 'preview' mode, "at marked points" sub-mode only
    session.splitSubMode = 'every';

    listEl.innerHTML = '';
    session.tileEls = new Array(pageCount);
    session.observer = new IntersectionObserver(onIntersect, { rootMargin: '600px 0px' });

    for (var idx = 0; idx < pageCount; idx++) {
      var tile = buildTile(idx);
      session.tileEls[idx] = tile;
      listEl.appendChild(tile);
      session.observer.observe(tile);
    }

    hideLoading();
    listEl.classList.remove('hidden');
    statusEl.classList.remove('hidden');
    // Remove/Extract/Organize mirror the grid's selection into their tool's
    // own text-input option (see setOptionsInputReadOnly) rather than hiding
    // that row — kept visible, read-only, so the exact spec the grid
    // produces stays there for verification.
    setOptionsInputReadOnly(true);
    container.classList.remove('hidden');
    var preview = q('file-preview');
    if (preview) preview.classList.add('hidden');

    updateSplitModeButtons();
    updateHintText();
    updateStatus();
    commitChange();
    announce(pageCount + ' page' + (pageCount === 1 ? '' : 's') + ' loaded.');
  }

  // Remove/Extract/Organize's #tool-options row has a single text input
  // (#opt-pages/#opt-order) that commitChange()'s onChange callback already
  // mirrors the grid's selection into — made read-only once the grid is
  // driving it, so it stays visible as a live confirmation of the exact spec
  // rather than an editable field two sources could fight over.
  function setOptionsInputReadOnly(readOnly) {
    if (!optionsRowEl) return;
    if (opts.mode !== 'remove' && opts.mode !== 'extract' && opts.mode !== 'organize') return;
    var input = optionsRowEl.querySelector('.tool-options__input');
    if (input) input.readOnly = readOnly;
  }

  function buildTile(idx) {
    var tile;
    if (opts.mode === 'organize') {
      tile = document.createElement('div');
      tile.setAttribute('tabindex', '0');
      tile.setAttribute('role', 'option');
      tile.addEventListener('pointerdown', onDragPointerDown);
      tile.addEventListener('keydown', onOrganizeKeyDown);
    } else if (opts.mode === 'preview' || opts.mode === 'rotate') {
      tile = document.createElement('div');
    } else {
      tile = document.createElement('button');
      tile.type = 'button';
      tile.setAttribute('aria-pressed', 'false');
      tile.addEventListener('click', function () {
        toggleMark(idx);
      });
    }
    tile.className = 'page-grid__tile page-grid__tile--' + opts.mode;
    tile.dataset.origIdx = String(idx);

    var canvasWrap = document.createElement('div');
    canvasWrap.className = 'page-grid__tile-canvas-wrap';
    var canvas = document.createElement('canvas');
    canvas.className = 'page-grid__tile-canvas';
    canvasWrap.appendChild(canvas);

    var check = document.createElement('span');
    check.className = 'page-grid__tile-check';
    check.setAttribute('aria-hidden', 'true');
    canvasWrap.appendChild(check);

    var label = document.createElement('div');
    label.className = 'page-grid__tile-label';

    tile.appendChild(canvasWrap);
    tile.appendChild(label);

    tile._fcCanvas = canvas;
    tile._fcLabel = label;

    updateTileLabel(tile, idx);
    return tile;
  }

  function updateTileLabel(tile, origIdx) {
    if (opts.mode === 'organize') {
      var pos = session.order.indexOf(origIdx);
      tile._fcLabel.textContent = 'Page ' + (origIdx + 1) + ' → ' + (pos + 1);
    } else {
      tile._fcLabel.textContent = 'Page ' + (origIdx + 1);
    }
  }

  function paintTile(tile, bitmap) {
    var canvas = tile._fcCanvas;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.style.aspectRatio = bitmap.width + ' / ' + bitmap.height;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    tile.classList.add('is-rendered');

    if (opts.mode === 'rotate') {
      applyRotationPreview(tile);
    }
  }

  // ---------------------------------------------------------------------
  // Rotate v1 — read-only grid, live-previews the whole-document rotation
  // the #opt-rotation select currently has picked. pdf.js's own default
  // viewport (page.getViewport({scale}), used by pdf-render-worker.js) sets
  // its `rotation` param to the page's own /Rotate value unless told
  // otherwise — the rendered bitmap already shows the page upright the way
  // any normal viewer displays it today, current rotation baked in. rotate()
  // in the worker sets the page's new total rotation to current + picked,
  // so re-opened in that same normal viewer it'll look like today's upright
  // view turned an ADDITIONAL `picked` degrees — not current + picked again
  // on top of an already-compensated render, which would double the page's
  // existing rotation for any already-rotated page (a common case: scans,
  // phone camera PDFs).
  // ---------------------------------------------------------------------
  function applyRotationPreview(tile) {
    var picked = currentRotationDegrees();
    var total = ((picked % 360) + 360) % 360;
    tile._fcCanvas.style.transform = 'rotate(' + total + 'deg)';
  }

  function currentRotationDegrees() {
    var el = q('opt-rotation');
    return el ? parseInt(el.value, 10) || 0 : 0;
  }

  function applyRotationPreviewToAllTiles() {
    if (!session) return;
    session.tileEls.forEach(function (tile) {
      if (tile && tile.classList.contains('is-rendered')) applyRotationPreview(tile);
    });
  }

  // Renders only thumbnails in/near the viewport (600px buffer above/below):
  // each tile is observed once at creation and unobserved the moment it's
  // requested, so a large document never queues a render for every page up
  // front — only the ones the visitor actually scrolls near.
  function onIntersect(entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting || !session) return;
      var tile = entry.target;
      session.observer.unobserve(tile);
      var origIdx = Number(tile.dataset.origIdx);
      var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      session.worker.postMessage({
        op: 'render',
        requestId: ++session.requestSeq,
        pageIndex: origIdx,
        targetWidth: Math.round(THUMB_CSS_WIDTH * dpr)
      });
    });
  }

  // ---------------------------------------------------------------------
  // Split — "at marked points" sub-mode. The tiles built by buildTile() for
  // 'preview' mode are plain, non-interactive <div>s (matching "every page",
  // the default) — switching sub-modes attaches/detaches a small corner
  // toggle button on the *already-built* tiles rather than rebuilding the
  // grid, so flipping back and forth never re-triggers the pdf.js render
  // worker or loses scroll position.
  // ---------------------------------------------------------------------
  function switchSplitSubMode(mode) {
    if (!session || session.splitSubMode === mode) return;
    session.splitSubMode = mode;
    if (mode === 'marked') {
      // Cut points from a previous visit to this sub-mode (same file,
      // flipped back and forth) are intentionally kept, not cleared — only
      // a new file pick (buildGrid()) resets them. attachCutToggles() below
      // restores each toggle's visual state from session.cutPoints as it
      // re-creates them.
      attachCutToggles();
      commitSplitGroups();
    } else {
      detachCutToggles();
      if (opts && typeof opts.onChange === 'function') opts.onChange(null);
    }
    updateSplitModeButtons();
    updateHintText();
    updateStatus();
    if (statusEl) announce(statusEl.textContent);
  }

  function updateSplitModeButtons() {
    if (!splitModeButtons || !session) return;
    var isMarked = session.splitSubMode === 'marked';
    splitModeButtons.every.classList.toggle('is-active', !isMarked);
    splitModeButtons.every.setAttribute('aria-pressed', isMarked ? 'false' : 'true');
    splitModeButtons.marked.classList.toggle('is-active', isMarked);
    splitModeButtons.marked.setAttribute('aria-pressed', isMarked ? 'true' : 'false');
  }

  // Every tile except the last gets a toggle (cutting "after the last page"
  // isn't a meaningful cut point).
  function attachCutToggles() {
    if (!session) return;
    for (var i = 0; i < session.pageCount - 1; i++) {
      var tile = session.tileEls[i];
      if (!tile || tile._fcCutToggle) continue;
      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'page-grid__cut-toggle';
      toggle.setAttribute('aria-label', 'Toggle cut after page ' + (i + 1));
      toggle.setAttribute('aria-pressed', session.cutPoints.has(i) ? 'true' : 'false');
      toggle.classList.toggle('is-active', session.cutPoints.has(i));
      (function (origIdx) {
        toggle.addEventListener('click', function (e) {
          e.stopPropagation();
          toggleCutPoint(origIdx);
        });
      })(i);
      tile.appendChild(toggle);
      tile._fcCutToggle = toggle;
    }
  }

  function detachCutToggles() {
    if (!session) return;
    session.tileEls.forEach(function (tile) {
      if (tile && tile._fcCutToggle) {
        tile.removeChild(tile._fcCutToggle);
        tile._fcCutToggle = null;
      }
    });
  }

  function toggleCutPoint(origIdx) {
    if (session.cutPoints.has(origIdx)) session.cutPoints.delete(origIdx);
    else session.cutPoints.add(origIdx);
    var toggle = session.tileEls[origIdx] && session.tileEls[origIdx]._fcCutToggle;
    if (toggle) {
      var active = session.cutPoints.has(origIdx);
      toggle.classList.toggle('is-active', active);
      toggle.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    updateStatus();
    commitSplitGroups();
    if (statusEl) announce(statusEl.textContent);
  }

  // Contiguous [startIdx, endIdxInclusive] pairs, 0-indexed, covering every
  // page exactly once — the shape pdf-lib-worker.js's split() expects.
  function computeSplitGroups() {
    if (!session) return [];
    var cuts = Array.from(session.cutPoints).sort(function (a, b) {
      return a - b;
    });
    var groups = [];
    var start = 0;
    cuts.forEach(function (cut) {
      groups.push([start, cut]);
      start = cut + 1;
    });
    groups.push([start, session.pageCount - 1]);
    return groups;
  }

  // Split's own commit path — buildSpec()/commitChange() are string-shaped
  // (built from session.marked), not groups-array-shaped, so this doesn't
  // reuse them. Called only from the toggle handler and the sub-mode switch;
  // buildGrid()'s own unconditional commitChange() call is untouched and
  // keeps no-oping for Split (onChange('') from buildSpec(), which happens
  // to be falsy the same way null is — see pdf-split.js).
  function commitSplitGroups() {
    if (opts && typeof opts.onChange === 'function') {
      opts.onChange(computeSplitGroups());
    }
  }

  // ---------------------------------------------------------------------
  // Remove / Extract — click to toggle
  // ---------------------------------------------------------------------
  function toggleMark(origIdx) {
    var tile = session.tileEls[origIdx];
    if (session.marked.has(origIdx)) {
      session.marked.delete(origIdx);
      tile.classList.remove('is-marked');
      tile.setAttribute('aria-pressed', 'false');
    } else {
      session.marked.add(origIdx);
      tile.classList.add('is-marked');
      tile.setAttribute('aria-pressed', 'true');
    }
    updateStatus();
    commitChange();
    // statusEl itself is aria-hidden (it's a persistent visible element, not a
    // one-shot announcement) — mirror its text into #a11y-status so a screen
    // reader user clicking through pages hears the running count, not just
    // this one tile's own pressed-state change.
    if (statusEl) announce(statusEl.textContent);
  }

  function updateStatus() {
    if (!statusEl || !session) return;
    var marked = session.marked.size;
    var total = session.pageCount;
    if (opts.mode === 'remove') {
      statusEl.textContent = marked + ' marked for removal — ' + (total - marked) + ' will remain.';
    } else if (opts.mode === 'extract') {
      statusEl.textContent =
        marked + ' of ' + total + ' page' + (total === 1 ? '' : 's') + ' selected.';
    } else if (opts.mode === 'preview') {
      if (session.splitSubMode === 'marked') {
        var cuts = session.cutPoints.size;
        var fileCount = cuts + 1;
        statusEl.textContent =
          cuts +
          ' cut' +
          (cuts === 1 ? '' : 's') +
          ' — will split into ' +
          fileCount +
          ' file' +
          (fileCount === 1 ? '' : 's') +
          '.';
      } else {
        statusEl.textContent =
          total + ' page' + (total === 1 ? '' : 's') + ' — will split into ' + total + ' files.';
      }
    } else {
      statusEl.textContent = total + ' page' + (total === 1 ? '' : 's') + '.';
    }
  }

  // ---------------------------------------------------------------------
  // Organize — drag (Pointer Events, unifies mouse/touch/pen — no sortable
  // library exists anywhere in this codebase) + a keyboard path, since a
  // mouse-only drag would be a regression against the old text box (which a
  // keyboard/screen-reader user could operate by typing an order).
  // ---------------------------------------------------------------------
  function onDragPointerDown(e) {
    var tile = e.currentTarget;
    session.dragOrigIdx = Number(tile.dataset.origIdx);
    tile.classList.add('is-dragging');
    if (tile.setPointerCapture) {
      try {
        tile.setPointerCapture(e.pointerId);
      } catch (err) {
        /* pointer capture unsupported — dragging still works via elementFromPoint */
      }
    }
    document.addEventListener('pointermove', onDragPointerMove);
    document.addEventListener('pointerup', onDragPointerUp);
    document.addEventListener('pointercancel', onDragPointerUp);
    e.preventDefault();
  }

  function onDragPointerMove(e) {
    if (!session || session.dragOrigIdx == null) return;
    var target = document.elementFromPoint(e.clientX, e.clientY);
    var targetTile = target && target.closest && target.closest('.page-grid__tile');
    if (!targetTile || !listEl.contains(targetTile)) return;
    var targetOrigIdx = Number(targetTile.dataset.origIdx);
    if (targetOrigIdx === session.dragOrigIdx) return;
    moveInOrder(session.dragOrigIdx, session.order.indexOf(targetOrigIdx));
  }

  function onDragPointerUp() {
    if (session && session.dragOrigIdx != null) {
      var draggedIdx = session.dragOrigIdx;
      var tile = session.tileEls[draggedIdx];
      if (tile) tile.classList.remove('is-dragging');
      session.dragOrigIdx = null;
      commitChange();
      announce(
        'Page ' +
          (draggedIdx + 1) +
          ' moved to position ' +
          (session.order.indexOf(draggedIdx) + 1) +
          '.'
      );
    }
    document.removeEventListener('pointermove', onDragPointerMove);
    document.removeEventListener('pointerup', onDragPointerUp);
    document.removeEventListener('pointercancel', onDragPointerUp);
  }

  function onOrganizeKeyDown(e) {
    if (!session) return;
    var origIdx = Number(e.currentTarget.dataset.origIdx);
    var pos = session.order.indexOf(origIdx);
    var newPos = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') newPos = pos - 1;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') newPos = pos + 1;
    else if (e.key === 'Home') newPos = 0;
    else if (e.key === 'End') newPos = session.order.length - 1;
    else return;

    e.preventDefault();
    if (newPos < 0 || newPos >= session.order.length) return;
    moveInOrder(origIdx, newPos);
    commitChange();
    announce('Page ' + (origIdx + 1) + ' moved to position ' + (newPos + 1) + '.');
    session.tileEls[origIdx].focus();
  }

  // Moves the tile whose original page index is origIdx to display position
  // newPos in session.order, then re-syncs DOM order + labels. appendChild()
  // on an already-attached node MOVES it (no clone, no focus loss), so this
  // is safe to call mid-keyboard-focus or mid-pointer-drag.
  function moveInOrder(origIdx, newPos) {
    var order = session.order;
    var curPos = order.indexOf(origIdx);
    if (curPos === -1 || curPos === newPos) return;
    order.splice(curPos, 1);
    order.splice(newPos, 0, origIdx);
    order.forEach(function (oi) {
      listEl.appendChild(session.tileEls[oi]);
      updateTileLabel(session.tileEls[oi], oi);
    });
  }

  // ---------------------------------------------------------------------
  // Spec string — the exact "2,4-6" / "3,1,2,4" shape parsePageList /
  // parsePagePermutation already parse (pdf-lib-worker.js), unchanged. Ranges
  // are used for remove/extract (parsePageList allows them, keeps the value
  // compact); organize always emits a flat list — parsePagePermutation calls
  // parsePageList with allowRanges:false, so a range there would fail to parse.
  // ---------------------------------------------------------------------
  function buildSpec() {
    if (!session) return '';
    if (opts.mode === 'organize') {
      return session.order
        .map(function (i) {
          return i + 1;
        })
        .join(',');
    }
    var indices = Array.from(session.marked).sort(function (a, b) {
      return a - b;
    });
    return collapseToRangeSpec(indices);
  }

  function collapseToRangeSpec(zeroBasedIndices) {
    if (!zeroBasedIndices.length) return '';
    var parts = [];
    var start = zeroBasedIndices[0];
    var prev = start;
    for (var k = 1; k <= zeroBasedIndices.length; k++) {
      var cur = zeroBasedIndices[k];
      if (cur === prev + 1) {
        prev = cur;
        continue;
      }
      parts.push(start === prev ? String(start + 1) : start + 1 + '-' + (prev + 1));
      start = cur;
      prev = cur;
    }
    return parts.join(',');
  }

  function commitChange() {
    if (opts && typeof opts.onChange === 'function') {
      opts.onChange(buildSpec());
    }
  }

  // ---------------------------------------------------------------------
  // Loading / teardown
  // ---------------------------------------------------------------------
  function showLoading() {
    if (!container) return;
    container.classList.remove('hidden');
    loadingEl.classList.remove('hidden');
    listEl.classList.add('hidden');
    statusEl.classList.add('hidden');
  }

  function hideLoading() {
    if (loadingEl) loadingEl.classList.add('hidden');
  }

  function teardownWorker() {
    if (session && session.worker) {
      session.worker.terminate();
    }
  }

  function teardownSession() {
    pendingFile = null;
    teardownWorker();
    session = null;
    if (container) container.classList.add('hidden');
    // Falls back to the plain, editable text box — no pdf.js assets, or a
    // non-PDF file re-picked mid-session.
    setOptionsInputReadOnly(false);
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------
  window.FCPageGrid = {
    init: function (initOpts) {
      opts = initOpts || {};

      var fileInputEl = q('file-input');
      if (fileInputEl) {
        fileInputEl.addEventListener('change', function () {
          var file = fileInputEl.files && fileInputEl.files[0];
          if (file) onFilePicked(file);
        });
      }
      var resetBtnEl = q('reset-btn');
      if (resetBtnEl) {
        resetBtnEl.addEventListener('click', teardownSession);
      }

      if (opts.mode === 'rotate') {
        var rotationEl = q('opt-rotation');
        if (rotationEl) {
          rotationEl.addEventListener('change', applyRotationPreviewToAllTiles);
        }
      }
    }
  };
})();
