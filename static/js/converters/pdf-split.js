(function () {
'use strict';

window.convertFile = function(file) {
  return file.arrayBuffer().then(function(bytes) {
    return PDFLib.PDFDocument.load(bytes);
  }).then(function(srcDoc) {
    var pageCount = srcDoc.getPageCount();
    if (pageCount < 2) {
      return Promise.reject(new Error('This PDF has only one page. There is nothing to split.'));
    }

    var chain = Promise.resolve();
    var blobs = [];

    for (var i = 0; i < pageCount; i++) {
      (function(pageIdx) {
        chain = chain.then(function() {
          return PDFLib.PDFDocument.create();
        }).then(function(newDoc) {
          return newDoc.copyPages(srcDoc, [pageIdx]).then(function(pages) {
            newDoc.addPage(pages[0]);
            return newDoc.save();
          });
        }).then(function(pdfBytes) {
          blobs.push({
            blob: new Blob([pdfBytes], { type: 'application/pdf' }),
            pageNum: pageIdx + 1
          });
        });
      })(i);
    }

    return chain.then(function() {
      showSplitResults(blobs, file.name);
      return blobs[0].blob;
    });
  });
};

function showSplitResults(blobs, originalName) {
  var resultEl = document.getElementById('result');
  if (!resultEl) return;

  var baseName = originalName.replace(/\.pdf$/i, '');
  var actionsEl = resultEl.querySelector('.result__actions');
  if (!actionsEl) return;

  actionsEl.innerHTML = '';

  blobs.forEach(function(item) {
    var btn = document.createElement('button');
    btn.className = 'btn btn--success';
    btn.textContent = 'Page ' + item.pageNum;
    btn.addEventListener('click', function() {
      var url = URL.createObjectURL(item.blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = baseName + '-page' + item.pageNum + '.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
    });
    actionsEl.appendChild(btn);
  });

  var resetBtn = document.createElement('button');
  resetBtn.className = 'btn btn--primary';
  resetBtn.textContent = 'Convert Another';
  resetBtn.addEventListener('click', function() { location.reload(); });
  actionsEl.appendChild(resetBtn);

  var infoEl = document.getElementById('result-info');
  if (infoEl) {
    infoEl.textContent = 'Split into ' + blobs.length + ' pages. Click each button to download.';
  }
}

})();
