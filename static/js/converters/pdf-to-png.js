(function () {
  'use strict';

  window.convertFile = function (file) {
    var config = window.TOOL_CONFIG || {};
    if (config.pdf_worker_src) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = config.pdf_worker_src;
    }

    return file
      .arrayBuffer()
      .then(function (bytes) {
        var loadingTask = pdfjsLib.getDocument({ data: bytes });
        return loadingTask.promise;
      })
      .then(function (pdfDoc) {
        var pageCount = pdfDoc.numPages;

        if (pageCount === 1) {
          return renderPage(pdfDoc, 1);
        }

        var chain = Promise.resolve();
        var blobs = [];

        for (var i = 1; i <= pageCount; i++) {
          (function (pageNum) {
            chain = chain
              .then(function () {
                return renderPage(pdfDoc, pageNum);
              })
              .then(function (blob) {
                blobs.push({ blob: blob, pageNum: pageNum });
              });
          })(i);
        }

        return chain.then(function () {
          showMultiPageResults(blobs, file.name);
          return blobs[0].blob;
        });
      });
  };

  function renderPage(pdfDoc, pageNum) {
    return pdfDoc.getPage(pageNum).then(function (page) {
      var scale = 2;
      var viewport = page.getViewport({ scale: scale });
      var canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      var ctx = canvas.getContext('2d');

      return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
        return new Promise(function (resolve, reject) {
          canvas.toBlob(function (blob) {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to render page ' + pageNum));
            }
          }, 'image/png');
        });
      });
    });
  }

  function showMultiPageResults(blobs, originalName) {
    var resultEl = document.getElementById('result');
    if (!resultEl) return;

    var baseName = originalName.replace(/\.pdf$/i, '');
    var actionsEl = resultEl.querySelector('.result__actions');
    if (!actionsEl) return;

    // Take over the result panel: tell shared.js not to overwrite our summary.
    window._converterOwnsResult = true;
    actionsEl.innerHTML = '';

    blobs.forEach(function (item) {
      var btn = document.createElement('button');
      btn.className = 'btn btn--success';
      btn.textContent = 'Page ' + item.pageNum;
      btn.addEventListener('click', function () {
        var url = URL.createObjectURL(item.blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = baseName + '-page' + item.pageNum + '.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 1000);
      });
      actionsEl.appendChild(btn);
    });

    var resetBtn = document.createElement('button');
    resetBtn.className = 'btn btn--primary';
    resetBtn.textContent = 'Convert Another';
    resetBtn.addEventListener('click', function () {
      location.reload();
    });
    actionsEl.appendChild(resetBtn);

    var infoEl = document.getElementById('result-info');
    if (infoEl) {
      infoEl.textContent = blobs.length + ' pages converted to PNG. Click each button to download.';
    }
  }
})();
