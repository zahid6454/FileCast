(function () {
  'use strict';

  // Interactive UI note: same as image-rotate-flip.js/image-cropper.js —
  // shared.js never exposes a "file was just selected" hook to converters,
  // so this file wires its own #file-input/#upload-zone/paste listeners.
  // window.convertFile is unchanged from before this UI existed.
  //
  // Live estimate (Tool Preview/Interaction Redesign §13): debounced 400ms
  // after the quality slider settles, then calls the REAL imageCompression()
  // — same options object, same library, useWebWorker:true already keeps it
  // off the main thread — so the estimate shown and the file actually
  // downloaded can never disagree. Also swaps the preview thumbnail to the
  // just-compressed result, so heavy compression's visible softening/
  // artifacting is part of the preview, not just a size number.

  var DEBOUNCE_MS = 400;

  var container = null;
  var imgEl = null;
  var statusEl = null;

  var session = null; // { file }
  var debounceTimer = null;
  var estimateToken = 0; // guards a slow estimate from an earlier slider position overwriting a newer one

  function ensureUI() {
    if (container) return;
    var fileInfo = document.getElementById('file-info');
    if (!fileInfo || !fileInfo.parentNode) return;

    container = document.createElement('div');
    container.className = 'image-compress-preview hidden';
    container.id = 'image-compress-preview';

    imgEl = document.createElement('img');
    imgEl.className = 'image-compress-preview__img';
    imgEl.alt = 'Live compression preview';

    statusEl = document.createElement('div');
    statusEl.className = 'image-compress-preview__status';

    container.appendChild(imgEl);
    container.appendChild(statusEl);
    fileInfo.parentNode.insertBefore(container, fileInfo.nextSibling);
  }

  function showUI() {
    if (container) container.classList.remove('hidden');
    var preview = document.getElementById('file-preview');
    if (preview) preview.classList.add('hidden');
  }

  function hideUI() {
    if (container) container.classList.add('hidden');
    session = null;
    clearTimeout(debounceTimer);
  }

  function currentQuality() {
    var slider = document.getElementById('opt-quality');
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

  function formatBytes(n) {
    var FC = window.FC || {};
    return typeof FC.formatBytes === 'function' ? FC.formatBytes(n) : n + ' bytes';
  }

  function scheduleEstimate() {
    if (!session) return;
    clearTimeout(debounceTimer);
    if (statusEl) statusEl.textContent = 'Estimating…';
    debounceTimer = setTimeout(runEstimate, DEBOUNCE_MS);
  }

  function runEstimate() {
    if (!session || typeof imageCompression !== 'function') return;
    var file = session.file;
    var quality = currentQuality();
    var outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    var token = ++estimateToken;

    imageCompression(file, buildOptions(quality, outputType))
      .then(function (compressed) {
        if (token !== estimateToken || !session || session.file !== file) return; // superseded

        var oldSrc = imgEl.src;
        var url = URL.createObjectURL(compressed);
        imgEl.onload = function () {
          if (oldSrc) URL.revokeObjectURL(oldSrc);
        };
        imgEl.src = url;

        var savings = file.size > 0 ? Math.round((1 - compressed.size / file.size) * 100) : 0;
        var text = formatBytes(file.size) + ' → ' + formatBytes(compressed.size);
        if (savings > 0) text += ' (' + savings + '% smaller)';
        else if (savings < 0) text += ' (' + Math.abs(savings) + '% larger)';
        if (statusEl) statusEl.textContent = text;
      })
      .catch(function () {
        if (token !== estimateToken) return;
        if (statusEl) statusEl.textContent = 'Preview unavailable for this file.';
      });
  }

  var fileInputEl = document.getElementById('file-input');
  if (fileInputEl) {
    fileInputEl.addEventListener('change', function () {
      var file = fileInputEl.files && fileInputEl.files[0];
      if (!file) return;
      loadForPreview(file);
    });
  }

  var uploadZoneEl = document.getElementById('upload-zone');
  if (uploadZoneEl) {
    uploadZoneEl.addEventListener('drop', function (e) {
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) loadForPreview(file);
    });
  }

  document.addEventListener('paste', function (e) {
    var active = document.activeElement;
    var isEditable =
      active &&
      (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
    if (isEditable) return;

    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file' && items[i].type && items[i].type.indexOf('image/') === 0) {
        loadForPreview(items[i].getAsFile());
        return;
      }
    }
  });

  var resetBtnEl = document.getElementById('reset-btn');
  if (resetBtnEl) {
    resetBtnEl.addEventListener('click', hideUI);
  }

  var qualityEl = document.getElementById('opt-quality');
  if (qualityEl) {
    qualityEl.addEventListener('input', scheduleEstimate);
  }

  function loadForPreview(file) {
    if (!file.type || file.type.indexOf('image/') !== 0) {
      hideUI();
      return;
    }
    if (typeof imageCompression !== 'function') return; // js_libs not loaded yet — Convert still works, just no live preview

    ensureUI();
    if (!container) return; // page markup doesn't have #file-info — nothing to attach to

    session = { file: file };
    imgEl.src = URL.createObjectURL(file); // show the original immediately while the first estimate runs
    if (statusEl) statusEl.textContent = 'Estimating…';
    showUI();
    scheduleEstimate();
  }

  // ---------------------------------------------------------------------
  // Conversion — unchanged.
  // ---------------------------------------------------------------------
  window.convertFile = function (file) {
    var quality = currentQuality();
    var outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    var options = buildOptions(quality, outputType);

    var config = window.TOOL_CONFIG;
    if (config) {
      if (file.type === 'image/png') config.output_extension = '.png';
      else if (file.type === 'image/webp') config.output_extension = '.webp';
      else config.output_extension = '.jpg';
    }

    return imageCompression(file, options).then(function (compressedFile) {
      return new Blob([compressedFile], { type: compressedFile.type });
    });
  };
})();
