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

  // Width/Height unit — 'px' (default, exact pixels) or 'percent' (scale
  // relative to the source image, e.g. 50 = half size). Both fields always
  // share one unit; switching converts whatever's currently typed so the
  // visitor's values keep meaning the same output size where possible.
  var unit = 'px';
  var unitToggleEl = null;

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

  // ---------------------------------------------------------------------
  // px / % unit toggle — lives in the #tool-options block (present on page
  // load, before any file is picked), unlike the rest of this file's UI
  // which only exists once ensureUI() runs after a file loads.
  // ---------------------------------------------------------------------
  function ensureUnitToggle() {
    var optionsEl = document.getElementById('tool-options');
    if (!optionsEl || unitToggleEl) return;

    var row = document.createElement('div');
    row.className = 'tool-options__row image-resizer__unit-row';

    var label = document.createElement('span');
    label.className = 'tool-options__label';
    label.textContent = 'Unit';

    var group = document.createElement('div');
    group.className = 'image-resizer__unit-group';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Width/height unit');

    ['px', 'percent'].forEach(function (u) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.textContent = u === 'percent' ? '%' : 'px';
      btn.dataset.unit = u;
      btn.addEventListener('click', function () {
        setUnit(u);
      });
      group.appendChild(btn);
    });

    row.appendChild(label);
    row.appendChild(group);
    optionsEl.appendChild(row);
    unitToggleEl = group;
    syncUnitUI();
  }

  function syncUnitUI() {
    if (!unitToggleEl) return;
    var buttons = unitToggleEl.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var isActive = buttons[i].dataset.unit === unit;
      buttons[i].classList.toggle('chip--active', isActive);
      buttons[i].setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }
    var suffix = unit === 'percent' ? '%' : 'px';
    var maxVal = unit === 'percent' ? '1000' : '10000';
    ['width', 'height'].forEach(function (id) {
      var suffixEl = document.getElementById('suffix-' + id);
      if (suffixEl) suffixEl.textContent = suffix;
      var input = document.getElementById('opt-' + id);
      if (input) input.max = maxVal;
    });
  }

  // Switches unit and converts whatever's currently typed so the fields keep
  // meaning roughly the same output size. Without a loaded image there's no
  // original dimension to convert against, so the raw numbers just carry
  // over as-is (e.g. "50" stays "50") — the visitor will see it re-expressed
  // once render()/convertFile() next run against a real image.
  function setUnit(u) {
    if (u === unit) return;
    var origW = session && session.img ? session.img.naturalWidth : null;
    var origH = session && session.img ? session.img.naturalHeight : null;
    if (origW && origH) {
      var w = parseFloat(widthEl().value);
      var h = parseFloat(heightEl().value);
      if (unit === 'px' && u === 'percent') {
        if (w) widthEl().value = round1((w / origW) * 100);
        if (h) heightEl().value = round1((h / origH) * 100);
      } else if (unit === 'percent' && u === 'px') {
        if (w) widthEl().value = Math.max(1, Math.round((origW * w) / 100));
        if (h) heightEl().value = Math.max(1, Math.round((origH * h) / 100));
      }
    }
    unit = u;
    syncUnitUI();
    render();
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  // Resolves a raw field value (in whatever `unit` currently is) to actual
  // target pixels against one source dimension. Shared by render() (preview)
  // and convertFile() (real output) so both always agree.
  function toPixels(raw, origDimension) {
    if (!raw) return 0;
    return unit === 'percent' ? Math.round((origDimension * raw) / 100) : Math.round(raw);
  }

  ensureUnitToggle();

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
    var w = parseFloat(widthEl().value);
    if (!w || Number.isNaN(w)) return;
    syncing = true;
    // In percent mode a single shared percentage scales both dimensions
    // equally, so the "derived" side is just the same number.
    heightEl().value =
      unit === 'percent'
        ? w
        : Math.max(1, Math.round(session.img.naturalHeight * (w / session.img.naturalWidth)));
    syncing = false;
  }

  function syncFromHeight() {
    if (!locked || !session) return;
    var h = parseFloat(heightEl().value);
    if (!h || Number.isNaN(h)) return;
    syncing = true;
    widthEl().value =
      unit === 'percent'
        ? h
        : Math.max(1, Math.round(session.img.naturalWidth * (h / session.img.naturalHeight)));
    syncing = false;
  }

  // Called whenever the lock turns on, or a new file loads while already
  // locked — re-derives the field the visitor didn't just edit, against
  // whatever's currently in the other field (width wins if both are set).
  function resyncLockedDimensions() {
    if (!locked || !session) return;
    var w = parseFloat(widthEl().value);
    var h = parseFloat(heightEl().value);
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

    var newW = toPixels(parseFloat(widthEl() ? widthEl().value : ''), origW);
    var newH = toPixels(parseFloat(heightEl() ? heightEl().value : ''), origH);
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

  // Reading a picked File exactly once, shared with shared.js's own
  // thumbnail preview, avoids two independent readers racing the same
  // Android Photo Picker content:// reference — see fc-util.js.
  var materialize = window.FC.materializeFile;

  function showLoadError() {
    var errorEl = document.getElementById('error-msg');
    if (errorEl) {
      errorEl.textContent = 'Failed to load image.';
      errorEl.classList.remove('hidden');
    }
  }

  function loadImageForPreview(file) {
    if (!file.type || file.type.indexOf('image/') !== 0) {
      hidePreviewUI();
      return;
    }
    pendingFile = file;
    materialize(file).then(
      function (safeFile) {
        if (pendingFile !== file) return; // superseded by a later selection
        var img = new Image();
        var url = URL.createObjectURL(safeFile);
        img.onload = function () {
          URL.revokeObjectURL(url);
          if (pendingFile !== file) return;
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
          showLoadError();
        };
        img.src = url;
      },
      function () {
        if (pendingFile !== file) return;
        hidePreviewUI();
        showLoadError();
      }
    );
  }

  // ---------------------------------------------------------------------
  // Conversion — unchanged math from before this UI existed (derive the
  // blank side from the ratio, reject a too-small result, keep PNG
  // transparency vs. flatten everything else onto white).
  // ---------------------------------------------------------------------
  window.convertFile = function (file) {
    // Raw values are in whatever unit is currently selected (px or percent);
    // resizeToBlob() resolves them to actual pixels against the image it's
    // given, once it knows that image's dimensions.
    var rawWidth = widthEl() ? parseFloat(widthEl().value) : 0;
    var rawHeight = heightEl() ? parseFloat(heightEl().value) : 0;
    if (!rawWidth && !rawHeight) {
      return Promise.reject(new Error('Please enter a width, height, or both.'));
    }

    if (session && session.file === file) {
      return resizeToBlob(file, session.img, rawWidth, rawHeight);
    }
    // No preview session for this exact file — either convertFile() was
    // called directly, or the preview UI never attached (e.g. this page
    // markup has no #file-info). Load it fresh so the tool still produces a
    // sensible result on its own.
    return materialize(file).then(
      function (safeFile) {
        return new Promise(function (resolve, reject) {
          var img = new Image();
          var url = URL.createObjectURL(safeFile);
          img.onload = function () {
            URL.revokeObjectURL(url);
            resizeToBlob(file, img, rawWidth, rawHeight).then(resolve, reject);
          };
          img.onerror = function () {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image.'));
          };
          img.src = url;
        });
      },
      function () {
        return Promise.reject(new Error('Failed to load image.'));
      }
    );
  };

  function resizeToBlob(file, img, rawWidth, rawHeight) {
    var origW = img.naturalWidth;
    var origH = img.naturalHeight;
    var newW = toPixels(rawWidth, origW);
    var newH = toPixels(rawHeight, origH);

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
