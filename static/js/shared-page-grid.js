(function () {
  'use strict';

  // Shared "page grid" component (Tool Preview/Interaction Redesign §1) — one
  // thumbnail grid, three interaction modes: click-to-mark (Remove/Extract)
  // and drag/keyboard-to-reorder (Organize). Each mode's converter file calls
  // window.FCPageGrid.init({ mode, onChange }) at load time; this module owns
  // everything else — DOM, the render Worker, selection state.
  //
  // shared.js (loaded before this file) never exposes a "file was just
  // selected" hook to converters — same note as image-cropper.js/
  // image-rotate-flip.js — so this file wires its own #file-input listener
  // directly, independent of shared.js's own state machine. window.convertFile
  // is untouched by this file: each converter keeps reading the same hidden
  // #opt-pages/#opt-order text input it always has, this component just keeps
  // that input's value in sync with the grid selection.

  var THUMB_CSS_WIDTH = 120; // display width, in CSS px, requested from the render worker
  var MAX_DPR = 2; // cap devicePixelRatio scaling so a 3x/4x phone doesn't over-render

  var container = null;
  var statusEl = null;
  var listEl = null;
  var loadingEl = null;
  var optionsRowEl = null; // #tool-options — hidden while the grid is active, restored on fallback

  var opts = null; // { mode: 'remove'|'extract'|'organize', onChange: fn(spec) }
  var session = null; // rebuilt on every file pick; null before any pick / after fallback

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

    var hint = document.createElement('div');
    hint.className = 'page-grid__hint';
    hint.textContent = hintText();

    container.appendChild(loadingEl);
    container.appendChild(statusEl);
    container.appendChild(listEl);
    container.appendChild(hint);
    fileInfo.parentNode.insertBefore(container, fileInfo.nextSibling);

    optionsRowEl = q('tool-options');
  }

  function hintText() {
    if (opts.mode === 'organize') {
      return 'Drag a page to reorder it, or focus a page and use the arrow keys.';
    }
    if (opts.mode === 'extract') {
      return 'Click a page to select it for extraction.';
    }
    return 'Click a page to mark it for removal.';
  }

  // ---------------------------------------------------------------------
  // File selection -> load into the render worker
  // ---------------------------------------------------------------------
  // Tracks the most recently picked file so a slower-loading document from an
  // earlier pick can't win a race against a faster one picked right after it
  // — same pattern image-cropper.js uses for its own async image decode.
  var pendingFile = null;

  function onFilePicked(file) {
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
    if (optionsRowEl) optionsRowEl.classList.add('hidden');
    container.classList.remove('hidden');
    var preview = q('file-preview');
    if (preview) preview.classList.add('hidden');

    updateStatus();
    commitChange();
    announce(pageCount + ' page' + (pageCount === 1 ? '' : 's') + ' loaded.');
  }

  function buildTile(idx) {
    var tile;
    if (opts.mode === 'organize') {
      tile = document.createElement('div');
      tile.setAttribute('tabindex', '0');
      tile.setAttribute('role', 'option');
      tile.addEventListener('pointerdown', onDragPointerDown);
      tile.addEventListener('keydown', onOrganizeKeyDown);
    } else {
      tile = document.createElement('button');
      tile.type = 'button';
      tile.setAttribute('aria-pressed', 'false');
      tile.addEventListener('click', function () {
        toggleMark(idx);
      });
    }
    tile.className = 'page-grid__tile';
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
    if (optionsRowEl) optionsRowEl.classList.remove('hidden');
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
    }
  };
})();
