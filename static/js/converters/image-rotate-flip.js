(function () {
  'use strict';

  // Interactive UI note: shared.js (loaded before this file) never exposes a
  // "file was just selected" hook to converters — it only calls
  // window.convertFile(file) once, at Convert-button click. So this file
  // wires its own listeners, mirroring the three ways shared.js's own
  // initUploadZone()/initClipboardPaste() accept a file — #file-input
  // 'change', 'drop' on #upload-zone, and a document-level 'paste' — to
  // build a live preview the moment a file is picked, entirely independent
  // of shared.js's own state machine. window.convertFile still returns a
  // Promise<Blob>, the same contract every other converter uses. Same
  // pattern as converters/image-cropper.js (file-input only, today).

  var MAX_DISPLAY_WIDTH = 640;
  var MAX_DISPLAY_HEIGHT = 480;

  var container = null;
  var canvasEl = null;
  var dimsEl = null;

  // The one active preview session (file + loaded Image). Rebuilt whenever a
  // new file is picked; null before any file has been picked. convertFile()
  // reuses session.img for the matching file so the image isn't decoded
  // twice.
  var session = null;

  function ensureUI() {
    if (container) return;
    var fileInfo = document.getElementById('file-info');
    if (!fileInfo || !fileInfo.parentNode) return;

    container = document.createElement('div');
    container.className = 'image-rotate-flip hidden';
    container.id = 'image-rotate-flip';

    canvasEl = document.createElement('canvas');
    canvasEl.className = 'image-rotate-flip__canvas';
    canvasEl.setAttribute('aria-label', 'Live preview of the rotated/flipped image');

    dimsEl = document.createElement('div');
    dimsEl.className = 'image-rotate-flip__dims';

    container.appendChild(canvasEl);
    container.appendChild(dimsEl);
    fileInfo.parentNode.insertBefore(container, fileInfo.nextSibling);
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

  function currentOptions() {
    var rotateEl = document.getElementById('opt-rotate');
    var flipEl = document.getElementById('opt-flip');
    var rotate = rotateEl ? parseInt(rotateEl.value, 10) : 0;
    if (rotate !== 90 && rotate !== 180 && rotate !== 270) rotate = 0;
    var flip = flipEl ? flipEl.value : 'none';
    return { rotate: rotate, flip: flip };
  }

  // Draws img onto ctx (a canvas already sized to canvasW/canvasH) rotated
  // and flipped per the given options. Shared by the live preview and the
  // final full-resolution conversion so both always agree.
  //
  // Canvas transforms compose in reverse call order — scale (the flip)
  // applies to the image's own coordinates first, then rotate, then the
  // translate that positions the rotated+flipped result on the canvas.
  // That's what makes "flip" mirror the source image regardless of which
  // rotation is also selected, instead of mirroring the already-rotated
  // result.
  function drawTransformed(ctx, img, origW, origH, canvasW, canvasH, opts, fillWhite) {
    if (fillWhite) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvasW, canvasH);
    }
    ctx.save();
    ctx.translate(canvasW / 2, canvasH / 2);
    ctx.rotate((opts.rotate * Math.PI) / 180);
    ctx.scale(opts.flip === 'horizontal' ? -1 : 1, opts.flip === 'vertical' ? -1 : 1);
    ctx.drawImage(img, -origW / 2, -origH / 2, origW, origH);
    ctx.restore();
  }

  function render() {
    if (!session || !canvasEl) return;
    var opts = currentOptions();
    var img = session.img;
    var origW = img.naturalWidth;
    var origH = img.naturalHeight;
    var swapped = opts.rotate === 90 || opts.rotate === 270;

    var scale = Math.min(
      1,
      MAX_DISPLAY_WIDTH / (swapped ? origH : origW),
      MAX_DISPLAY_HEIGHT / (swapped ? origW : origH)
    );
    var displayOrigW = Math.max(1, Math.round(origW * scale));
    var displayOrigH = Math.max(1, Math.round(origH * scale));
    var canvasW = swapped ? displayOrigH : displayOrigW;
    var canvasH = swapped ? displayOrigW : displayOrigH;

    canvasEl.width = canvasW;
    canvasEl.height = canvasH;
    var ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, canvasW, canvasH);
    drawTransformed(
      ctx,
      img,
      displayOrigW,
      displayOrigH,
      canvasW,
      canvasH,
      opts,
      session.file.type !== 'image/png'
    );

    if (dimsEl) {
      var outW = swapped ? origH : origW;
      var outH = swapped ? origW : origH;
      dimsEl.textContent = outW + ' × ' + outH + ' px';
    }
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

  // Mirrors shared.js's initClipboardPaste() editable-target guard so a
  // normal text paste into a real input (the feedback textarea, a tool
  // option field) isn't hijacked into building an image preview.
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

  ['opt-rotate', 'opt-flip'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', render);
  });

  // Tracks the most recently picked file so a slower-decoding image from an
  // earlier pick can't win a race against a faster one picked right after it.
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
  // Conversion
  // ---------------------------------------------------------------------
  window.convertFile = function (file) {
    if (session && session.file === file) {
      return transformToBlob(file, session.img);
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
            transformToBlob(file, img).then(resolve, reject);
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

  function transformToBlob(file, img) {
    var opts = currentOptions();
    var origW = img.naturalWidth;
    var origH = img.naturalHeight;
    var swapped = opts.rotate === 90 || opts.rotate === 270;
    var canvasW = swapped ? origH : origW;
    var canvasH = swapped ? origW : origH;

    var canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    var ctx = canvas.getContext('2d');

    var isPng = file.type === 'image/png';
    var isWebp = file.type === 'image/webp';
    var mimeType = isPng ? 'image/png' : isWebp ? 'image/webp' : 'image/jpeg';

    drawTransformed(ctx, img, origW, origH, canvasW, canvasH, opts, !isPng);

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
            reject(new Error('Failed to rotate/flip image.'));
          }
        },
        mimeType,
        0.92
      );
    });
  }
})();
