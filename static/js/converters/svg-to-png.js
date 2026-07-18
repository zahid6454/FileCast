window.convertFile = function (file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () {
      var svgText = reader.result;
      var img = new Image();
      img.onload = function () {
        var width = img.naturalWidth || 1024;
        var height = img.naturalHeight || 1024;
        var canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(function (blob) {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to convert image'));
          }
        }, 'image/png');
        URL.revokeObjectURL(img.src);
      };
      img.onerror = function () {
        URL.revokeObjectURL(img.src);
        reject(new Error('Failed to render SVG. The file may contain unsupported features.'));
      };
      var blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
      img.src = URL.createObjectURL(blob);
    };
    reader.onerror = function () {
      reject(new Error('Failed to read SVG file'));
    };
    reader.readAsText(file);
  });
};
