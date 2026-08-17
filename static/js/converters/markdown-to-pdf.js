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
    var pageSizeEl = document.getElementById('opt-pageSize');
    var pageSize = pageSizeEl ? pageSizeEl.value : 'letter';

    var config = window.TOOL_CONFIG || {};
    if (!config.pdf_lib_worker_src || !config.pdf_lib_src) {
      return Promise.reject(
        new Error('Markdown to PDF is unavailable right now. Please refresh the page.')
      );
    }

    return file.text().then(function (text) {
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
            reject(new Error(data.error || 'This Markdown file could not be converted to PDF.'));
          }
        };

        worker.onerror = function (err) {
          activeWorker = null;
          worker.terminate();
          reject(
            new Error((err && err.message) || 'This Markdown file could not be converted to PDF.')
          );
        };

        worker.postMessage({
          op: 'markdownToPdf',
          text: text,
          pageSize: pageSize
        });
      });
    });
  };
})();
