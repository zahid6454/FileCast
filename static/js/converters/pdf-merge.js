(function () {
  'use strict';

  var activeWorker = null;

  // Local PDF-lib work runs off the main thread (P4 §36) — terminate() gives
  // the Cancel button (P4 §35) a real abort path, same as pdf-split.js/
  // pdf-rotate.js. Reachable from shared-multi.js's own onCancelClick, not
  // shared.js — this tool is ui_type: multi-file (tool-multi.html).
  window.cancelConversion = function () {
    if (activeWorker) {
      activeWorker.terminate();
      activeWorker = null;
    }
  };

  function runWorker(config, message, transferables) {
    return new Promise(function (resolve, reject) {
      if (!config.pdf_lib_worker_src || !config.pdf_lib_src) {
        reject(new Error('Merge is unavailable right now. Please refresh the page.'));
        return;
      }
      var worker = new Worker(
        config.pdf_lib_worker_src + '?lib=' + encodeURIComponent(config.pdf_lib_src)
      );
      activeWorker = worker;
      worker.onmessage = function (e) {
        activeWorker = null;
        worker.terminate();
        var data = e.data || {};
        if (data.ok) resolve(data.result);
        else reject(new Error(data.error || 'Merge failed.'));
      };
      worker.onerror = function (err) {
        activeWorker = null;
        worker.terminate();
        reject(new Error((err && err.message) || 'Merge failed.'));
      };
      worker.postMessage(message, transferables || []);
    });
  }

  window.convertFiles = function (files) {
    if (files.length < 2) {
      return Promise.reject(new Error('Please add at least 2 PDF files to merge.'));
    }

    var config = window.TOOL_CONFIG || {};
    return Promise.all(
      files.map(function (f) {
        return f.arrayBuffer();
      })
    )
      .then(function (buffers) {
        return runWorker(config, { op: 'merge', files: buffers }, buffers);
      })
      .then(function (result) {
        return {
          blob: new Blob([result.bytes], { type: 'application/pdf' }),
          filename: 'merged.pdf'
        };
      });
  };
})();
