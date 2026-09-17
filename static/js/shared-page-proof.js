(function () {
  'use strict';

  // Shared "page proof" component (Tool Preview/Interaction Redesign §8) —
  // renders page 1 (via pdf-render-worker.js, same as shared-page-grid.js)
  // and draws a live overlay of exactly what the worker will draw. Three
  // modes: 'watermark' (drag a point to reposition the stamp), 'pageNumbers'
  // (read-only, reacts to the tool's own option inputs), and 'crop' (drag/
  // resize a box — same corner+edge-handle interaction as image-cropper.js,
  // adapted to a fixed-size, non-zooming proof canvas — which fully replaces
  // a numeric-margin option input; there is no #opt-margin). Crop's box is
  // also keyboard-operable (arrow keys move it, Shift+arrow keys resize it
  // anchored at its own top-left corner) — unlike image-cropper.js, which
  // has no keyboard path at all, this mode is replacing a fully
  // keyboard-accessible number input, so it needs one of its own rather than
  // regressing to mouse/touch-only. window.convertFile is untouched by this
  // file — it's purely additive UI over an already-correct worker call.
  //
  // shared.js (loaded before this file) never exposes a "file was just
  // selected" hook to converters — same note as image-cropper.js/
  // shared-page-grid.js — so this file wires its own #file-input listener.

  var PROOF_CSS_WIDTH = 480; // a single, larger "proof" page, not a small grid tile
  var MAX_DPR = 2;
  var CROP_MIN_SIZE = 20; // minimum crop rect side, in canvas pixels — mirrors image-cropper.js's MIN_SIZE
  var CROP_HANDLE_HIT_RADIUS = 14; // mirrors image-cropper.js's HANDLE_HIT_RADIUS
  var CROP_HANDLE_DRAW_SIZE = 10;
  var CROP_KEY_STEP = 4; // canvas px per arrow-key press

  var container = null;
  var viewportEl = null;
  var canvasEl = null;
  var loadingEl = null;

  var opts = null; // { mode: 'watermark' | 'pageNumbers' | 'crop' }
  // { file, worker, bitmap, scale, pageWidthPt, pageHeightPt, pageCount,
  //   xPercent, yPercent,                          -- watermark only
  //   cropRect, cropDragMode, cropDragStart, cropRectStart }  -- crop only
  // cropRect is { x, y, w, h } in canvas-pixel space (top-left origin).
  var session = null;
  var pendingFile = null;
  var dragging = false; // watermark only

  function q(id) {
    return document.getElementById(id);
  }

  function getExt(name) {
    var m = /\.[^.]+$/.exec(name || '');
    return m ? m[0].toLowerCase() : '';
  }

  // Mirrors shared-page-grid.js's own announce() — #a11y-status is a global
  // sr-only live region every tool page template already renders.
  function announce(text) {
    var status = q('a11y-status');
    if (status) status.textContent = text;
  }

  // ---------------------------------------------------------------------
  // DOM setup — inserted right after #file-info, same anchor point every
  // other interactive converter UI in this codebase uses.
  // ---------------------------------------------------------------------
  function ensureUI() {
    if (container) return;
    var fileInfo = q('file-info');
    if (!fileInfo || !fileInfo.parentNode) return;

    container = document.createElement('div');
    container.className = 'page-proof hidden';
    container.id = 'page-proof';

    loadingEl = document.createElement('div');
    loadingEl.className = 'page-proof__loading';
    loadingEl.textContent = 'Loading preview…';

    viewportEl = document.createElement('div');
    viewportEl.className = 'page-proof__viewport hidden';
    canvasEl = document.createElement('canvas');
    canvasEl.className = 'page-proof__canvas';
    viewportEl.appendChild(canvasEl);

    var hint = document.createElement('div');
    hint.className = 'page-proof__hint';
    hint.textContent =
      opts.mode === 'crop'
        ? 'Drag inside the box to move it, drag an edge or corner to resize it — every page gets the same treatment.'
        : 'Preview of page 1 — every page gets the same treatment.';

    container.appendChild(loadingEl);
    container.appendChild(viewportEl);
    container.appendChild(hint);
    fileInfo.parentNode.insertBefore(container, fileInfo.nextSibling);

    // Watermark only — drag the stamp to reposition it. Pointer Events unify
    // mouse/touch/pen, same shape as image-cropper.js's own onPointerDown/
    // onPointerMove/onPointerUp.
    if (opts.mode === 'watermark') {
      canvasEl.classList.add('page-proof__canvas--draggable');
      canvasEl.addEventListener('pointerdown', onWatermarkPointerDown);
      canvasEl.addEventListener('pointermove', onWatermarkPointerMove);
      canvasEl.addEventListener('pointerup', onWatermarkPointerUp);
      canvasEl.addEventListener('pointercancel', onWatermarkPointerUp);
    }

    // Crop only — full corner/edge-handle drag-resize, mirroring
    // image-cropper.js's own interaction (see onCropPointerDown/Move/Up
    // below), minus its aspect-ratio presets and zoom (this canvas is a
    // single fixed-size proof render, not a zoomable editor). Also
    // keyboard-operable (see onCropKeyDown) — tabIndex/role/aria-label make
    // it a focusable, announced custom control, since a <canvas> has no
    // interactive semantics of its own.
    if (opts.mode === 'crop') {
      canvasEl.addEventListener('pointerdown', onCropPointerDown);
      canvasEl.addEventListener('pointermove', onCropPointerMove);
      canvasEl.addEventListener('pointerup', onCropPointerUp);
      canvasEl.addEventListener('pointercancel', onCropPointerUp);
      canvasEl.tabIndex = 0;
      canvasEl.setAttribute('role', 'application');
      canvasEl.addEventListener('keydown', onCropKeyDown);
    }
  }

  // ---------------------------------------------------------------------
  // File selection -> load page 1 into the render worker
  // ---------------------------------------------------------------------
  function onFilePicked(file) {
    if (!file || getExt(file.name) !== '.pdf') {
      teardownSession();
      return;
    }
    var config = window.TOOL_CONFIG || {};
    if (!config.pdf_src || !config.pdf_render_worker_src) {
      teardownSession();
      return;
    }

    ensureUI();
    if (!container) return;

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
      bitmap: null,
      scale: 1,
      pageWidthPt: 0,
      pageHeightPt: 0,
      pageCount: 0,
      xPercent: 50, // watermark only — matches the worker's own default (page-center)
      yPercent: 50
    };

    worker.onmessage = function (e) {
      if (pendingFile !== file) return;
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
      if (!data.ok || !session) {
        teardownSession();
        return;
      }
      session.pageCount = data.pageCount;
      var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      session.worker.postMessage({
        op: 'render',
        requestId: 1,
        pageIndex: 0,
        targetWidth: Math.round(PROOF_CSS_WIDTH * dpr)
      });
      return;
    }
    if (data.type === 'rendered') {
      if (!data.ok || !session) {
        teardownSession();
        return;
      }
      onPageRendered(data);
    }
  }

  function onPageRendered(data) {
    hideLoading();
    viewportEl.classList.remove('hidden');
    container.classList.remove('hidden');
    var preview = q('file-preview');
    if (preview) preview.classList.add('hidden');

    // Kept (not .close()'d) — render() below redraws from it on every option
    // change, and ctx.drawImage() doesn't consume/detach an ImageBitmap.
    session.bitmap = data.bitmap;
    session.pageWidthPt = data.pageWidthPt || data.bitmap.width;
    session.pageHeightPt = data.pageHeightPt || data.bitmap.height;
    session.scale = data.bitmap.width / session.pageWidthPt;

    canvasEl.width = data.bitmap.width;
    canvasEl.height = data.bitmap.height;
    canvasEl.style.aspectRatio = data.bitmap.width + ' / ' + data.bitmap.height;

    // A fresh centered 80% box every file pick — same starting point as
    // image-cropper.js's own defaultRect().
    if (opts.mode === 'crop') {
      session.cropRect = {
        x: canvasEl.width * 0.1,
        y: canvasEl.height * 0.1,
        w: canvasEl.width * 0.8,
        h: canvasEl.height * 0.8
      };
    }

    render();
  }

  // ---------------------------------------------------------------------
  // Watermark drag-to-position. canvasCoords() mirrors image-cropper.js's own
  // helper: canvas.getBoundingClientRect() then scaled by
  // canvas.width/height over the CSS box size, since the canvas's internal
  // pixel size (DPR-scaled) and its CSS-rendered size aren't the same number.
  // ---------------------------------------------------------------------
  function canvasCoords(e) {
    var box = canvasEl.getBoundingClientRect();
    var scaleX = box.width ? canvasEl.width / box.width : 1;
    var scaleY = box.height ? canvasEl.height / box.height : 1;
    return {
      x: (e.clientX - box.left) * scaleX,
      y: (e.clientY - box.top) * scaleY
    };
  }

  function onWatermarkPointerDown(e) {
    if (!session || !session.bitmap) return;
    dragging = true;
    if (canvasEl.setPointerCapture) {
      try {
        canvasEl.setPointerCapture(e.pointerId);
      } catch (err) {
        /* pointer capture unsupported — dragging still works */
      }
    }
    updateWatermarkPositionFromPointer(e);
    e.preventDefault();
  }

  function onWatermarkPointerMove(e) {
    if (!dragging || !session || !session.bitmap) return;
    updateWatermarkPositionFromPointer(e);
  }

  function onWatermarkPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    if (canvasEl.releasePointerCapture) {
      try {
        canvasEl.releasePointerCapture(e.pointerId);
      } catch (err) {
        /* no-op */
      }
    }
  }

  // Snaps the watermark's anchor straight to the pointer position — no
  // precise hit-testing against the rotated text needed, simpler and more
  // forgiving than requiring a grab on a diagonal line.
  //
  // The worker's own math centers x on the anchor but anchors y at the text
  // BASELINE (no vertical centering) — snapping yPercent straight to the
  // pointer would put the baseline, not the visual middle, under the cursor,
  // so the text would visually sit high of wherever it was dropped. A fixed
  // vertical offset of half the current font size (in the same
  // "close enough for a live preview" spirit as this file's other
  // approximations) corrects for that, so the text appears centered on the
  // cursor on both axes.
  function updateWatermarkPositionFromPointer(e) {
    var pt = canvasCoords(e);
    var fontSizeEl = q('opt-fontSize');
    var fontSize = fontSizeEl ? parseInt(fontSizeEl.value, 10) : 40;
    if (isNaN(fontSize)) fontSize = 40;

    var verticalOffsetPx = (fontSize * session.scale) / 2;
    var baselineCanvasY = pt.y + verticalOffsetPx;

    session.xPercent = clampPercent((pt.x / canvasEl.width) * 100);
    session.yPercent = clampPercent(((canvasEl.height - baselineCanvasY) / canvasEl.height) * 100);
    render();
  }

  function clampPercent(v) {
    return Math.max(0, Math.min(100, v));
  }

  // ---------------------------------------------------------------------
  // Render — page bitmap + a live overlay of exactly what the worker draws.
  // Redraws the whole canvas from the cached bitmap on every option change
  // (cheap: one drawImage + a few canvas text calls, no re-render needed).
  // ---------------------------------------------------------------------
  function render() {
    if (!session || !session.bitmap) return;
    var ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.drawImage(session.bitmap, 0, 0);
    if (opts.mode === 'watermark') drawWatermarkOverlay(ctx);
    else if (opts.mode === 'pageNumbers') drawPageNumberOverlay(ctx);
    else if (opts.mode === 'crop') drawCropOverlay(ctx);
  }

  // Mirrors watermark(bytes, text, opacity, fontSize, xPercent, yPercent,
  // angleDegrees) in pdf-lib-worker.js: position comes from session.xPercent/
  // yPercent (dragged, or the 50/50 page-center default), rotation from
  // #opt-angle (defaulting to 45, same fallback shape every other option
  // read here already has). ctx.measureText() approximates pdf-lib's own
  // AFM-table text width (a different, if similar, metric source) — close
  // enough for a live preview whose job is "does this roughly look right,"
  // not pixel parity.
  function drawWatermarkOverlay(ctx) {
    var textEl = q('opt-text');
    var opacityEl = q('opt-opacity');
    var fontSizeEl = q('opt-fontSize');
    var angleEl = q('opt-angle');
    var text = textEl && textEl.value ? textEl.value : 'CONFIDENTIAL';
    if (!text.trim()) return;

    var opacityPercent = opacityEl ? parseInt(opacityEl.value, 10) : 30;
    var fontSize = fontSizeEl ? parseInt(fontSizeEl.value, 10) : 40;
    var angle = angleEl ? parseInt(angleEl.value, 10) : 45;
    if (isNaN(opacityPercent)) opacityPercent = 30;
    if (isNaN(fontSize)) fontSize = 40;
    if (isNaN(angle)) angle = 45;

    var scale = session.scale;
    var fontPx = fontSize * scale;

    ctx.save();
    ctx.font = 'bold ' + fontPx + 'px Helvetica, Arial, sans-serif';
    var textWidthPt = ctx.measureText(text).width / scale;
    var xPt = (session.xPercent / 100) * session.pageWidthPt - textWidthPt / 2;
    var yPt = (session.yPercent / 100) * session.pageHeightPt;
    var xPx = xPt * scale;
    var yPx = (session.pageHeightPt - yPt) * scale; // PDF y grows up; canvas y grows down

    ctx.globalAlpha = Math.max(0, Math.min(1, opacityPercent / 100));
    ctx.fillStyle = 'rgb(128, 128, 128)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.translate(xPx, yPx);
    // pdf-lib's rotate(angle) is +angle° counter-clockwise in PDF's y-up
    // space — the same visual tilt as CSS/canvas's y-down, clockwise-positive
    // rotate(-angle deg): both read bottom-left to top-right.
    ctx.rotate((-angle * Math.PI) / 180);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  // pdf-lib-worker.js's pageNumbers() StandardFonts keys -> a canvas font
  // stack that reads the same way (Arial/Times New Roman/Courier New are
  // the closest system fonts to Helvetica/Times/Courier).
  var FONT_CSS_BY_FAMILY = {
    Helvetica: 'Arial, Helvetica, sans-serif',
    HelveticaBold: 'Arial, Helvetica, sans-serif',
    TimesRoman: '"Times New Roman", Times, serif',
    TimesRomanBold: '"Times New Roman", Times, serif',
    Courier: '"Courier New", Courier, monospace',
    CourierBold: '"Courier New", Courier, monospace'
  };
  function isBoldFontFamily(fontFamily) {
    return (
      fontFamily === 'HelveticaBold' ||
      fontFamily === 'TimesRomanBold' ||
      fontFamily === 'CourierBold'
    );
  }

  // Mirrors fitLabelToWidth() in pdf-lib-worker.js's pageNumbers(): shrinks
  // the font until `text` fits maxWidthPx, then truncates with an ellipsis if
  // it still doesn't fit at the floor size, so the preview shows the same
  // "can never overflow the margin" behavior the worker actually produces.
  function fitLabelToWidthPx(ctx, text, cssFamily, bold, startPx, maxWidthPx, floorPx) {
    var size = startPx;
    while (size > floorPx) {
      ctx.font = (bold ? 'bold ' : '') + size + 'px ' + cssFamily;
      if (ctx.measureText(text).width <= maxWidthPx) return { text: text, size: size };
      size -= 1;
    }
    ctx.font = (bold ? 'bold ' : '') + floorPx + 'px ' + cssFamily;
    var truncated = text;
    while (truncated.length > 1 && ctx.measureText(truncated + '…').width > maxWidthPx) {
      truncated = truncated.slice(0, -1);
    }
    return { text: truncated.length < text.length ? truncated + '…' : truncated, size: floorPx };
  }

  // Mirrors pageNumbers(bytes, position, startNumber, format, fontFamily,
  // fontSize, customText) in pdf-lib-worker.js: margin (24pt) is the only
  // thing that isn't an exposed option, with x/y computed from exactly the
  // same 6-way position logic and the same 4-way label format.
  function drawPageNumberOverlay(ctx) {
    var positionEl = q('opt-position');
    var startEl = q('opt-startNumber');
    var formatEl = q('opt-format');
    var fontFamilyEl = q('opt-fontFamily');
    var fontSizeEl = q('opt-fontSize');
    var customTextEl = q('opt-customText');

    var position = positionEl ? positionEl.value : 'bottom-center';
    var startNumber = startEl ? parseInt(startEl.value, 10) : 1;
    var format = formatEl ? formatEl.value : 'n';
    var fontFamily = fontFamilyEl ? fontFamilyEl.value : 'Helvetica';
    var requestedSizePt = fontSizeEl ? parseInt(fontSizeEl.value, 10) : 10;
    var customText = customTextEl ? customTextEl.value : '';
    if (isNaN(startNumber) || startNumber < 1) startNumber = 1;
    if (isNaN(requestedSizePt) || requestedSizePt < 1) requestedSizePt = 10;

    var marginPt = 24;
    var lastNumber = startNumber + Math.max(1, session.pageCount) - 1;
    var label =
      format === 'custom'
        ? customText
        : format === 'page-of-total'
          ? 'Page ' + startNumber + ' of ' + lastNumber
          : format === 'page-n'
            ? 'Page ' + startNumber
            : String(startNumber);
    if (!label) return; // e.g. blank custom text — nothing to preview

    var scale = session.scale;
    var marginPx = marginPt * scale;
    var cssFamily = FONT_CSS_BY_FAMILY[fontFamily] || FONT_CSS_BY_FAMILY.Helvetica;
    var bold = isBoldFontFamily(fontFamily);
    var maxWidthPx = canvasEl.width - marginPx * 2;
    if (maxWidthPx <= 0) return; // page too narrow to fit any margin — mirrors pageNumbers()

    ctx.save();
    var fit = fitLabelToWidthPx(
      ctx,
      label,
      cssFamily,
      bold,
      requestedSizePt * scale,
      maxWidthPx,
      5 * scale
    );
    var fitSizePt = fit.size / scale;
    var textWidthPx = ctx.measureText(fit.text).width;
    var xPx =
      position.indexOf('left') !== -1
        ? marginPx
        : position.indexOf('right') !== -1
          ? canvasEl.width - marginPx - textWidthPx
          : canvasEl.width / 2 - textWidthPx / 2;
    var yPtFromBottom =
      position.indexOf('top') !== -1 ? session.pageHeightPt - marginPt : marginPt - fitSizePt / 3;
    var yPx = (session.pageHeightPt - yPtFromBottom) * scale;

    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(fit.text, xPx, yPx);
    ctx.restore();
  }

  // Canvas-pixel cropRect -> percent-of-page (top-left origin), shared by
  // getCropRect() (what pdf-crop.js reads at Convert time) and the
  // keyboard-accessibility aria-label/announcements below.
  function cropRectToPercent(rect) {
    return {
      xPercent: (rect.x / canvasEl.width) * 100,
      yPercent: (rect.y / canvasEl.height) * 100,
      widthPercent: (rect.w / canvasEl.width) * 100,
      heightPercent: (rect.h / canvasEl.height) * 100
    };
  }

  // Keeps the canvas's aria-label describing the crop box's current state —
  // a screen-reader user tabbing to it (or after any move/resize) needs to
  // hear where it is, since a <canvas> exposes nothing else. Rounded percents
  // are plenty precise for this; getCropRect() (Convert-time) uses the exact
  // float values from cropRectToPercent() instead.
  function updateCropAriaLabel() {
    if (!canvasEl || !session || !session.cropRect) return;
    var pct = cropRectToPercent(session.cropRect);
    canvasEl.setAttribute(
      'aria-label',
      'Crop box: ' +
        Math.round(pct.widthPercent) +
        '% wide, ' +
        Math.round(pct.heightPercent) +
        '% tall, ' +
        Math.round(pct.xPercent) +
        '% from the left, ' +
        Math.round(pct.yPercent) +
        '% from the top. Arrow keys move the box, Shift+arrow keys resize it.'
    );
  }

  // Draws session.cropRect (canvas-pixel space, set by onPageRendered() and
  // moved/resized by the pointer handlers below): dims the discarded area
  // outside the box, outlines the kept area, and draws 4 corner handles —
  // same visual language as image-cropper.js's own render().
  function drawCropOverlay(ctx) {
    var rect = session.cropRect;
    if (!rect) return;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, canvasEl.width, rect.y); // top
    ctx.fillRect(0, rect.y + rect.h, canvasEl.width, canvasEl.height - rect.y - rect.h); // bottom
    ctx.fillRect(0, rect.y, rect.x, rect.h); // left
    ctx.fillRect(rect.x + rect.w, rect.y, canvasEl.width - rect.x - rect.w, rect.h); // right

    ctx.strokeStyle = '#2563EB';
    ctx.lineWidth = Math.max(1, session.scale);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

    ctx.fillStyle = '#2563EB';
    cropCorners(rect).forEach(function (c) {
      ctx.fillRect(
        c.x - CROP_HANDLE_DRAW_SIZE / 2,
        c.y - CROP_HANDLE_DRAW_SIZE / 2,
        CROP_HANDLE_DRAW_SIZE,
        CROP_HANDLE_DRAW_SIZE
      );
    });
    ctx.restore();
    updateCropAriaLabel();
  }

  // ---------------------------------------------------------------------
  // Crop drag/resize — mirrors image-cropper.js's corners()/hitCorner()/
  // hitEdge()/hitTest()/applyResize() exactly (minus its aspect-ratio lock,
  // which this mode doesn't offer), adapted to read/write session.cropRect
  // instead of a module-level session.rect.
  // ---------------------------------------------------------------------
  function cropCorners(rect) {
    return [
      { id: 'tl', x: rect.x, y: rect.y },
      { id: 'tr', x: rect.x + rect.w, y: rect.y },
      { id: 'bl', x: rect.x, y: rect.y + rect.h },
      { id: 'br', x: rect.x + rect.w, y: rect.y + rect.h }
    ];
  }

  function hitCropCorner(pt, rect) {
    var hit = null;
    cropCorners(rect).forEach(function (c) {
      var dx = pt.x - c.x;
      var dy = pt.y - c.y;
      if (Math.sqrt(dx * dx + dy * dy) <= CROP_HANDLE_HIT_RADIUS) hit = c.id;
    });
    return hit;
  }

  function hitCropEdge(pt, rect) {
    var withinX =
      pt.x >= rect.x + CROP_HANDLE_HIT_RADIUS && pt.x <= rect.x + rect.w - CROP_HANDLE_HIT_RADIUS;
    var withinY =
      pt.y >= rect.y + CROP_HANDLE_HIT_RADIUS && pt.y <= rect.y + rect.h - CROP_HANDLE_HIT_RADIUS;

    if (withinX && Math.abs(pt.y - rect.y) <= CROP_HANDLE_HIT_RADIUS) return 'top';
    if (withinX && Math.abs(pt.y - (rect.y + rect.h)) <= CROP_HANDLE_HIT_RADIUS) return 'bottom';
    if (withinY && Math.abs(pt.x - rect.x) <= CROP_HANDLE_HIT_RADIUS) return 'left';
    if (withinY && Math.abs(pt.x - (rect.x + rect.w)) <= CROP_HANDLE_HIT_RADIUS) return 'right';
    return null;
  }

  function insideCropRect(pt, rect) {
    return pt.x >= rect.x && pt.x <= rect.x + rect.w && pt.y >= rect.y && pt.y <= rect.y + rect.h;
  }

  function hitCropTest(pt, rect) {
    var corner = hitCropCorner(pt, rect);
    if (corner) return 'resize-' + corner;
    var edge = hitCropEdge(pt, rect);
    if (edge) return 'resize-' + edge;
    if (insideCropRect(pt, rect)) return 'move';
    return null;
  }

  function cropCursorForMode(mode) {
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

  function clampCrop(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function applyCropResize(mode, start, dx, dy, rect) {
    var left = start.x;
    var top = start.y;
    var right = start.x + start.w;
    var bottom = start.y + start.h;

    if (mode === 'resize-tl' || mode === 'resize-bl' || mode === 'resize-left')
      left = clampCrop(start.x + dx, 0, right - CROP_MIN_SIZE);
    if (mode === 'resize-tr' || mode === 'resize-br' || mode === 'resize-right')
      right = clampCrop(right + dx, left + CROP_MIN_SIZE, canvasEl.width);
    if (mode === 'resize-tl' || mode === 'resize-tr' || mode === 'resize-top')
      top = clampCrop(start.y + dy, 0, bottom - CROP_MIN_SIZE);
    if (mode === 'resize-bl' || mode === 'resize-br' || mode === 'resize-bottom')
      bottom = clampCrop(bottom + dy, top + CROP_MIN_SIZE, canvasEl.height);

    rect.x = left;
    rect.y = top;
    rect.w = right - left;
    rect.h = bottom - top;
  }

  function onCropPointerDown(e) {
    if (!session || !session.cropRect) return;
    var pt = canvasCoords(e);
    var mode = hitCropTest(pt, session.cropRect);
    if (!mode) return;

    session.cropDragMode = mode;
    session.cropDragStart = pt;
    session.cropRectStart = {
      x: session.cropRect.x,
      y: session.cropRect.y,
      w: session.cropRect.w,
      h: session.cropRect.h
    };
    canvasEl.style.cursor = cropCursorForMode(mode);

    if (canvasEl.setPointerCapture) {
      try {
        canvasEl.setPointerCapture(e.pointerId);
      } catch (err) {
        /* pointer capture unsupported — dragging still works */
      }
    }
    e.preventDefault();
  }

  function onCropPointerMove(e) {
    if (!session || !session.cropRect) return;
    var pt = canvasCoords(e);

    if (!session.cropDragMode) {
      canvasEl.style.cursor = cropCursorForMode(hitCropTest(pt, session.cropRect));
      return;
    }

    var dx = pt.x - session.cropDragStart.x;
    var dy = pt.y - session.cropDragStart.y;
    var start = session.cropRectStart;
    var rect = session.cropRect;

    if (session.cropDragMode === 'move') {
      rect.x = clampCrop(start.x + dx, 0, canvasEl.width - start.w);
      rect.y = clampCrop(start.y + dy, 0, canvasEl.height - start.h);
    } else {
      applyCropResize(session.cropDragMode, start, dx, dy, rect);
    }
    render();
  }

  function onCropPointerUp(e) {
    if (!session) return;
    // A pointerdown that never actually hit the box (hitCropTest returned
    // null so cropDragMode was never set — see onCropPointerDown) shouldn't
    // announce a "new" state that never changed.
    var wasDragging = !!session.cropDragMode;
    session.cropDragMode = null;
    if (canvasEl.releasePointerCapture) {
      try {
        canvasEl.releasePointerCapture(e.pointerId);
      } catch (err) {
        /* no-op */
      }
    }
    if (session.cropRect) {
      var pt = canvasCoords(e);
      canvasEl.style.cursor = cropCursorForMode(hitCropTest(pt, session.cropRect));
    }
    if (wasDragging) announceCropChange();
  }

  // Arrow keys move the box (clamped to stay on-canvas); Shift+arrow keys
  // resize it, anchored at its own top-left corner (right/bottom edges move)
  // — the same anchor a bottom-right-corner mouse drag uses. Doesn't cover
  // every corner/edge a mouse can grab, but gives keyboard/screen-reader
  // users the same two core actions (move, resize) a numeric margin input
  // never offered either, unlike the old #opt-margin field this replaced.
  function onCropKeyDown(e) {
    if (!session || !session.cropRect) return;
    var dx = 0;
    var dy = 0;
    if (e.key === 'ArrowLeft') dx = -CROP_KEY_STEP;
    else if (e.key === 'ArrowRight') dx = CROP_KEY_STEP;
    else if (e.key === 'ArrowUp') dy = -CROP_KEY_STEP;
    else if (e.key === 'ArrowDown') dy = CROP_KEY_STEP;
    else return;

    e.preventDefault();
    var rect = session.cropRect;
    if (e.shiftKey) {
      rect.w = clampCrop(rect.w + dx, CROP_MIN_SIZE, canvasEl.width - rect.x);
      rect.h = clampCrop(rect.h + dy, CROP_MIN_SIZE, canvasEl.height - rect.y);
    } else {
      rect.x = clampCrop(rect.x + dx, 0, canvasEl.width - rect.w);
      rect.y = clampCrop(rect.y + dy, 0, canvasEl.height - rect.h);
    }
    render();
    announceCropChange();
  }

  function announceCropChange() {
    if (!session || !session.cropRect) return;
    var pct = cropRectToPercent(session.cropRect);
    announce(
      'Crop box now ' +
        Math.round(pct.widthPercent) +
        '% by ' +
        Math.round(pct.heightPercent) +
        '%, at ' +
        Math.round(pct.xPercent) +
        '% from the left, ' +
        Math.round(pct.yPercent) +
        '% from the top.'
    );
  }

  // ---------------------------------------------------------------------
  // Loading / teardown
  // ---------------------------------------------------------------------
  function showLoading() {
    if (!container) return;
    container.classList.remove('hidden');
    loadingEl.classList.remove('hidden');
    viewportEl.classList.add('hidden');
  }

  function hideLoading() {
    if (loadingEl) loadingEl.classList.add('hidden');
  }

  function teardownWorker() {
    if (session && session.worker) session.worker.terminate();
  }

  function teardownSession() {
    pendingFile = null;
    teardownWorker();
    session = null;
    dragging = false; // an in-progress drag's pointerup/pointercancel may never reach the canvas
    if (container) container.classList.add('hidden');
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------
  window.FCPageProof = {
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

      // Crop has no option inputs at all — the box itself is the only
      // input, dragged directly on the canvas (see onCropPointerDown/Move).
      var optionIds =
        opts.mode === 'watermark'
          ? ['opt-text', 'opt-opacity', 'opt-fontSize', 'opt-angle']
          : opts.mode === 'crop'
            ? []
            : [
                'opt-position',
                'opt-startNumber',
                'opt-format',
                'opt-fontFamily',
                'opt-fontSize',
                'opt-customText'
              ];
      optionIds.forEach(function (id) {
        var el = q(id);
        if (!el) return;
        el.addEventListener('input', render);
        el.addEventListener('change', render);
      });
    },
    // pdf-watermark.js has no natural hidden-input spec to mirror position
    // into (unlike Remove/Extract's page-list string), so it reads this
    // directly at Convert time instead.
    getWatermarkPosition: function () {
      return {
        xPercent: session ? session.xPercent : 50,
        yPercent: session ? session.yPercent : 50
      };
    },
    // pdf-crop.js reads this at Convert time — same "no natural hidden-input
    // spec" reasoning as getWatermarkPosition() above. Percentages are
    // measured from the page's top-left, matching cropRect's own canvas
    // (top-left-origin) coordinate space; pdf-lib-worker.js's crop() is the
    // one place that converts to PDF's bottom-up space. The 10/10/80/80
    // fallback mirrors image-cropper.js's own centered-80%-box default, for
    // when convertFile() runs without ever having rendered a proof (e.g. the
    // worker-level unit tests, which eval pdf-crop.js alone).
    getCropRect: function () {
      if (!session || !session.cropRect || !canvasEl || !canvasEl.width || !canvasEl.height) {
        return { xPercent: 10, yPercent: 10, widthPercent: 80, heightPercent: 80 };
      }
      return cropRectToPercent(session.cropRect);
    }
  };
})();
