(function () {
  'use strict';

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
      return Promise.reject(new Error('Please enter which pages to extract (e.g. "1-3,5").'));
    }

    var config = window.TOOL_CONFIG || {};
    if (!config.pdf_lib_worker_src || !config.pdf_lib_src) {
      return Promise.reject(
        new Error('Extract is unavailable right now. Please refresh the page.')
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
            reject(new Error(data.error || 'Those pages could not be extracted.'));
          }
        };

        worker.onerror = function (err) {
          activeWorker = null;
          worker.terminate();
          reject(new Error((err && err.message) || 'Those pages could not be extracted.'));
        };

        worker.postMessage({ op: 'extractPages', file: bytes, pages: pages }, [bytes]);
      });
    });
  };
})();
