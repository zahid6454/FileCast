(function () {
  'use strict';

  // Shared "file grid" component (Tool Preview/Interaction Redesign §6) — the
  // reorderable, thumbnailed file list behind PDF Merge. Takes over
  // shared-multi.js's #file-list via its window._fileListRenderer hook (see
  // shared-multi.js), which every other multi-file tool (jpg-to-pdf/
  // png-to-pdf/image-to-pdf) never sets, so this is opt-in and doesn't touch
  // their plain list. window.convertFiles() is untouched by this file: it
  // still reads selectedFiles from shared-multi.js, which
  // window._fileListReorder keeps in sync as the row order changes here.

  var THUMB_CSS_WIDTH = 60; // small — this is a per-file row thumbnail, not a page grid tile
  var MAX_DPR = 2;

  var container = null;
  var listEl = null;
  var defaultFileListEl = null;

  var currentFiles = []; // this component's own authoritative order (File refs)
  var thumbCache = new WeakMap(); // File -> <canvas> (rendered once, reused across re-renders)
  var rowCache = new WeakMap(); // File -> its current row element, rebuilt every renderList()
  var renderWorker = null; // one persistent worker for the whole session, files loaded sequentially
  var thumbQueue = []; // [{file, canvas}], processed one at a time
  var thumbBusy = false;
  var dragFile = null;

  function q(id) {
    return document.getElementById(id);
  }

  function announce(text) {
    var status = q('a11y-status');
    if (status) status.textContent = text;
  }

  function formatBytes(bytes) {
    var FC = window.FC || {};
    return typeof FC.formatBytes === 'function' ? FC.formatBytes(bytes) : bytes + ' bytes';
  }

  // ---------------------------------------------------------------------
  // DOM setup — inserted right after #file-list, whose default rendering
  // this component replaces (see shared-multi.js's renderFileList()).
  // ---------------------------------------------------------------------
  function ensureUI() {
    if (container) return;
    defaultFileListEl = q('file-list');
    if (!defaultFileListEl || !defaultFileListEl.parentNode) return;

    container = document.createElement('div');
    container.className = 'file-grid hidden';
    container.id = 'file-grid';

    listEl = document.createElement('div');
    listEl.className = 'file-grid__list';
    listEl.setAttribute('role', 'listbox');

    var hint = document.createElement('div');
    hint.className = 'file-grid__hint';
    hint.textContent =
      'This is the merge order. Drag a file to reorder it, or focus a row and use the arrow keys.';

    container.appendChild(listEl);
    container.appendChild(hint);
    defaultFileListEl.parentNode.insertBefore(container, defaultFileListEl.nextSibling);
  }

  // ---------------------------------------------------------------------
  // Render — called by shared-multi.js's renderFileList() every time
  // selectedFiles changes (add/remove), and once with [] on reset.
  // ---------------------------------------------------------------------
  function renderList(files) {
    ensureUI();
    if (!container) return; // page markup has no #file-list — shared-multi.js's plain list still ran

    currentFiles = files.slice();
    defaultFileListEl.classList.add('hidden');

    if (currentFiles.length === 0) {
      container.classList.add('hidden');
      listEl.innerHTML = '';
      teardownWorker();
      return;
    }

    container.classList.remove('hidden');
    listEl.innerHTML = '';
    currentFiles.forEach(function (file, i) {
      var row = buildRow(file, i, currentFiles.length);
      listEl.appendChild(row);
      ensureThumb(file, row);
    });
  }

  function buildRow(file, index, total) {
    var row = document.createElement('div');
    row.className = 'file-grid__row';
    row.setAttribute('tabindex', '0');
    row.setAttribute('role', 'option');
    row.dataset.fileIndex = String(index);

    var handle = document.createElement('span');
    handle.className = 'file-grid__handle';
    handle.setAttribute('aria-hidden', 'true');
    handle.textContent = '⠿';
    handle.addEventListener('pointerdown', function (e) {
      onDragPointerDown(e, row, file);
    });

    var thumbWrap = document.createElement('div');
    thumbWrap.className = 'file-grid__thumb';

    var meta = document.createElement('div');
    meta.className = 'file-grid__meta';
    var name = document.createElement('div');
    name.className = 'file-grid__name';
    name.textContent = file.name;
    var size = document.createElement('div');
    size.className = 'file-grid__size';
    size.textContent = formatBytes(file.size);
    meta.appendChild(name);
    meta.appendChild(size);

    var badge = document.createElement('span');
    badge.className = 'file-grid__badge';
    badge.textContent = String(index + 1);

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'file-grid__remove';
    remove.setAttribute('aria-label', 'Remove ' + file.name);
    remove.textContent = '×';
    remove.addEventListener('click', function () {
      if (typeof window._fileListRemove === 'function') {
        window._fileListRemove(index);
      }
    });

    row.appendChild(handle);
    row.appendChild(thumbWrap);
    row.appendChild(meta);
    row.appendChild(badge);
    row.appendChild(remove);

    row._fcThumbWrap = thumbWrap;
    row._fcBadge = badge;
    row.addEventListener('keydown', onRowKeyDown);

    rowCache.set(file, row);
    return row;
  }

  // ---------------------------------------------------------------------
  // Thumbnails — first page of each file, via pdf-render-worker.js. One
  // worker for the whole session, files loaded/rendered one at a time
  // (simplest reliable protocol: only ever one file "in flight", no
  // response-matching needed against pdf.js's own page-index-only messages).
  // ---------------------------------------------------------------------
  function ensureThumb(file, row) {
    var cached = thumbCache.get(file);
    if (cached) {
      row._fcThumbWrap.appendChild(cached);
      return;
    }
    var canvas = document.createElement('canvas');
    canvas.className = 'file-grid__thumb-canvas';
    thumbCache.set(file, canvas);
    row._fcThumbWrap.appendChild(canvas);
    thumbQueue.push({ file: file, canvas: canvas });
    pumpThumbQueue();
  }

  function ensureWorker() {
    if (renderWorker) return renderWorker;
    var config = window.TOOL_CONFIG || {};
    if (!config.pdf_src || !config.pdf_render_worker_src) return null;
    renderWorker = new Worker(
      config.pdf_render_worker_src +
        '?lib=' +
        encodeURIComponent(config.pdf_src) +
        (config.pdf_worker_src ? '&workerLib=' + encodeURIComponent(config.pdf_worker_src) : '')
    );
    return renderWorker;
  }

  function teardownWorker() {
    if (renderWorker) {
      renderWorker.terminate();
      renderWorker = null;
    }
    thumbQueue = [];
    thumbBusy = false;
  }

  function pumpThumbQueue() {
    if (thumbBusy || !thumbQueue.length) return;
    var worker = ensureWorker();
    if (!worker) {
      thumbQueue = []; // preview unavailable — rows still work, just without thumbnails
      return;
    }
    thumbBusy = true;
    var job = thumbQueue.shift();

    job.file.arrayBuffer().then(
      function (bytes) {
        var onLoaded = function (e) {
          var data = e.data || {};
          if (data.type !== 'loaded') return;
          worker.removeEventListener('message', onLoaded);
          if (!data.ok) {
            thumbBusy = false;
            pumpThumbQueue();
            return;
          }
          var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
          var onRendered = function (e2) {
            var d2 = e2.data || {};
            if (d2.type !== 'rendered') return;
            worker.removeEventListener('message', onRendered);
            if (d2.ok) paintThumb(job.canvas, d2.bitmap);
            thumbBusy = false;
            pumpThumbQueue();
          };
          worker.addEventListener('message', onRendered);
          worker.postMessage({
            op: 'render',
            requestId: 0,
            pageIndex: 0,
            targetWidth: Math.round(THUMB_CSS_WIDTH * dpr)
          });
        };
        worker.addEventListener('message', onLoaded);
        worker.postMessage({ op: 'load', file: bytes }, [bytes]);
      },
      function () {
        thumbBusy = false;
        pumpThumbQueue();
      }
    );
  }

  function paintThumb(canvas, bitmap) {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.style.aspectRatio = bitmap.width + ' / ' + bitmap.height;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
  }

  // ---------------------------------------------------------------------
  // Reorder — pointer drag (from the handle) + keyboard (focused row).
  // ---------------------------------------------------------------------
  function onDragPointerDown(e, row, file) {
    dragFile = file;
    row.classList.add('is-dragging');
    document.addEventListener('pointermove', onDragPointerMove);
    document.addEventListener('pointerup', onDragPointerUp);
    document.addEventListener('pointercancel', onDragPointerUp);
    e.preventDefault();
  }

  function onDragPointerMove(e) {
    if (!dragFile) return;
    var target = document.elementFromPoint(e.clientX, e.clientY);
    var targetRow = target && target.closest && target.closest('.file-grid__row');
    if (!targetRow || !listEl.contains(targetRow)) return;
    var targetIndex = Number(targetRow.dataset.fileIndex);
    var targetFile = currentFiles[targetIndex];
    if (targetFile === dragFile) return;
    moveFile(dragFile, targetIndex);
  }

  function onDragPointerUp() {
    if (dragFile) {
      var row = rowCache.get(dragFile);
      if (row) row.classList.remove('is-dragging');
      var idx = currentFiles.indexOf(dragFile);
      announce(dragFile.name + ' moved to position ' + (idx + 1) + '.');
      commitOrder();
      dragFile = null;
    }
    document.removeEventListener('pointermove', onDragPointerMove);
    document.removeEventListener('pointerup', onDragPointerUp);
    document.removeEventListener('pointercancel', onDragPointerUp);
  }

  function onRowKeyDown(e) {
    var index = Number(e.currentTarget.dataset.fileIndex);
    var file = currentFiles[index];
    var newIndex = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') newIndex = index - 1;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') newIndex = index + 1;
    else if (e.key === 'Home') newIndex = 0;
    else if (e.key === 'End') newIndex = currentFiles.length - 1;
    else return;

    e.preventDefault();
    if (newIndex < 0 || newIndex >= currentFiles.length) return;
    moveFile(file, newIndex);
    announce(file.name + ' moved to position ' + (newIndex + 1) + '.');
    commitOrder();
    var movedRow = rowCache.get(file);
    if (movedRow) movedRow.focus();
  }

  // Moves `file` to display position `newIndex` in currentFiles, then
  // re-syncs DOM order + badges + row indices. appendChild() on an
  // already-attached node MOVES it (no clone, no focus loss).
  function moveFile(file, newIndex) {
    var curIndex = currentFiles.indexOf(file);
    if (curIndex === -1 || curIndex === newIndex) return;
    currentFiles.splice(curIndex, 1);
    currentFiles.splice(newIndex, 0, file);
    currentFiles.forEach(function (f, i) {
      var row = rowCache.get(f);
      if (!row) return;
      row.dataset.fileIndex = String(i);
      row._fcBadge.textContent = String(i + 1);
      listEl.appendChild(row);
    });
  }

  function commitOrder() {
    if (typeof window._fileListReorder === 'function') {
      window._fileListReorder(currentFiles.slice());
    }
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------
  window.FCFileGrid = {
    init: function () {
      window._fileListRenderer = renderList;
    }
  };
})();
