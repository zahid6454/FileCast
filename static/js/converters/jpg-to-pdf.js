(function () {
  'use strict';

  // Strict subset of image-to-pdf.js, scoped to JPG only — no canvas
  // re-encode fallback is needed since pdf-lib embeds JPG directly.
  window.convertFiles = function (files) {
    return PDFLib.PDFDocument.create()
      .then(function (pdfDoc) {
        var chain = Promise.resolve();
        files.forEach(function (file) {
          chain = chain
            .then(function () {
              return file.arrayBuffer();
            })
            .then(function (bytes) {
              return pdfDoc.embedJpg(new Uint8Array(bytes));
            })
            .then(function (image) {
              var dims = image.scale(1);
              var page = pdfDoc.addPage([dims.width, dims.height]);
              page.drawImage(image, { x: 0, y: 0, width: dims.width, height: dims.height });
            });
        });
        return chain.then(function () {
          return pdfDoc.save();
        });
      })
      .then(function (pdfBytes) {
        return { blob: new Blob([pdfBytes], { type: 'application/pdf' }), filename: 'images.pdf' };
      });
  };
})();
