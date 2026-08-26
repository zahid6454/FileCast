(function () {
  'use strict';

  // Shared "page proof" component (Tool Preview/Interaction Redesign §8) —
  // renders page 1 (via pdf-render-worker.js, same as shared-page-grid.js)
  // and draws a live overlay of exactly what the worker will draw, reacting
  // to the tool's own option inputs. Two modes: 'watermark' and
  // 'pageNumbers'. window.convertFile is untouched by this file — it's
  // purely additive UI over an already-correct worker call.
  //
  // shared.js (loaded before this file) never exposes a "file was just
  // selected" hook to converters — same note as image-cropper.js/
  // shared-page-grid.js — so this file wires its own #file-input listener.

  var PROOF_CSS_WIDTH = 480; // a single, larger "proof" page, not a small grid tile
  var MAX_DPR = 2;

  var container = null;
  var viewportEl = null;
  var canvasEl = null;
  var loadingEl = null;

  var opts = null; // { mode: 'watermark' | 'pageNumbers' }
  var session = null; // { file, worker, bitmap, scale, pageWidthPt, pageHeightPt, pageCount }
  var pendingFile = null;

  function q(id) {
    return document.getElementById(id);
  }

  function getExt(name) {
    var m = /\.[^.]+$/.exec(name || '');
    return m ? m[0].toLowerCase() : '';
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
    hint.textContent = 'Preview of page 1 — every page gets the same treatment.';

    container.appendChild(loadingEl);
    container.appendChild(viewportEl);
    container.appendChild(hint);
    fileInfo.parentNode.insertBefore(container, fileInfo.nextSibling);
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
      pageCount: 0
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

    render();
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
  }

  // Mirrors watermark(bytes, text, opacity, fontSize) in pdf-lib-worker.js:
  // centered x/y, fixed 45° rotation, gray fill — neither position nor angle
  // is an exposed option, so the preview only reacts to the three that are.
  // ctx.measureText() approximates pdf-lib's own AFM-table text width (a
  // different, if similar, metric source) — close enough for a live
  // preview whose job is "does this roughly look right," not pixel parity.
  function drawWatermarkOverlay(ctx) {
    var textEl = q('opt-text');
    var opacityEl = q('opt-opacity');
    var fontSizeEl = q('opt-fontSize');
    var text = textEl && textEl.value ? textEl.value : 'CONFIDENTIAL';
    if (!text.trim()) return;

    var opacityPercent = opacityEl ? parseInt(opacityEl.value, 10) : 30;
    var fontSize = fontSizeEl ? parseInt(fontSizeEl.value, 10) : 40;
    if (isNaN(opacityPercent)) opacityPercent = 30;
    if (isNaN(fontSize)) fontSize = 40;

    var scale = session.scale;
    var fontPx = fontSize * scale;

    ctx.save();
    ctx.font = 'bold ' + fontPx + 'px Helvetica, Arial, sans-serif';
    var textWidthPt = ctx.measureText(text).width / scale;
    var xPt = session.pageWidthPt / 2 - textWidthPt / 2;
    var yPt = session.pageHeightPt / 2;
    var xPx = xPt * scale;
    var yPx = (session.pageHeightPt - yPt) * scale; // PDF y grows up; canvas y grows down

    ctx.globalAlpha = Math.max(0, Math.min(1, opacityPercent / 100));
    ctx.fillStyle = 'rgb(128, 128, 128)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.translate(xPx, yPx);
    // pdf-lib's rotate(45) is +45° counter-clockwise in PDF's y-up space —
    // the same visual tilt as CSS/canvas's y-down, clockwise-positive
    // rotate(-45deg): both read bottom-left to top-right.
    ctx.rotate((-45 * Math.PI) / 180);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  // Mirrors pageNumbers(bytes, position, startNumber, format) in
  // pdf-lib-worker.js: fixed fontSize (10pt) and margin (24pt) — neither is
  // an exposed option — with x/y computed from exactly the same 6-way
  // position logic and the same 3-way label format.
  function drawPageNumberOverlay(ctx) {
    var positionEl = q('opt-position');
    var startEl = q('opt-startNumber');
    var formatEl = q('opt-format');
    var position = positionEl ? positionEl.value : 'bottom-center';
    var startNumber = startEl ? parseInt(startEl.value, 10) : 1;
    var format = formatEl ? formatEl.value : 'n';
    if (isNaN(startNumber) || startNumber < 1) startNumber = 1;

    var fontSizePt = 10;
    var marginPt = 24;
    var lastNumber = startNumber + Math.max(1, session.pageCount) - 1;
    var label =
      format === 'page-of-total'
        ? 'Page ' + startNumber + ' of ' + lastNumber
        : format === 'page-n'
          ? 'Page ' + startNumber
          : String(startNumber);

    var scale = session.scale;
    var fontPx = fontSizePt * scale;
    var marginPx = marginPt * scale;

    ctx.save();
    ctx.font = fontPx + 'px Helvetica, Arial, sans-serif';
    var textWidthPx = ctx.measureText(label).width;
    var xPx =
      position.indexOf('left') !== -1
        ? marginPx
        : position.indexOf('right') !== -1
          ? canvasEl.width - marginPx - textWidthPx
          : canvasEl.width / 2 - textWidthPx / 2;
    var yPtFromBottom =
      position.indexOf('top') !== -1 ? session.pageHeightPt - marginPt : marginPt - fontSizePt / 3;
    var yPx = (session.pageHeightPt - yPtFromBottom) * scale;

    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(label, xPx, yPx);
    ctx.restore();
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

      var optionIds =
        opts.mode === 'watermark'
          ? ['opt-text', 'opt-opacity', 'opt-fontSize']
          : ['opt-position', 'opt-startNumber', 'opt-format'];
      optionIds.forEach(function (id) {
        var el = q(id);
        if (!el) return;
        el.addEventListener('input', render);
        el.addEventListener('change', render);
      });
    }
  };
})();
