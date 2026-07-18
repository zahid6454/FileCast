window.convertFile = function (file) {
  var degrees = 90;
  var selectEl = document.getElementById('opt-rotation');
  if (selectEl) {
    degrees = parseInt(selectEl.value, 10) || 90;
  }

  return file
    .arrayBuffer()
    .then(function (bytes) {
      return PDFLib.PDFDocument.load(bytes);
    })
    .then(function (pdfDoc) {
      var pages = pdfDoc.getPages();
      pages.forEach(function (page) {
        var current = page.getRotation().angle;
        page.setRotation(PDFLib.degrees(current + degrees));
      });
      return pdfDoc.save();
    })
    .then(function (pdfBytes) {
      return new Blob([pdfBytes], { type: 'application/pdf' });
    });
};
