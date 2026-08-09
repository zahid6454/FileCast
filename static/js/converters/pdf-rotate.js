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
    var degrees = 90;
    var selectEl = document.getElementById('opt-rotation');
    if (selectEl) {
      degrees = parseInt(selectEl.value, 10) || 90;
    }

    var config = window.TOOL_CONFIG || {};
    if (!config.pdf_lib_worker_src || !config.pdf_lib_src) {
      return Promise.reject(new Error('Rotate is unavailable right now. Please refresh the page.'));
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
            reject(new Error(data.error || 'This PDF could not be rotated.'));
          }
        };

        worker.onerror = function (err) {
          activeWorker = null;
          worker.terminate();
          reject(new Error((err && err.message) || 'This PDF could not be rotated.'));
        };

        worker.postMessage({ op: 'rotate', file: bytes, degrees: degrees }, [bytes]);
      });
    });
  };
})();
