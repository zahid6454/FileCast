(function () {
  'use strict';

  // Page-grid preview (Tool Preview/Interaction Redesign §4) — shared-page-grid.js
  // (loaded before this file, see pdf-organize.yaml's shared_js) owns the
  // drag/keyboard-to-reorder thumbnail UI entirely; this just keeps #opt-order in
  // sync with the grid's order so convertFile() below needs no changes at all.
  // Absent (window.FCPageGrid undefined) in the worker-level unit tests, which
  // eval this file alone — guarded so those keep exercising the plain text box.
  if (window.FCPageGrid) {
    window.FCPageGrid.init({
      mode: 'organize',
      onChange: function (spec) {
        var orderEl = document.getElementById('opt-order');
        if (orderEl) orderEl.value = spec;
      }
    });
  }

  var activeWorker = null;

  window.cancelConversion = function () {
    if (activeWorker) {
      activeWorker.terminate();
      activeWorker = null;
    }
  };

  window.convertFile = function (file) {
    var orderEl = document.getElementById('opt-order');
    var order = orderEl ? orderEl.value : '';
    if (!order.trim()) {
      return Promise.reject(new Error('Please enter the new page order (e.g. "3,1,2,4").'));
    }

    var config = window.TOOL_CONFIG || {};
    if (!config.pdf_lib_worker_src || !config.pdf_lib_src) {
      return Promise.reject(
        new Error('Organize is unavailable right now. Please refresh the page.')
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
            reject(new Error(data.error || 'This PDF could not be reordered.'));
          }
        };

        worker.onerror = function (err) {
          activeWorker = null;
          worker.terminate();
          reject(new Error((err && err.message) || 'This PDF could not be reordered.'));
        };

        worker.postMessage({ op: 'organize', file: bytes, order: order }, [bytes]);
      });
    });
  };
})();
