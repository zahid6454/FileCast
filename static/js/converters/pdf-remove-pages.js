(function () {
  'use strict';

  // Page-grid preview (Tool Preview/Interaction Redesign §2) — shared-page-grid.js
  // (loaded before this file, see pdf-remove-pages.yaml's shared_js) owns the
  // click-to-mark thumbnail UI entirely; this just keeps #opt-pages in sync with
  // the grid's selection so convertFile() below needs no changes at all. Absent
  // (window.FCPageGrid undefined) in the worker-level unit tests, which eval
  // this file alone — guarded so those keep exercising the plain text box.
  if (window.FCPageGrid) {
    window.FCPageGrid.init({
      mode: 'remove',
      onChange: function (spec) {
        var pagesEl = document.getElementById('opt-pages');
        if (pagesEl) pagesEl.value = spec;
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
    var pagesEl = document.getElementById('opt-pages');
    var pages = pagesEl ? pagesEl.value : '';
    if (!pages.trim()) {
      return Promise.reject(new Error('Please enter which pages to remove (e.g. "2,4-6").'));
    }

    var config = window.TOOL_CONFIG || {};
    if (!config.pdf_lib_worker_src || !config.pdf_lib_src) {
      return Promise.reject(
        window.FC.errorFromType(
          'Remove is unavailable right now. Please refresh the page.',
          'conversion_error'
        )
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
            reject(
              window.FC.errorFromType(
                data.error || 'Those pages could not be removed.',
                data.errorType
              )
            );
          }
        };

        worker.onerror = function (err) {
          activeWorker = null;
          worker.terminate();
          reject(
            window.FC.errorFromType(
              (err && err.message) || 'Those pages could not be removed.',
              'conversion_error'
            )
          );
        };

        worker.postMessage({ op: 'removePages', file: bytes, pages: pages }, [bytes]);
      });
    });
  };
})();
