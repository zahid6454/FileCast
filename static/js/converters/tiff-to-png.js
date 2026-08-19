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
    if (!config.tiff_worker_src || !config.utif_src) {
      return Promise.reject(
        new Error('Conversion is unavailable right now. Please refresh the page.')
      );
    }

    return file.arrayBuffer().then(function (buffer) {
      return new Promise(function (resolve, reject) {
        var worker = new Worker(
          config.tiff_worker_src + '?lib=' + encodeURIComponent(config.utif_src)
        );
        activeWorker = worker;

        worker.onmessage = function (e) {
          activeWorker = null;
          worker.terminate();
          var data = e.data || {};
          if (!data.ok) {
            reject(new Error(data.error || 'Failed to decode TIFF file.'));
            return;
          }
          try {
            resolve(rgbaToPngBlob(data.rgba, data.width, data.height));
          } catch (err) {
            reject(err);
          }
        };

        worker.onerror = function (err) {
          activeWorker = null;
          worker.terminate();
          reject(new Error((err && err.message) || 'Failed to decode TIFF file.'));
        };

        worker.postMessage(buffer, [buffer]);
      });
    });
  };

  // TIFF's alpha channel (when present) must survive into PNG, so there's no
  // white-fill compositing step here — unlike tiff-to-jpg.js's rgbaToJpegBlob.
  function rgbaToPngBlob(rgba, width, height) {
    return new Promise(function (resolve, reject) {
      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      var ctx = canvas.getContext('2d');
      var imageData = ctx.createImageData(width, height);
      imageData.data.set(new Uint8Array(rgba));
      ctx.putImageData(imageData, 0, 0);

      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('Failed to convert image'));
      }, 'image/png');
    });
  }
})();
