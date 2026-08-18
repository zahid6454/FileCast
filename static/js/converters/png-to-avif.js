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
    if (!config.avif_worker_src || !config.avif_lib_src || !config.avif_wasm_src) {
      return Promise.reject(
        new Error('Conversion is unavailable right now. Please refresh the page.')
      );
    }

    var quality = 65;
    var slider = document.getElementById('opt-quality');
    if (slider) quality = parseInt(slider.value, 10) || 65;
    // libavif/AOM quantizer: 0 (best, slow) - 63 (worst, fast). See
    // avif-worker.js for the matching chroma-subsampling choice.
    var quantizer = Math.max(0, Math.min(63, Math.round((100 - quality) * 0.55)));

    return loadImageData(file).then(function (imageData) {
      return new Promise(function (resolve, reject) {
        var worker = new Worker(
          config.avif_worker_src +
            '?lib=' +
            encodeURIComponent(config.avif_lib_src) +
            '&wasm=' +
            encodeURIComponent(config.avif_wasm_src)
        );
        activeWorker = worker;

        worker.onmessage = function (e) {
          activeWorker = null;
          worker.terminate();
          var data = e.data || {};
          if (!data.ok) {
            reject(new Error(data.error || 'Could not encode this image as AVIF.'));
            return;
          }
          resolve(new Blob([data.avif], { type: 'image/avif' }));
        };

        worker.onerror = function (err) {
          activeWorker = null;
          worker.terminate();
          reject(new Error((err && err.message) || 'Could not encode this image as AVIF.'));
        };

        // Canvas ImageData is always 4 channels (RGBA) — PNG transparency,
        // if any, carries straight through to the encoded AVIF.
        var rgba = imageData.data.buffer;
        worker.postMessage(
          {
            type: 'encode',
            rgba: rgba,
            width: imageData.width,
            height: imageData.height,
            channels: 4,
            quantizer: quantizer
          },
          [rgba]
        );
      });
    });
  };

  function loadImageData(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        var imageData;
        try {
          imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        } catch (err) {
          URL.revokeObjectURL(img.src);
          reject(new Error('Failed to read image data'));
          return;
        }
        URL.revokeObjectURL(img.src);
        resolve(imageData);
      };
      img.onerror = function () {
        URL.revokeObjectURL(img.src);
        reject(new Error('Failed to load image'));
      };
      img.src = URL.createObjectURL(file);
    });
  }
})();
