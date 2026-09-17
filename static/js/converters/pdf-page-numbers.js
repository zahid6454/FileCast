(function () {
  'use strict';

  // Page-proof preview (Tool Preview/Interaction Redesign §10) —
  // shared-page-proof.js (loaded before this file, see
  // pdf-page-numbers.yaml's shared_js) renders page 1 and overlays a live
  // position badge reacting to #opt-position/#opt-startNumber/#opt-format
  // (and, for Custom Text, #opt-fontFamily/#opt-fontSize/#opt-customText).
  // convertFile() below is unchanged — the worker call already matches
  // those options 1:1. Absent (window.FCPageProof undefined) in the
  // worker-level unit tests, which eval this file alone.
  if (window.FCPageProof) {
    window.FCPageProof.init({ mode: 'pageNumbers' });
  }

  // Custom text only means anything when Format is "Custom Text" — Start at
  // (a numbering concept) is meaningless there, and the custom text field is
  // noise for every other format. Toggled on load and on every Format change.
  function updateCustomTextVisibility() {
    var formatEl = document.getElementById('opt-format');
    var startEl = document.getElementById('opt-startNumber');
    var customTextEl = document.getElementById('opt-customText');
    var isCustom = !!formatEl && formatEl.value === 'custom';

    if (startEl) {
      startEl.disabled = isCustom;
    }
    if (customTextEl) {
      var row = customTextEl.closest('.tool-options__row');
      if (row) row.classList.toggle('hidden', !isCustom);
    }
  }

  var formatSelectEl = document.getElementById('opt-format');
  if (formatSelectEl) {
    formatSelectEl.addEventListener('change', updateCustomTextVisibility);
  }
  updateCustomTextVisibility();

  var activeWorker = null;

  window.cancelConversion = function () {
    if (activeWorker) {
      activeWorker.terminate();
      activeWorker = null;
    }
  };

  window.convertFile = function (file) {
    var positionEl = document.getElementById('opt-position');
    var startEl = document.getElementById('opt-startNumber');
    var formatEl = document.getElementById('opt-format');
    var fontFamilyEl = document.getElementById('opt-fontFamily');
    var fontSizeEl = document.getElementById('opt-fontSize');
    var customTextEl = document.getElementById('opt-customText');

    var position = positionEl ? positionEl.value : 'bottom-center';
    var startNumber = startEl ? parseInt(startEl.value, 10) : 1;
    var format = formatEl ? formatEl.value : 'n';
    var fontFamily = fontFamilyEl ? fontFamilyEl.value : 'Helvetica';
    var fontSize = fontSizeEl ? parseInt(fontSizeEl.value, 10) : 10;
    var customText = customTextEl ? customTextEl.value : '';
    if (isNaN(startNumber) || startNumber < 1) startNumber = 1;
    if (isNaN(fontSize) || fontSize < 1) fontSize = 10;

    var config = window.TOOL_CONFIG || {};
    if (!config.pdf_lib_worker_src || !config.pdf_lib_src) {
      return Promise.reject(
        window.FC.errorFromType(
          'Page Numbers is unavailable right now. Please refresh the page.',
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
                data.error || 'Page numbers could not be added to this PDF.',
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
              (err && err.message) || 'Page numbers could not be added to this PDF.',
              'conversion_error'
            )
          );
        };

        worker.postMessage(
          {
            op: 'pageNumbers',
            file: bytes,
            position: position,
            startNumber: startNumber,
            format: format,
            fontFamily: fontFamily,
            fontSize: fontSize,
            customText: customText
          },
          [bytes]
        );
      });
    });
  };
})();
