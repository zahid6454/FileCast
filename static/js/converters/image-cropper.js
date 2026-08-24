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
  var MIN_ZOOM = 1;
  var MAX_ZOOM = 4;
  var ZOOM_STEP = 0.25;

  var container = null;
  var viewportEl = null;
  var canvasEl = null;
  var dimsEl = null;
  var zoomLabelEl = null;
  var zoomOutBtnEl = null;
  var zoomInBtnEl = null;
  var ratioButtons = []; // [{ value: number|null, el: HTMLButtonElement }], built once in ensureUI()

  // width/height presets. value is null for "Free" (no aspect lock), else a
  // w/h ratio. Persists across file picks so batch-cropping several images
  // to the same ratio doesn't require reselecting it each time.
  var RATIO_PRESETS = [
    { label: 'Free', value: null },
    { label: '1:1', value: 1 },
    { label: '4:3', value: 4 / 3 },
    { label: '3:2', value: 3 / 2 },
    { label: '16:9', value: 16 / 9 },
    { label: '9:16', value: 9 / 16 }
  ];
  var selectedAspect = null;

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
    canvasEl.className = 'image-cropper__canvas image-cropper__canvas--fit';

    viewportEl = document.createElement('div');
    viewportEl.className = 'image-cropper__viewport';
    viewportEl.appendChild(canvasEl);

    var toolbar = document.createElement('div');
    toolbar.className = 'image-cropper__toolbar';

    dimsEl = document.createElement('div');
    dimsEl.className = 'image-cropper__dims';

    var controls = document.createElement('div');
    controls.className = 'image-cropper__controls';

    var ratios = document.createElement('div');
    ratios.className = 'image-cropper__ratios';
    ratioButtons = RATIO_PRESETS.map(function (preset) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'image-cropper__ratio-btn';
      btn.textContent = preset.label;
      btn.addEventListener('click', function () {
        selectRatio(preset.value);
      });
      ratios.appendChild(btn);
      return { value: preset.value, el: btn };
    });

    var zoom = document.createElement('div');
    zoom.className = 'image-cropper__zoom';
    zoomOutBtnEl = document.createElement('button');
    zoomOutBtnEl.type = 'button';
    zoomOutBtnEl.className = 'image-cropper__zoom-btn';
    zoomOutBtnEl.textContent = String.fromCharCode(0x2212); // minus sign
    zoomOutBtnEl.setAttribute('aria-label', 'Zoom out');
    zoomOutBtnEl.addEventListener('click', function () {
      if (session) setZoom(session.zoom - ZOOM_STEP);
    });
    zoomLabelEl = document.createElement('span');
    zoomLabelEl.className = 'image-cropper__zoom-label';
    zoomInBtnEl = document.createElement('button');
    zoomInBtnEl.type = 'button';
    zoomInBtnEl.className = 'image-cropper__zoom-btn';
    zoomInBtnEl.textContent = '+';
    zoomInBtnEl.setAttribute('aria-label', 'Zoom in');
    zoomInBtnEl.addEventListener('click', function () {
      if (session) setZoom(session.zoom + ZOOM_STEP);
    });
    zoom.appendChild(zoomOutBtnEl);
    zoom.appendChild(zoomLabelEl);
    zoom.appendChild(zoomInBtnEl);

    controls.appendChild(ratios);
    controls.appendChild(zoom);

    toolbar.appendChild(dimsEl);
    toolbar.appendChild(controls);

    var hint = document.createElement('div');
    hint.className = 'image-cropper__hint';
    hint.textContent = 'Drag inside the box to move it, drag an edge or corner to resize it.';

    container.appendChild(viewportEl);
    container.appendChild(toolbar);
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

  // Tracks the most recently picked file so a slower-decoding image from an
  // earlier pick can't win a race against a faster one picked right after it
  // — without this, image A's onload firing after image B's would silently
  // replace an in-progress session for B with A's, while shared.js's own
  // file-name/size display (updated synchronously per pick) still shows B.
  var pendingFile = null;

  function loadImageForCrop(file) {
    if (!file.type || file.type.indexOf('image/') !== 0) {
      hideCropUI();
      return;
    }
    pendingFile = file;
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function () {
      URL.revokeObjectURL(url);
      if (pendingFile !== file) return; // superseded by a later selection
      buildSession(file, img);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      if (pendingFile !== file) return;
      hideCropUI();
    };
    img.src = url;
  }

  function buildSession(file, img) {
    ensureUI();
    if (!canvasEl) return; // page markup doesn't have #file-info — nothing to attach to

    var naturalW = img.naturalWidth;
    var naturalH = img.naturalHeight;
    // baseScale is the "fit" scale at 100% zoom; zooming in scales the
    // canvas backing store up from there (see setZoom), up to MAX_ZOOM.
    var baseScale = Math.min(1, MAX_DISPLAY_WIDTH / naturalW, MAX_DISPLAY_HEIGHT / naturalH);
    var displayW = Math.max(1, Math.round(naturalW * baseScale));
    var displayH = Math.max(1, Math.round(naturalH * baseScale));

    canvasEl.width = displayW;
    canvasEl.height = displayH;
    canvasEl.classList.add('image-cropper__canvas--fit');
    canvasEl.style.width = '';
    canvasEl.style.height = '';
    if (viewportEl) viewportEl.scrollLeft = viewportEl.scrollTop = 0;

    var rect = defaultRect(displayW, displayH);
    if (selectedAspect) rect = centeredRectForAspect(selectedAspect, canvasEl, MIN_ZOOM);

    session = {
      file: file,
      img: img,
      canvas: canvasEl,
      ctx: canvasEl.getContext('2d'),
      naturalW: naturalW,
      naturalH: naturalH,
      baseScale: baseScale,
      zoom: MIN_ZOOM,
      scaleX: naturalW / displayW,
      scaleY: naturalH / displayH,
      rect: rect,
      aspect: selectedAspect,
      dragMode: null,
      dragStart: null,
      rectStart: null
    };

    syncRatioButtons();
    updateZoomUI();
    render();
    showCropUI();
  }

  // Rescales the canvas backing store to the given zoom level (1 = the
  // "fit" size computed in buildSession) and rescales the current selection
  // rect to match, so the crop stays anchored to the same image region.
  // Above 100% the canvas renders at true pixel size inside the scrollable
  // viewport rather than being squashed back down by CSS.
  function setZoom(newZoom) {
    if (!session) return;
    newZoom = clamp(Math.round(newZoom * 100) / 100, MIN_ZOOM, MAX_ZOOM);
    if (newZoom === session.zoom) return;

    var canvas = session.canvas;
    var oldW = canvas.width;
    var displayW = Math.max(1, Math.round(session.naturalW * session.baseScale * newZoom));
    var displayH = Math.max(1, Math.round(session.naturalH * session.baseScale * newZoom));
    var factor = displayW / oldW;

    session.rect = {
      x: session.rect.x * factor,
      y: session.rect.y * factor,
      w: session.rect.w * factor,
      h: session.rect.h * factor
    };
    session.zoom = newZoom;
    canvas.width = displayW;
    canvas.height = displayH;
    session.scaleX = session.naturalW / displayW;
    session.scaleY = session.naturalH / displayH;

    var isFit = newZoom === MIN_ZOOM;
    canvas.classList.toggle('image-cropper__canvas--fit', isFit);
    canvas.style.width = isFit ? '' : displayW + 'px';
    canvas.style.height = isFit ? '' : displayH + 'px';

    render();
    updateZoomUI();
    centerViewportOnRect();
  }

  function updateZoomUI() {
    if (!session) return;
    if (zoomLabelEl) zoomLabelEl.textContent = Math.round(session.zoom * 100) + '%';
    if (zoomOutBtnEl) zoomOutBtnEl.disabled = session.zoom <= MIN_ZOOM;
    if (zoomInBtnEl) zoomInBtnEl.disabled = session.zoom >= MAX_ZOOM;
  }

  function centerViewportOnRect() {
    if (!viewportEl || !session) return;
    var rect = session.rect;
    var cx = rect.x + rect.w / 2;
    var cy = rect.y + rect.h / 2;
    viewportEl.scrollLeft = clamp(
      cx - viewportEl.clientWidth / 2,
      0,
      Math.max(0, session.canvas.width - viewportEl.clientWidth)
    );
    viewportEl.scrollTop = clamp(
      cy - viewportEl.clientHeight / 2,
      0,
      Math.max(0, session.canvas.height - viewportEl.clientHeight)
    );
  }

  // The portion of the canvas actually on screen right now, in canvas-pixel
  // space: the scrolled viewport window once zoomed in past 100% (where the
  // canvas outgrows the viewport and scrolling is how the rest is reached),
  // or the whole canvas at 100% (nothing is scrolled/clipped there — the
  // "--fit" CSS class only ever shrinks it uniformly, never crops it).
  function visibleCanvasWindow(canvas, zoom) {
    if (zoom > MIN_ZOOM && viewportEl) {
      return {
        x: viewportEl.scrollLeft,
        y: viewportEl.scrollTop,
        w: Math.min(viewportEl.clientWidth, canvas.width),
        h: Math.min(viewportEl.clientHeight, canvas.height)
      };
    }
    return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  }

  // A rect with the given w/h aspect ratio, covering 80% of whatever is
  // currently visible (see visibleCanvasWindow) and centered within it. The
  // visible window shrinks in natural-image terms as zoom increases — a
  // fixed viewport size maps to fewer and fewer source pixels — so a ratio
  // picked while zoomed in yields a smaller, more precise crop, matching
  // what's actually on screen instead of reusing a size computed for the
  // whole (pre-zoom) canvas.
  function centeredRectForAspect(aspect, canvas, zoom) {
    var win = visibleCanvasWindow(canvas, zoom);
    var cx = win.x + win.w / 2;
    var cy = win.y + win.h / 2;
    var w = win.w * 0.8;
    var h = w / aspect;
    if (h > win.h * 0.8) {
      h = win.h * 0.8;
      w = h * aspect;
    }
    w = clamp(w, MIN_SIZE, canvas.width);
    h = clamp(h, MIN_SIZE, canvas.height);
    return {
      x: clamp(cx - w / 2, 0, Math.max(0, canvas.width - w)),
      y: clamp(cy - h / 2, 0, Math.max(0, canvas.height - h)),
      w: w,
      h: h
    };
  }

  function selectRatio(value) {
    selectedAspect = value;
    syncRatioButtons();
    if (!session) return;
    session.aspect = value;
    if (value) {
      session.rect = centeredRectForAspect(value, session.canvas, session.zoom);
    }
    render();
  }

  function syncRatioButtons() {
    ratioButtons.forEach(function (b) {
      b.el.classList.toggle('is-active', b.value === selectedAspect);
    });
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

    if (dimsEl) {
      var outW = Math.round(rect.w * session.scaleX);
      var outH = Math.round(rect.h * session.scaleY);
      dimsEl.textContent = outW + ' × ' + outH + ' px';
    }
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

  // Edge zones are excluded from the corner band (HANDLE_HIT_RADIUS in from
  // each end) so a point near a corner is claimed by hitCorner, not here.
  function hitEdge(pt, rect) {
    var withinX = pt.x >= rect.x + HANDLE_HIT_RADIUS && pt.x <= rect.x + rect.w - HANDLE_HIT_RADIUS;
    var withinY = pt.y >= rect.y + HANDLE_HIT_RADIUS && pt.y <= rect.y + rect.h - HANDLE_HIT_RADIUS;

    if (withinX && Math.abs(pt.y - rect.y) <= HANDLE_HIT_RADIUS) return 'top';
    if (withinX && Math.abs(pt.y - (rect.y + rect.h)) <= HANDLE_HIT_RADIUS) return 'bottom';
    if (withinY && Math.abs(pt.x - rect.x) <= HANDLE_HIT_RADIUS) return 'left';
    if (withinY && Math.abs(pt.x - (rect.x + rect.w)) <= HANDLE_HIT_RADIUS) return 'right';
    return null;
  }

  function insideRect(pt, rect) {
    return pt.x >= rect.x && pt.x <= rect.x + rect.w && pt.y >= rect.y && pt.y <= rect.y + rect.h;
  }

  // What a pointer at pt would do to rect: a corner or edge handle resizes,
  // the interior moves, and anywhere else (the dimmed area) does nothing.
  function hitTest(pt, rect) {
    var corner = hitCorner(pt, rect);
    if (corner) return 'resize-' + corner;
    var edge = hitEdge(pt, rect);
    if (edge) return 'resize-' + edge;
    if (insideRect(pt, rect)) return 'move';
    return null;
  }

  function cursorForMode(mode) {
    switch (mode) {
      case 'resize-tl':
      case 'resize-br':
        return 'nwse-resize';
      case 'resize-tr':
      case 'resize-bl':
        return 'nesw-resize';
      case 'resize-top':
      case 'resize-bottom':
        return 'ns-resize';
      case 'resize-left':
      case 'resize-right':
        return 'ew-resize';
      case 'move':
        return 'move';
      default:
        return 'default';
    }
  }

  function onPointerDown(e) {
    if (!session) return;
    var pt = canvasCoords(e);
    var mode = hitTest(pt, session.rect);

    if (!mode) {
      session.dragMode = null;
      return;
    }
    session.dragMode = mode;

    session.dragStart = pt;
    session.rectStart = {
      x: session.rect.x,
      y: session.rect.y,
      w: session.rect.w,
      h: session.rect.h
    };
    session.canvas.style.cursor = cursorForMode(mode);

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
    if (!session) return;
    var pt = canvasCoords(e);

    if (!session.dragMode) {
      // Hover only — reflect what a click here would do so the cursor never
      // implies "move" over a handle or "nothing" outside the box.
      session.canvas.style.cursor = cursorForMode(hitTest(pt, session.rect));
      return;
    }

    var dx = pt.x - session.dragStart.x;
    var dy = pt.y - session.dragStart.y;
    var start = session.rectStart;
    var canvas = session.canvas;
    var rect = session.rect;

    if (session.dragMode === 'move') {
      rect.x = clamp(start.x + dx, 0, canvas.width - start.w);
      rect.y = clamp(start.y + dy, 0, canvas.height - start.h);
    } else if (session.aspect) {
      applyAspectResize(session.dragMode, start, pt, session.aspect, canvas, rect);
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

    if (mode === 'resize-tl' || mode === 'resize-bl' || mode === 'resize-left')
      left = clamp(start.x + dx, 0, right - MIN_SIZE);
    if (mode === 'resize-tr' || mode === 'resize-br' || mode === 'resize-right')
      right = clamp(right + dx, left + MIN_SIZE, canvas.width);
    if (mode === 'resize-tl' || mode === 'resize-tr' || mode === 'resize-top')
      top = clamp(start.y + dy, 0, bottom - MIN_SIZE);
    if (mode === 'resize-bl' || mode === 'resize-br' || mode === 'resize-bottom')
      bottom = clamp(bottom + dy, top + MIN_SIZE, canvas.height);

    rect.x = left;
    rect.y = top;
    rect.w = right - left;
    rect.h = bottom - top;
  }

  // Aspect-locked resize: the side/corner opposite the one being dragged
  // stays fixed (the anchor), and the box grows/shrinks toward the pointer
  // while keeping width/height at the locked ratio. For an edge handle,
  // where only one axis is pointer-driven, the derived cross-axis dimension
  // grows symmetrically around the rect's original center on that axis.
  function applyAspectResize(mode, start, pt, aspect, canvas, rect) {
    var x, y, w, h, rawW, rawH, maxW, maxH, anchorX, anchorY;

    if (mode === 'resize-left' || mode === 'resize-right') {
      anchorX = mode === 'resize-left' ? start.x + start.w : start.x;
      rawW = pt.x - anchorX;
      maxW = Math.max(MIN_SIZE, rawW >= 0 ? canvas.width - anchorX : anchorX);
      w = clamp(Math.abs(rawW), MIN_SIZE, maxW);
      h = clamp(w / aspect, MIN_SIZE, canvas.height);
      w = h * aspect;
      x = rawW >= 0 ? anchorX : anchorX - w;
      y = clamp(start.y + start.h / 2 - h / 2, 0, Math.max(0, canvas.height - h));
    } else if (mode === 'resize-top' || mode === 'resize-bottom') {
      anchorY = mode === 'resize-top' ? start.y + start.h : start.y;
      rawH = pt.y - anchorY;
      maxH = Math.max(MIN_SIZE, rawH >= 0 ? canvas.height - anchorY : anchorY);
      h = clamp(Math.abs(rawH), MIN_SIZE, maxH);
      w = clamp(h * aspect, MIN_SIZE, canvas.width);
      h = w / aspect;
      y = rawH >= 0 ? anchorY : anchorY - h;
      x = clamp(start.x + start.w / 2 - w / 2, 0, Math.max(0, canvas.width - w));
    } else {
      anchorX = mode === 'resize-tl' || mode === 'resize-bl' ? start.x + start.w : start.x;
      anchorY = mode === 'resize-tl' || mode === 'resize-tr' ? start.y + start.h : start.y;
      rawW = pt.x - anchorX;
      rawH = pt.y - anchorY;
      maxW = Math.max(MIN_SIZE, rawW >= 0 ? canvas.width - anchorX : anchorX);
      maxH = Math.max(MIN_SIZE, rawH >= 0 ? canvas.height - anchorY : anchorY);

      if (Math.abs(rawW) / aspect >= Math.abs(rawH)) {
        w = clamp(Math.abs(rawW), MIN_SIZE, maxW);
        h = w / aspect;
        if (h > maxH) {
          h = maxH;
          w = h * aspect;
        }
      } else {
        h = clamp(Math.abs(rawH), MIN_SIZE, maxH);
        w = h * aspect;
        if (w > maxW) {
          w = maxW;
          h = w / aspect;
        }
      }
      x = rawW >= 0 ? anchorX : anchorX - w;
      y = rawH >= 0 ? anchorY : anchorY - h;
    }

    rect.x = x;
    rect.y = y;
    rect.w = w;
    rect.h = h;
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
    var pt = canvasCoords(e);
    session.canvas.style.cursor = cursorForMode(hitTest(pt, session.rect));
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
