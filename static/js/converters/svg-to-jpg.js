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
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          function (blob) {
            if (blob) {
              resolve(blob);
            } else {
              reject(
                new Error('Could not convert this image. Try a different file or a smaller one.')
              );
            }
          },
          'image/jpeg',
          0.92
        );
        URL.revokeObjectURL(img.src);
      };
      img.onerror = function () {
        URL.revokeObjectURL(img.src);
        reject(new Error('Could not draw this SVG. It may use features browsers cannot display.'));
      };
      var blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
      img.src = URL.createObjectURL(blob);
    };
    reader.onerror = function () {
      reject(new Error('This SVG could not be read. The file may be damaged.'));
    };
    reader.readAsText(file);
  });
};
