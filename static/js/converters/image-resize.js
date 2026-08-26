(function () {
  'use strict';

  // Interactive UI note: same as image-rotate-flip.js/image-cropper.js —
  // shared.js never exposes a "file was just selected" hook to converters,
  // so this file wires its own #file-input/#upload-zone/paste listeners to
  // build a live preview the moment a file is picked. window.convertFile
  // still returns a Promise<Blob>, the same contract every other converter
  // uses, and (Tool Preview/Interaction Redesign §12) falls back to a fresh
  // image load with NO lock applied when there's no live session — the lock
  // only ever changes what ends up typed into #opt-width/#opt-height, never
  // how resizeToBlob() itself resizes.

  var MAX_DISPLAY_WIDTH = 640;
  var MAX_DISPLAY_HEIGHT = 480;

  var container = null;
  var canvasEl = null;
  var dimsEl = null;
  var lockBtnEl = null;
  var warnEl = null;

  // Aspect-ratio lock — ON by default. Before this, typing both a width and
  // a height with no relation to the source's ratio silently stretched the
  // image (image-resize.js only ever derived the missing side when the
  // OTHER side was blank); locking keeps the non-edited field in sync live,
  // closing that distortion bug by default rather than just previewing it.
  var locked = true;
  var syncing = false; // re-entrancy guard: the auto-filled field's own 'input' handler must not re-trigger a sync

  // The one active preview session (file + loaded Image). Rebuilt whenever a
  // new file is picked; null before any file has been picked. convertFile()
  // reuses session.img for the matching file so the image isn't decoded twice.
  var session = null;

  function widthEl() {
    return document.getElementById('opt-width');
  }
  function heightEl() {
    return document.getElementById('opt-height');
  }

  function ensureUI() {
    if (container) return;
    var fileInfo = document.getElementById('file-info');
    if (!fileInfo || !fileInfo.parentNode) return;

    container = document.createElement('div');
    container.className = 'image-resizer hidden';
    container.id = 'image-resizer';

    canvasEl = document.createElement('canvas');
    canvasEl.className = 'image-resizer__canvas';
    canvasEl.setAttribute('aria-label', 'Live preview of the resized image');

    var toolbar = document.createElement('div');
    toolbar.className = 'image-resizer__toolbar';

    dimsEl = document.createElement('div');
    dimsEl.className = 'image-resizer__dims';

    lockBtnEl = document.createElement('button');
    lockBtnEl.type = 'button';
    lockBtnEl.className = 'image-resizer__lock';
    lockBtnEl.addEventListener('click', function () {
      locked = !locked;
      syncLockUI();
      resyncLockedDimensions();
      render();
    });

    toolbar.appendChild(dimsEl);
    toolbar.appendChild(lockBtnEl);

    warnEl = document.createElement('div');
    warnEl.className = 'image-resizer__warn hidden';
    warnEl.textContent =
      "Width and height don't match the original proportions — the image will look stretched.";

    container.appendChild(canvasEl);
    container.appendChild(toolbar);
    container.appendChild(warnEl);
    fileInfo.parentNode.insertBefore(container, fileInfo.nextSibling);

    syncLockUI();
  }

  function syncLockUI() {
    if (!lockBtnEl) return;
    lockBtnEl.setAttribute('aria-pressed', locked ? 'true' : 'false');
    lockBtnEl.classList.toggle('is-active', locked);
    lockBtnEl.textContent = locked ? 'Lock aspect ratio: On' : 'Lock aspect ratio: Off';
  }

  function showPreviewUI() {
    if (container) container.classList.remove('hidden');
    var preview = document.getElementById('file-preview');
    if (preview) preview.classList.add('hidden');
  }

  function hidePreviewUI() {
    if (container) container.classList.add('hidden');
    session = null;
  }

  // ---------------------------------------------------------------------
  // Aspect-ratio lock — keeps the non-edited field in sync with whichever
  // one the visitor is typing into, against the loaded image's own ratio.
  // ---------------------------------------------------------------------
  function syncFromWidth() {
    if (!locked || !session) return;
    var w = parseInt(widthEl().value, 10);
    if (!w || Number.isNaN(w)) return;
    syncing = true;
    heightEl().value = Math.max(
      1,
      Math.round(session.img.naturalHeight * (w / session.img.naturalWidth))
    );
    syncing = false;
  }

  function syncFromHeight() {
    if (!locked || !session) return;
    var h = parseInt(heightEl().value, 10);
    if (!h || Number.isNaN(h)) return;
    syncing = true;
    widthEl().value = Math.max(
      1,
      Math.round(session.img.naturalWidth * (h / session.img.naturalHeight))
    );
    syncing = false;
  }

  // Called whenever the lock turns on, or a new file loads while already
  // locked — re-derives the field the visitor didn't just edit, against
  // whatever's currently in the other field (width wins if both are set).
  function resyncLockedDimensions() {
    if (!locked || !session) return;
    var w = parseInt(widthEl().value, 10);
    var h = parseInt(heightEl().value, 10);
    if (w) syncFromWidth();
    else if (h) syncFromHeight();
  }

  // ---------------------------------------------------------------------
  // Live preview — draws exactly the width/height currently typed (derived
  // side filled in when one is blank, same as resizeToBlob()). Unlocked +
  // mismatched values stretch on screen here too — that mismatch IS the bug
  // this closes, so the preview has to actually show it, not hide it.
  // ---------------------------------------------------------------------
  function render() {
    if (!session || !canvasEl) return;
    var img = session.img;
    var origW = img.naturalWidth;
    var origH = img.naturalHeight;

    var newW = parseInt(widthEl() ? widthEl().value : '', 10);
    var newH = parseInt(heightEl() ? heightEl().value : '', 10);
    if (newW && !newH) newH = Math.round(origH * (newW / origW));
    else if (newH && !newW) newW = Math.round(origW * (newH / origH));
    if (!newW || !newH) {
      newW = origW;
      newH = origH;
    }

    var scale = Math.min(1, MAX_DISPLAY_WIDTH / newW, MAX_DISPLAY_HEIGHT / newH);
    var dispW = Math.max(1, Math.round(newW * scale));
    var dispH = Math.max(1, Math.round(newH * scale));

    canvasEl.width = dispW;
    canvasEl.height = dispH;
    var ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, dispW, dispH);
    if (session.file.type !== 'image/png') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, dispW, dispH);
    }
    ctx.drawImage(img, 0, 0, dispW, dispH);

    if (dimsEl) dimsEl.textContent = newW + ' × ' + newH + ' px';

    var origRatio = origW / origH;
    var newRatio = newW / newH;
    var distorted = !locked && Math.abs(newRatio - origRatio) > origRatio * 0.01;
    if (warnEl) warnEl.classList.toggle('hidden', !distorted);
  }

  // ---------------------------------------------------------------------
  // File selection -> build the preview session
  // ---------------------------------------------------------------------
  var fileInputEl = document.getElementById('file-input');
  if (fileInputEl) {
    fileInputEl.addEventListener('change', function () {
      var file = fileInputEl.files && fileInputEl.files[0];
      if (!file) return;
      loadImageForPreview(file);
    });
  }

  var uploadZoneEl = document.getElementById('upload-zone');
  if (uploadZoneEl) {
    uploadZoneEl.addEventListener('drop', function (e) {
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) loadImageForPreview(file);
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
        loadImageForPreview(items[i].getAsFile());
        return;
      }
    }
  });

  var resetBtnEl = document.getElementById('reset-btn');
  if (resetBtnEl) {
    resetBtnEl.addEventListener('click', hidePreviewUI);
  }

  ['opt-width', 'opt-height'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', function () {
      if (syncing) return;
      if (locked) {
        if (id === 'opt-width') syncFromWidth();
        else syncFromHeight();
      }
      render();
    });
  });

  var pendingFile = null;

  function loadImageForPreview(file) {
    if (!file.type || file.type.indexOf('image/') !== 0) {
      hidePreviewUI();
      return;
    }
    pendingFile = file;
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function () {
      URL.revokeObjectURL(url);
      if (pendingFile !== file) return; // superseded by a later selection
      ensureUI();
      if (!canvasEl) return; // page markup doesn't have #file-info — nothing to attach to
      session = { file: file, img: img };
      resyncLockedDimensions();
      render();
      showPreviewUI();
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      if (pendingFile !== file) return;
      hidePreviewUI();
    };
    img.src = url;
  }

  // ---------------------------------------------------------------------
  // Conversion — unchanged math from before this UI existed (derive the
  // blank side from the ratio, reject a too-small result, keep PNG
  // transparency vs. flatten everything else onto white).
  // ---------------------------------------------------------------------
  window.convertFile = function (file) {
    var targetWidth = widthEl() ? parseInt(widthEl().value, 10) : 0;
    var targetHeight = heightEl() ? parseInt(heightEl().value, 10) : 0;
    if (!targetWidth && !targetHeight) {
      return Promise.reject(new Error('Please enter a width, height, or both.'));
    }

    if (session && session.file === file) {
      return resizeToBlob(file, session.img, targetWidth, targetHeight);
    }
    // No preview session for this exact file — either convertFile() was
    // called directly, or the preview UI never attached (e.g. this page
    // markup has no #file-info). Load it fresh so the tool still produces a
    // sensible result on its own.
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        resizeToBlob(file, img, targetWidth, targetHeight).then(resolve, reject);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image.'));
      };
      img.src = url;
    });
  };

  function resizeToBlob(file, img, targetWidth, targetHeight) {
    var origW = img.naturalWidth;
    var origH = img.naturalHeight;
    var newW = targetWidth;
    var newH = targetHeight;

    if (newW && !newH) {
      newH = Math.round(origH * (newW / origW));
    } else if (newH && !newW) {
      newW = Math.round(origW * (newH / origH));
    }

    if (newW < 1 || newH < 1) {
      return Promise.reject(new Error('Resulting dimensions are too small.'));
    }

    var canvas = document.createElement('canvas');
    canvas.width = newW;
    canvas.height = newH;
    var ctx = canvas.getContext('2d');

    var isPng = file.type === 'image/png';
    var isWebp = file.type === 'image/webp';
    var mimeType = isPng ? 'image/png' : isWebp ? 'image/webp' : 'image/jpeg';

    if (!isPng) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, newW, newH);
    }

    ctx.drawImage(img, 0, 0, newW, newH);

    return new Promise(function (resolve, reject) {
      canvas.toBlob(
        function (blob) {
          if (blob) {
            var config = window.TOOL_CONFIG;
            if (config) {
              if (isPng) config.output_extension = '.png';
              else if (isWebp) config.output_extension = '.webp';
              else config.output_extension = '.jpg';
            }
            resolve(blob);
          } else {
            reject(new Error('Failed to resize image.'));
          }
        },
        mimeType,
        0.92
      );
    });
  }
})();
