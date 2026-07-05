(function () {
'use strict';

window.convertFiles = function(files) {
  return PDFLib.PDFDocument.create().then(function(pdfDoc) {
    var chain = Promise.resolve();

    files.forEach(function(file) {
      chain = chain.then(function() {
        return embedImage(pdfDoc, file);
      }).then(function(image) {
        var dims = image.scale(1);
        var page = pdfDoc.addPage([dims.width, dims.height]);
        page.drawImage(image, {
          x: 0,
          y: 0,
          width: dims.width,
          height: dims.height
        });
      });
    });

    return chain.then(function() {
      return pdfDoc.save();
    });
  }).then(function(pdfBytes) {
    return {
      blob: new Blob([pdfBytes], { type: 'application/pdf' }),
      filename: 'images.pdf'
    };
  });
};

function embedImage(pdfDoc, file) {
  var ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'png') {
    return file.arrayBuffer().then(function(bytes) {
      return pdfDoc.embedPng(new Uint8Array(bytes));
    });
  }

  if (ext === 'jpg' || ext === 'jpeg') {
    return file.arrayBuffer().then(function(bytes) {
      return pdfDoc.embedJpg(new Uint8Array(bytes));
    });
  }

  return convertToJpgBytes(file).then(function(jpgBytes) {
    return pdfDoc.embedJpg(jpgBytes);
  });
}

function convertToJpgBytes(file) {
  return new Promise(function(resolve, reject) {
    var img = new Image();
    img.onload = function() {
      var canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(function(blob) {
        URL.revokeObjectURL(img.src);
        if (!blob) {
          reject(new Error('Failed to convert image for PDF embedding.'));
          return;
        }
        blob.arrayBuffer().then(function(bytes) {
          resolve(new Uint8Array(bytes));
        });
      }, 'image/jpeg', 0.92);
    };
    img.onerror = function() {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load image: ' + file.name));
    };
    img.src = URL.createObjectURL(file);
  });
}

})();
