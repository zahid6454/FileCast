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
        var chain = Promise.resolve();
        var pageTexts = [];

        for (var i = 1; i <= pageCount; i++) {
          (function (pageNum) {
            chain = chain
              .then(function () {
                return extractPageText(pdfDoc, pageNum);
              })
              .then(function (text) {
                pageTexts.push(text);
              });
          })(i);
        }

        return chain.then(function () {
          var fullText = pageTexts.join('\n\n').trim();
          if (!fullText) {
            throw new Error(
              'No text found in this PDF. It may be a scanned or image-based document with no selectable text.'
            );
          }
          return new Blob([fullText], { type: 'text/plain' });
        });
      });
  };

  function extractPageText(pdfDoc, pageNum) {
    return pdfDoc.getPage(pageNum).then(function (page) {
      return page.getTextContent().then(function (textContent) {
        var text = '';
        textContent.items.forEach(function (item) {
          text += item.str;
          text += item.hasEOL ? '\n' : ' ';
        });
        return text.trim();
      });
    });
  }
})();
