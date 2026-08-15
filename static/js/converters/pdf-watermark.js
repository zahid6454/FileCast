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
    var textEl = document.getElementById('opt-text');
    var opacityEl = document.getElementById('opt-opacity');
    var fontSizeEl = document.getElementById('opt-fontSize');
    var text = textEl && textEl.value ? textEl.value : 'CONFIDENTIAL';
    var opacityPercent = opacityEl ? parseInt(opacityEl.value, 10) : 30;
    var fontSize = fontSizeEl ? parseInt(fontSizeEl.value, 10) : 40;
    if (!text.trim()) {
      return Promise.reject(new Error('Please enter watermark text.'));
    }

    var config = window.TOOL_CONFIG || {};
    if (!config.pdf_lib_worker_src || !config.pdf_lib_src) {
      return Promise.reject(
        new Error('Watermark is unavailable right now. Please refresh the page.')
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
            fontSize: isNaN(fontSize) ? 40 : fontSize
          },
          [bytes]
        );
      });
    });
  };
})();
