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
    var config = window.TOOL_CONFIG || {};
    if (!config.heic_worker_src || !config.libheif_src || !config.libheif_wasm_src) {
      return Promise.reject(
        new Error('Conversion is unavailable right now. Please refresh the page.')
      );
    }

    return window.FC.materializeFile(file)
      .then(function (safeFile) {
        return safeFile.arrayBuffer();
      })
      .then(function (buffer) {
        return new Promise(function (resolve, reject) {
          var worker = new Worker(
            config.heic_worker_src +
              '?lib=' +
              encodeURIComponent(config.libheif_src) +
              '&wasm=' +
              encodeURIComponent(config.libheif_wasm_src)
          );
          activeWorker = worker;

          worker.onmessage = function (e) {
            activeWorker = null;
            worker.terminate();
            var data = e.data || {};
            if (!data.ok) {
              reject(new Error(data.error || 'Could not decode this HEIC file.'));
              return;
            }
            try {
              resolve(rgbaToWebpBlob(data.rgba, data.width, data.height));
            } catch (err) {
              reject(err);
            }
          };

          worker.onerror = function (err) {
            activeWorker = null;
            worker.terminate();
            reject(new Error((err && err.message) || 'Could not decode this HEIC file.'));
          };

          worker.postMessage(buffer, [buffer]);
        });
      });
  };

  // WebP supports alpha, so the decoded RGBA is painted straight through —
  // no white-background compositing needed (unlike the JPG output tool).
  function rgbaToWebpBlob(rgba, width, height) {
    return new Promise(function (resolve, reject) {
      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      var ctx = canvas.getContext('2d');
      var imageData = ctx.createImageData(width, height);
      imageData.data.set(new Uint8Array(rgba));
      ctx.putImageData(imageData, 0, 0);

      canvas.toBlob(
        function (blob) {
          if (blob) resolve(blob);
          else
            reject(new Error('Failed to convert image. Your browser may not support WebP export.'));
        },
        'image/webp',
        0.9
      );
    });
  }
})();
