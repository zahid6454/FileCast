(function () {
  'use strict';

  // Per-row live estimate (Tool Preview/Interaction Redesign §13) — takes
  // over #file-list via shared-multi.js's window._fileListRenderer hook
  // (same generic, opt-in mechanism pdf-merge.js/shared-file-grid.js use),
  // rendering the same row shape as the default list plus a debounced
  // per-file size estimate. No reordering needed here (compression order
  // doesn't matter), so this stays self-contained rather than reusing
  // shared-file-grid.js, which exists for Merge's drag/thumbnail needs
  // specifically. window.convertFile below is unchanged — the estimate
  // reuses the exact same imageCompression() call and options object, so
  // the number shown and the file actually downloaded can never disagree.

  var DEBOUNCE_MS = 400;

  var container = null;
  var listEl = null;
  var defaultFileListEl = null;

  var currentFiles = [];
  var rowCache = new WeakMap(); // File -> { row, statusEl }
  var debounceTimer = null;
  var estimateToken = 0; // bumped on every debounce trigger; a stale run's writes are dropped

  function q(id) {
    return document.getElementById(id);
  }

  function formatBytes(n) {
    var FC = window.FC || {};
    return typeof FC.formatBytes === 'function' ? FC.formatBytes(n) : n + ' bytes';
  }

  function currentQuality() {
    var slider = q('opt-quality');
    return slider ? parseInt(slider.value, 10) || 75 : 75;
  }

  function buildOptions(quality, fileType) {
    var maxSizeMB = quality >= 90 ? 10 : quality >= 50 ? 5 : 2;
    return {
      maxSizeMB: maxSizeMB,
      maxWidthOrHeight: 4096,
      useWebWorker: true,
      initialQuality: quality / 100,
      fileType: fileType
    };
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
    container.className = 'file-estimate-list hidden';
    container.id = 'file-estimate-list';

    listEl = document.createElement('div');
    container.appendChild(listEl);

    defaultFileListEl.parentNode.insertBefore(container, defaultFileListEl.nextSibling);
  }

  function renderList(files) {
    ensureUI();
    if (!container) return; // page markup has no #file-list — shared-multi.js's plain list still ran

    currentFiles = files.slice();
    defaultFileListEl.classList.add('hidden');

    if (currentFiles.length === 0) {
      container.classList.add('hidden');
      listEl.innerHTML = '';
      clearTimeout(debounceTimer);
      return;
    }

    container.classList.remove('hidden');
    listEl.innerHTML = '';
    currentFiles.forEach(function (file, index) {
      var row = buildRow(file, index);
      listEl.appendChild(row);
    });
    scheduleEstimate();
  }

  function buildRow(file, index) {
    var row = document.createElement('div');
    row.className = 'file-estimate-row';

    var meta = document.createElement('div');
    meta.className = 'file-estimate-row__meta';
    var name = document.createElement('div');
    name.className = 'file-estimate-row__name';
    name.textContent = file.name;
    var status = document.createElement('div');
    status.className = 'file-estimate-row__status';
    status.textContent = formatBytes(file.size) + ' — estimating…';
    meta.appendChild(name);
    meta.appendChild(status);

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'file-estimate-row__remove';
    remove.setAttribute('aria-label', 'Remove ' + file.name);
    remove.textContent = '×';
    remove.addEventListener('click', function () {
      if (typeof window._fileListRemove === 'function') window._fileListRemove(index);
    });

    row.appendChild(meta);
    row.appendChild(remove);

    rowCache.set(file, { row: row, statusEl: status });
    return row;
  }

  // ---------------------------------------------------------------------
  // Debounced estimate — one imageCompression() call per file, run
  // sequentially (not all at once) so a 10-file batch doesn't spin up ten
  // workers on every slider tick.
  // ---------------------------------------------------------------------
  function scheduleEstimate() {
    clearTimeout(debounceTimer);
    currentFiles.forEach(function (file) {
      var entry = rowCache.get(file);
      if (entry) entry.statusEl.textContent = formatBytes(file.size) + ' — estimating…';
    });
    debounceTimer = setTimeout(runEstimates, DEBOUNCE_MS);
  }

  function runEstimates() {
    if (typeof imageCompression !== 'function') return;
    var token = ++estimateToken;
    var quality = currentQuality();
    var queue = currentFiles.slice();

    function next() {
      if (token !== estimateToken || !queue.length) return;
      var file = queue.shift();
      var entry = rowCache.get(file);
      var outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';

      imageCompression(file, buildOptions(quality, outputType))
        .then(function (compressed) {
          if (token !== estimateToken || !entry) return;
          var savings = file.size > 0 ? Math.round((1 - compressed.size / file.size) * 100) : 0;
          var text = formatBytes(file.size) + ' → ' + formatBytes(compressed.size);
          if (savings > 0) text += ' (' + savings + '% smaller)';
          else if (savings < 0) text += ' (' + Math.abs(savings) + '% larger)';
          entry.statusEl.textContent = text;
        })
        .catch(function () {
          if (token !== estimateToken || !entry) return;
          entry.statusEl.textContent = formatBytes(file.size) + ' — preview unavailable.';
        })
        .then(next);
    }
    next();
  }

  var qualityEl = q('opt-quality');
  if (qualityEl) {
    qualityEl.addEventListener('input', scheduleEstimate);
  }

  window._fileListRenderer = renderList;

  // ---------------------------------------------------------------------
  // Conversion — unchanged.
  // ---------------------------------------------------------------------
  window.convertFile = function (file) {
    var quality = currentQuality();
    var outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    var options = buildOptions(quality, outputType);

    return imageCompression(file, options).then(function (compressedFile) {
      return new Blob([compressedFile], { type: compressedFile.type });
    });
  };
})();
