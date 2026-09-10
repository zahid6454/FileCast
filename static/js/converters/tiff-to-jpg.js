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
        window.FC.errorFromType(
          'Conversion is unavailable right now. Please refresh the page.',
          'conversion_error'
        )
      );
    }

    return window.FC.materializeFile(file)
      .then(function (safeFile) {
        return safeFile.arrayBuffer();
      })
      .then(function (buffer) {
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
              reject(
                window.FC.errorFromType(data.error || 'Failed to decode TIFF file.', data.errorType)
              );
              return;
            }
            try {
              resolve(rgbaToJpegBlob(data.rgba, data.width, data.height));
            } catch (err) {
              reject(err);
            }
          };

          worker.onerror = function (err) {
            activeWorker = null;
            worker.terminate();
            reject(
              window.FC.errorFromType(
                (err && err.message) || 'Failed to decode TIFF file.',
                'conversion_error'
              )
            );
          };

          worker.postMessage(buffer, [buffer]);
        });
      });
  };

  // Compositing + JPEG encoding are fast relative to the decode, so this stays
  // on the main thread — a classic Worker has no canvas to do it in anyway.
  function rgbaToJpegBlob(rgba, width, height) {
    return new Promise(function (resolve, reject) {
      var tempCanvas = document.createElement('canvas');
      tempCanvas.width = width;
      tempCanvas.height = height;
      var tempCtx = tempCanvas.getContext('2d');
      var imageData = tempCtx.createImageData(width, height);
      imageData.data.set(new Uint8Array(rgba));
      tempCtx.putImageData(imageData, 0, 0);

      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(tempCanvas, 0, 0);

      canvas.toBlob(
        function (blob) {
          if (blob) resolve(blob);
          else reject(new Error('Failed to convert image'));
        },
        'image/jpeg',
        0.92
      );
    });
  }
})();
