(function () {
  'use strict';

  // Page-proof preview (Tool Preview/Interaction Redesign §10) —
  // shared-page-proof.js (loaded before this file, see
  // pdf-page-numbers.yaml's shared_js) renders page 1 and overlays a live
  // position badge reacting to #opt-position/#opt-startNumber/#opt-format.
  // convertFile() below is unchanged — the worker call already matches
  // those three options 1:1. Absent (window.FCPageProof undefined) in the
  // worker-level unit tests, which eval this file alone.
  if (window.FCPageProof) {
    window.FCPageProof.init({ mode: 'pageNumbers' });
  }

  var activeWorker = null;

  window.cancelConversion = function () {
    if (activeWorker) {
      activeWorker.terminate();
      activeWorker = null;
    }
  };

  window.convertFile = function (file) {
    var positionEl = document.getElementById('opt-position');
    var startEl = document.getElementById('opt-startNumber');
    var formatEl = document.getElementById('opt-format');
    var position = positionEl ? positionEl.value : 'bottom-center';
    var startNumber = startEl ? parseInt(startEl.value, 10) : 1;
    var format = formatEl ? formatEl.value : 'n';
    if (isNaN(startNumber) || startNumber < 1) startNumber = 1;

    var config = window.TOOL_CONFIG || {};
    if (!config.pdf_lib_worker_src || !config.pdf_lib_src) {
      return Promise.reject(
        new Error('Page Numbers is unavailable right now. Please refresh the page.')
      );
    }

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
            reject(new Error(data.error || 'Page numbers could not be added to this PDF.'));
          }
        };

        worker.onerror = function (err) {
          activeWorker = null;
          worker.terminate();
          reject(new Error((err && err.message) || 'Page numbers could not be added to this PDF.'));
        };

        worker.postMessage(
          {
            op: 'pageNumbers',
            file: bytes,
            position: position,
            startNumber: startNumber,
            format: format
          },
          [bytes]
        );
      });
    });
  };
})();
