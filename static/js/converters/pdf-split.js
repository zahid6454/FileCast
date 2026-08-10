(function () {
  'use strict';

  var activeWorker = null;

  // Local PDF-lib work runs off the main thread now (P4 §36) — terminate()
  // gives the Cancel button (P4 §35) a real abort path, unlike the previous
  // main-thread promise chain which had nothing to cancel.
  window.cancelConversion = function () {
    if (activeWorker) {
      activeWorker.terminate();
      activeWorker = null;
    }
  };

  window.convertFile = function (file) {
    var config = window.TOOL_CONFIG || {};
    if (!config.pdf_lib_worker_src || !config.pdf_lib_src) {
      return Promise.reject(new Error('Split is unavailable right now. Please refresh the page.'));
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
          if (!data.ok) {
            reject(new Error(data.error || 'This PDF could not be split.'));
            return;
          }
          var blobs = data.result.parts.map(function (part) {
            return {
              blob: new Blob([part.bytes], { type: 'application/pdf' }),
              pageNum: part.pageNum
            };
          });
          showSplitResults(blobs, file.name);
          resolve(blobs[0].blob);
        };

        worker.onerror = function (err) {
          activeWorker = null;
          worker.terminate();
          reject(new Error((err && err.message) || 'This PDF could not be split.'));
        };

        worker.postMessage({ op: 'split', file: bytes }, [bytes]);
      });
    });
  };

  function showSplitResults(blobs, originalName) {
    var resultEl = document.getElementById('result');
    if (!resultEl) return;

    var baseName = originalName.replace(/\.pdf$/i, '');
    var actionsEl = resultEl.querySelector('.result__actions');
    if (!actionsEl) return;

    // Take over the result panel: tell shared.js not to overwrite our summary.
    window._converterOwnsResult = true;

    // Keep the real #reset-btn — shared.js's init() already wired it to
    // resetUI() (fires the convert_another GA event, clears currentFile/the
    // file input, returns to the empty state). Rebuilding it here as a new
    // button with location.reload() used to skip all of that and force a
    // full page reload for what should be an in-page reset.
    var resetBtn = document.getElementById('reset-btn');

    actionsEl.innerHTML = '';

    blobs.forEach(function (item) {
      var btn = document.createElement('button');
      btn.className = 'btn btn--success';
      btn.textContent = 'Page ' + item.pageNum;
      btn.addEventListener('click', function () {
        var url = URL.createObjectURL(item.blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = baseName + '-page' + item.pageNum + '.pdf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 1000);
      });
      actionsEl.appendChild(btn);
    });

    if (resetBtn) actionsEl.appendChild(resetBtn);

    var infoEl = document.getElementById('result-info');
    if (infoEl) {
      infoEl.textContent = 'Split into ' + blobs.length + ' pages. Click each button to download.';
    }
  }
})();
