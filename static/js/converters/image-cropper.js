(function () {
  'use strict';

  // Interactive UI note: shared.js (loaded before this file) never exposes a
  // "file was just selected" hook to converters — it only calls
  // window.convertFile(file) once, at Convert-button click. So this file
  // wires its own 'change' listener directly on #file-input (present in the
  // server-rendered page before this deferred script runs) to build a crop
  // overlay the moment a file is picked, entirely independent of shared.js's
  // own state machine. window.convertFile still returns a Promise<Blob>, the
  // same contract every other converter uses.

  var MIN_SIZE = 20; // minimum crop rect side, in canvas display pixels
  var HANDLE_HIT_RADIUS = 14; // pointer hit-test radius around a corner, in canvas pixels
  var HANDLE_DRAW_SIZE = 10;
  var MAX_DISPLAY_WIDTH = 640;
  var MAX_DISPLAY_HEIGHT = 480;

  var container = null;
  var canvasEl = null;

  // The one active crop session (file + loaded Image + display canvas +
  // current selection rect, in canvas display-pixel space). Rebuilt whenever
  // a new file is picked; null before any file has been picked.
  var session = null;

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  // A centered rect covering 80% of the given width/height — used both as
  // the interactive UI's starting selection (in display-pixel space) and as
  // the fallback crop when convertFile() is called without an active
  // session for that exact file (in natural-pixel space).
  function defaultRect(width, height) {
    var w = width * 0.8;
    var h = height * 0.8;
    return { x: (width - w) / 2, y: (height - h) / 2, w: w, h: h };
  }

  function corners(rect) {
    return [
      { id: 'tl', x: rect.x, y: rect.y },
      { id: 'tr', x: rect.x + rect.w, y: rect.y },
      { id: 'bl', x: rect.x, y: rect.y + rect.h },
      { id: 'br', x: rect.x + rect.w, y: rect.y + rect.h }
    ];
  }

  // ---------------------------------------------------------------------
  // DOM setup — inserted right after #file-info, the first time a valid
  // image is picked. #file-preview's own thumbnail is hidden once this
  // takes over, so the image only appears once on the page.
  // ---------------------------------------------------------------------
  function ensureUI() {
    if (container) return;
    var fileInfo = document.getElementById('file-info');
    if (!fileInfo || !fileInfo.parentNode) return;

    container = document.createElement('div');
    container.className = 'image-cropper hidden';
    container.id = 'image-cropper';

    canvasEl = document.createElement('canvas');
    canvasEl.className = 'image-cropper__canvas';

    var hint = document.createElement('div');
    hint.className = 'image-cropper__hint';
    hint.textContent = 'Drag inside the box to move it, drag a corner to resize it.';

    container.appendChild(canvasEl);
    container.appendChild(hint);
    fileInfo.parentNode.insertBefore(container, fileInfo.nextSibling);

    canvasEl.addEventListener('pointerdown', onPointerDown);
    canvasEl.addEventListener('pointermove', onPointerMove);
    canvasEl.addEventListener('pointerup', onPointerUp);
    canvasEl.addEventListener('pointercancel', onPointerUp);
  }

  function showCropUI() {
    if (container) container.classList.remove('hidden');
    var preview = document.getElementById('file-preview');
    if (preview) preview.classList.add('hidden');
  }

  function hideCropUI() {
    if (container) container.classList.add('hidden');
    session = null;
  }

  // ---------------------------------------------------------------------
  // File selection -> build the interactive session
  // ---------------------------------------------------------------------
  var fileInputEl = document.getElementById('file-input');
  if (fileInputEl) {
    fileInputEl.addEventListener('change', function () {
      var file = fileInputEl.files && fileInputEl.files[0];
      if (!file) return;
      loadImageForCrop(file);
    });
  }

  var resetBtnEl = document.getElementById('reset-btn');
  if (resetBtnEl) {
    resetBtnEl.addEventListener('click', hideCropUI);
  }

  function loadImageForCrop(file) {
    if (!file.type || file.type.indexOf('image/') !== 0) {
      hideCropUI();
      return;
    }
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function () {
      URL.revokeObjectURL(url);
      buildSession(file, img);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      hideCropUI();
    };
    img.src = url;
  }

  function buildSession(file, img) {
    ensureUI();
    if (!canvasEl) return; // page markup doesn't have #file-info — nothing to attach to

    var naturalW = img.naturalWidth;
    var naturalH = img.naturalHeight;
    var scale = Math.min(1, MAX_DISPLAY_WIDTH / naturalW, MAX_DISPLAY_HEIGHT / naturalH);
    var displayW = Math.max(1, Math.round(naturalW * scale));
    var displayH = Math.max(1, Math.round(naturalH * scale));

    canvasEl.width = displayW;
    canvasEl.height = displayH;

    session = {
      file: file,
      img: img,
      canvas: canvasEl,
      ctx: canvasEl.getContext('2d'),
      scaleX: naturalW / displayW,
      scaleY: naturalH / displayH,
      rect: defaultRect(displayW, displayH),
      dragMode: null,
      dragStart: null,
      rectStart: null
    };

    render();
    showCropUI();
  }

  // ---------------------------------------------------------------------
  // Rendering — image, dimmed overlay outside the selection, and 4 corner
  // handles. The selection area is drawn twice (once as part of the base
  // image, once again on top after clearing the dimming there) rather than
  // using a clip path, which keeps this simple and easy to reason about.
  // ---------------------------------------------------------------------
  function render() {
    if (!session) return;
    var ctx = session.ctx;
    var canvas = session.canvas;
    var img = session.img;
    var rect = session.rect;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();

    ctx.drawImage(
      img,
      rect.x * session.scaleX,
      rect.y * session.scaleY,
      rect.w * session.scaleX,
      rect.h * session.scaleY,
      rect.x,
      rect.y,
      rect.w,
      rect.h
    );

    ctx.strokeStyle = '#2f6fed';
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x + 1, rect.y + 1, Math.max(0, rect.w - 2), Math.max(0, rect.h - 2));

    ctx.fillStyle = '#2f6fed';
    corners(rect).forEach(function (c) {
      ctx.fillRect(
        c.x - HANDLE_DRAW_SIZE / 2,
        c.y - HANDLE_DRAW_SIZE / 2,
        HANDLE_DRAW_SIZE,
        HANDLE_DRAW_SIZE
      );
    });
  }

  // ---------------------------------------------------------------------
  // Pointer interaction — drag inside the rect to move it, drag a corner to
  // resize it. Pointer Events unify mouse/touch/pen with no extra code path.
  // ---------------------------------------------------------------------
  function canvasCoords(e) {
    var canvas = session.canvas;
    var box = canvas.getBoundingClientRect();
    var scaleX = box.width ? canvas.width / box.width : 1;
    var scaleY = box.height ? canvas.height / box.height : 1;
    return {
      x: (e.clientX - box.left) * scaleX,
      y: (e.clientY - box.top) * scaleY
    };
  }

  function hitCorner(pt, rect) {
    var hit = null;
    corners(rect).forEach(function (c) {
      var dx = pt.x - c.x;
      var dy = pt.y - c.y;
      if (Math.sqrt(dx * dx + dy * dy) <= HANDLE_HIT_RADIUS) hit = c.id;
    });
    return hit;
  }

  function insideRect(pt, rect) {
    return pt.x >= rect.x && pt.x <= rect.x + rect.w && pt.y >= rect.y && pt.y <= rect.y + rect.h;
  }

  function onPointerDown(e) {
    if (!session) return;
    var pt = canvasCoords(e);
    var corner = hitCorner(pt, session.rect);

    if (corner) {
      session.dragMode = 'resize-' + corner;
    } else if (insideRect(pt, session.rect)) {
      session.dragMode = 'move';
    } else {
      session.dragMode = null;
      return;
    }

    session.dragStart = pt;
    session.rectStart = {
      x: session.rect.x,
      y: session.rect.y,
      w: session.rect.w,
      h: session.rect.h
    };

    if (session.canvas.setPointerCapture) {
      try {
        session.canvas.setPointerCapture(e.pointerId);
      } catch (err) {
        /* pointer capture unsupported in this environment — dragging still works */
      }
    }
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!session || !session.dragMode) return;
    var pt = canvasCoords(e);
    var dx = pt.x - session.dragStart.x;
    var dy = pt.y - session.dragStart.y;
    var start = session.rectStart;
    var canvas = session.canvas;
    var rect = session.rect;

    if (session.dragMode === 'move') {
      rect.x = clamp(start.x + dx, 0, canvas.width - start.w);
      rect.y = clamp(start.y + dy, 0, canvas.height - start.h);
    } else {
      applyResize(session.dragMode, start, dx, dy, canvas, rect);
    }
    render();
  }

  function applyResize(mode, start, dx, dy, canvas, rect) {
    var left = start.x;
    var top = start.y;
    var right = start.x + start.w;
    var bottom = start.y + start.h;

    if (mode === 'resize-tl' || mode === 'resize-bl')
      left = clamp(start.x + dx, 0, right - MIN_SIZE);
    if (mode === 'resize-tr' || mode === 'resize-br')
      right = clamp(right + dx, left + MIN_SIZE, canvas.width);
    if (mode === 'resize-tl' || mode === 'resize-tr')
      top = clamp(start.y + dy, 0, bottom - MIN_SIZE);
    if (mode === 'resize-bl' || mode === 'resize-br')
      bottom = clamp(bottom + dy, top + MIN_SIZE, canvas.height);

    rect.x = left;
    rect.y = top;
    rect.w = right - left;
    rect.h = bottom - top;
  }

  function onPointerUp(e) {
    if (!session) return;
    session.dragMode = null;
    if (session.canvas.releasePointerCapture) {
      try {
        session.canvas.releasePointerCapture(e.pointerId);
      } catch (err) {
        /* no-op */
      }
    }
  }

  // ---------------------------------------------------------------------
  // Conversion
  // ---------------------------------------------------------------------
  window.convertFile = function (file) {
    if (session && session.file === file) {
      return cropImage(session.file, session.img, session.rect, session.scaleX, session.scaleY);
    }
    // No interactive session for this exact file — either convertFile() was
    // called directly, or the crop UI never attached (e.g. this page markup
    // has no #file-info). Fall back to a fresh centered 80% crop so the
    // tool still produces a sensible result on its own.
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var rect = defaultRect(img.naturalWidth, img.naturalHeight);
        cropImage(file, img, rect, 1, 1).then(resolve, reject);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image.'));
      };
      img.src = url;
    });
  };

  function cropImage(file, img, rect, scaleX, scaleY) {
    var sx = Math.round(rect.x * scaleX);
    var sy = Math.round(rect.y * scaleY);
    var sw = Math.round(rect.w * scaleX);
    var sh = Math.round(rect.h * scaleY);
    if (sw < 1 || sh < 1) return Promise.reject(new Error('Selected crop area is too small.'));

    var canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    var ctx = canvas.getContext('2d');

    var isPng = file.type === 'image/png';
    var isWebp = file.type === 'image/webp';
    var mimeType = isPng ? 'image/png' : isWebp ? 'image/webp' : 'image/jpeg';
    if (!isPng) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, sw, sh);
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

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
            reject(new Error('Failed to crop image.'));
          }
        },
        mimeType,
        0.92
      );
    });
  }
})();
