window.convertFiles = function (files) {
  if (files.length < 2) {
    return Promise.reject(new Error('Please add at least 2 PDF files to merge.'));
  }

  return PDFLib.PDFDocument.create()
    .then(function (mergedPdf) {
      var chain = Promise.resolve();
      files.forEach(function (file) {
        chain = chain
          .then(function () {
            return file.arrayBuffer();
          })
          .then(function (bytes) {
            return PDFLib.PDFDocument.load(bytes);
          })
          .then(function (doc) {
            return mergedPdf.copyPages(doc, doc.getPageIndices());
          })
          .then(function (pages) {
            pages.forEach(function (page) {
              mergedPdf.addPage(page);
            });
          });
      });
      return chain.then(function () {
        return mergedPdf.save();
      });
    })
    .then(function (pdfBytes) {
      return {
        blob: new Blob([pdfBytes], { type: 'application/pdf' }),
        filename: 'merged.pdf'
      };
    });
};
