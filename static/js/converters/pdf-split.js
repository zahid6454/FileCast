(function () {
  'use strict';

  // Page-grid preview (Tool Preview/Interaction Redesign §7, plus the v2 "at
  // marked points" range mode) — shared-page-grid.js (loaded before this
  // file, see pdf-split.yaml's shared_js) shows a read-only thumbnail strip
  // with two sub-modes: "every page" (default, matches v1 — onChange never
  // fires) and "at marked points" (onChange fires the computed groups on
  // every cut toggle). currentGroups stays null until the visitor marks at
  // least one cut, so an untouched load posts no groups and split() falls
  // back to its own default (every page becomes its own file) — identical to
  // v1 behavior. Absent (window.FCPageGrid undefined) in the worker-level
  // unit tests, which eval this file alone.
  var currentGroups = null;
  if (window.FCPageGrid) {
    window.FCPageGrid.init({
      mode: 'preview',
      onChange: function (groups) {
        currentGroups = Array.isArray(groups) && groups.length ? groups : null;
      }
    });
  }

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
      return Promise.reject(
        window.FC.errorFromType(
          'Split is unavailable right now. Please refresh the page.',
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
          if (!data.ok) {
            reject(
              window.FC.errorFromType(data.error || 'This PDF could not be split.', data.errorType)
            );
            return;
          }
          var blobs = data.result.parts.map(function (part) {
            return {
              blob: new Blob([part.bytes], { type: 'application/pdf' }),
              pageNum: part.pageNum,
              label: part.label
            };
          });
          showSplitResults(blobs, file.name);
          resolve(blobs[0].blob);
        };

        worker.onerror = function (err) {
          activeWorker = null;
          worker.terminate();
          reject(
            window.FC.errorFromType(
              (err && err.message) || 'This PDF could not be split.',
              'conversion_error'
            )
          );
        };

        worker.postMessage({ op: 'split', file: bytes, groups: currentGroups }, [bytes]);
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

    function downloadItem(item) {
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
    }

    var downloadAllBtn = document.createElement('button');
    downloadAllBtn.className = 'btn btn--success';
    downloadAllBtn.textContent = 'Download Splits (' + blobs.length + ')';
    downloadAllBtn.addEventListener('click', function () {
      // ponytail: sequential a.click() downloads, not a zip — browsers may
      // prompt to allow multiple downloads past ~5-10 files. Add JSZip if
      // that becomes a real complaint.
      downloadAllBtn.disabled = true;
      blobs.forEach(function (item, i) {
        setTimeout(function () {
          downloadItem(item);
        }, i * 300);
      });
    });
    actionsEl.appendChild(downloadAllBtn);

    if (resetBtn) actionsEl.appendChild(resetBtn);

    var infoEl = document.getElementById('result-info');
    if (infoEl) {
      infoEl.textContent =
        'Split into ' + blobs.length + ' file' + (blobs.length === 1 ? '' : 's') + '.';
    }
  }
})();
