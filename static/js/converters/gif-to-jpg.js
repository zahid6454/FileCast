window.convertFile = function (file) {
  return window.FC.materializeFile(file).then(function (safeFile) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
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
        reject(
          new Error('This image could not be opened. The file may be damaged or not a valid image.')
        );
      };
      img.src = URL.createObjectURL(safeFile);
    });
  });
};
