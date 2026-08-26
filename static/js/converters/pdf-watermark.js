(function () {
  'use strict';

  // Page-proof preview (Tool Preview/Interaction Redesign §9, plus
  // drag-to-position + free-rotation) — shared-page-proof.js (loaded before
  // this file, see pdf-watermark.yaml's shared_js) renders page 1 and
  // overlays a live watermark reacting to #opt-text/#opt-opacity/
  // #opt-fontSize/#opt-angle, and lets the visitor drag the stamp to
  // reposition it. convertFile() below reads #opt-angle directly (same
  // pattern as the other options) and FCPageProof.getWatermarkPosition() for
  // the drag position, since there's no hidden input to mirror position into.
  // Absent (window.FCPageProof undefined) in the worker-level unit tests,
  // which eval this file alone.
  if (window.FCPageProof) {
    window.FCPageProof.init({ mode: 'watermark' });
  }

  var activeWorker = null;

  window.cancelConversion = function () {
    if (activeWorker) {
      activeWorker.terminate();
      activeWorker = null;
    }
  };

  window.convertFile = function (file) {
    var textEl = document.getElementById('opt-text');
    var opacityEl = document.getElementById('opt-opacity');
    var fontSizeEl = document.getElementById('opt-fontSize');
    var angleEl = document.getElementById('opt-angle');
    var text = textEl && textEl.value ? textEl.value : 'CONFIDENTIAL';
    var opacityPercent = opacityEl ? parseInt(opacityEl.value, 10) : 30;
    var fontSize = fontSizeEl ? parseInt(fontSizeEl.value, 10) : 40;
    var angle = angleEl ? parseInt(angleEl.value, 10) : 45;
    if (!text.trim()) {
      return Promise.reject(new Error('Please enter watermark text.'));
    }

    var config = window.TOOL_CONFIG || {};
    if (!config.pdf_lib_worker_src || !config.pdf_lib_src) {
      return Promise.reject(
        new Error('Watermark is unavailable right now. Please refresh the page.')
      );
    }

    // FCPageProof is absent in the worker-level unit tests, which eval this
    // file alone — default to page-center, matching the worker's own default.
    var position = window.FCPageProof
      ? window.FCPageProof.getWatermarkPosition()
      : { xPercent: 50, yPercent: 50 };

    return file.arrayBuffer().then(function (bytes) {
      return new Promise(function (resolve, reject) {
        var worker = new Worker(
          config.pdf_lib_worker_src + '?lib=' + encodeURIComponent(config.pdf_lib_src)
        );
        activeWorker = worker;

        worker.onmessage = function (e) {
          activeWorker = null;
          worker.terminate();
          var data = e.data || {};
          if (data.ok) {
            resolve(new Blob([data.result.bytes], { type: 'application/pdf' }));
          } else {
            reject(new Error(data.error || 'This PDF could not be watermarked.'));
          }
        };

        worker.onerror = function (err) {
          activeWorker = null;
          worker.terminate();
          reject(new Error((err && err.message) || 'This PDF could not be watermarked.'));
        };

        worker.postMessage(
          {
            op: 'watermark',
            file: bytes,
            text: text,
            opacity: (isNaN(opacityPercent) ? 30 : opacityPercent) / 100,
            fontSize: isNaN(fontSize) ? 40 : fontSize,
            xPercent: position.xPercent,
            yPercent: position.yPercent,
            angle: isNaN(angle) ? 45 : angle
          },
          [bytes]
        );
      });
    });
  };
})();
