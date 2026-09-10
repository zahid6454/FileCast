(function () {
  'use strict';

  // Page-proof preview (Tool Preview/Interaction Redesign follow-up) —
  // shared-page-proof.js (loaded before this file, see pdf-crop.yaml's
  // shared_js) renders page 1 and lets the visitor drag/resize a crop box
  // directly on it. There is no numeric margin option — the box itself is
  // the only input, read at Convert time via FCPageProof.getCropRect().
  // Absent (window.FCPageProof undefined) in the worker-level unit tests,
  // which eval this file alone.
  if (window.FCPageProof) {
    window.FCPageProof.init({ mode: 'crop' });
  }

  var activeWorker = null;

  window.cancelConversion = function () {
    if (activeWorker) {
      activeWorker.terminate();
      activeWorker = null;
    }
  };

  window.convertFile = function (file) {
    var config = window.TOOL_CONFIG || {};
    if (!config.pdf_lib_worker_src || !config.pdf_lib_src) {
      return Promise.reject(
        window.FC.errorFromType(
          'Crop is unavailable right now. Please refresh the page.',
          'conversion_error'
        )
      );
    }

    // FCPageProof is absent in the worker-level unit tests, which eval this
    // file alone — default to a centered 80% box, matching
    // FCPageProof.getCropRect()'s own no-session fallback.
    var box = window.FCPageProof
      ? window.FCPageProof.getCropRect()
      : { xPercent: 10, yPercent: 10, widthPercent: 80, heightPercent: 80 };

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
                data.error || 'This PDF could not be cropped.',
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
              (err && err.message) || 'This PDF could not be cropped.',
              'conversion_error'
            )
          );
        };

        worker.postMessage(
          {
            op: 'crop',
            file: bytes,
            xPercent: box.xPercent,
            yPercent: box.yPercent,
            widthPercent: box.widthPercent,
            heightPercent: box.heightPercent
          },
          [bytes]
        );
      });
    });
  };
})();
