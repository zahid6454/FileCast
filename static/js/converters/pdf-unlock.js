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
    var passwordEl = document.getElementById('opt-password');
    var password = passwordEl ? passwordEl.value : '';

    var config = window.TOOL_CONFIG || {};
    if (!config.pdf_lib_worker_src || !config.pdf_lib_src) {
      return Promise.reject(
        window.FC.errorFromType(
          'Unlock is unavailable right now. Please refresh the page.',
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
                data.error || 'This PDF could not be unlocked.',
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
              (err && err.message) || 'This PDF could not be unlocked.',
              'conversion_error'
            )
          );
        };

        worker.postMessage({ op: 'unlock', file: bytes, password: password }, [bytes]);
      });
    });
  };
})();
