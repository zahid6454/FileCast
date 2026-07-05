window.convertFile = function(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function() {
      try {
        var buffer = reader.result;
        var ifds = UTIF.decode(buffer);
        if (!ifds || ifds.length === 0) {
          reject(new Error('Could not read TIFF file. The file may be corrupted.'));
          return;
        }
        UTIF.decodeImage(buffer, ifds[0]);
        var rgba = UTIF.toRGBA8(ifds[0]);
        var width = ifds[0].width;
        var height = ifds[0].height;
        var tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        var tempCtx = tempCanvas.getContext('2d');
        var imageData = tempCtx.createImageData(width, height);
        imageData.data.set(new Uint8Array(rgba));
        tempCtx.putImageData(imageData, 0, 0);
        var canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(tempCanvas, 0, 0);
        canvas.toBlob(function(blob) {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to convert image'));
          }
        }, 'image/jpeg', 0.92);
      } catch (e) {
        reject(new Error('Failed to decode TIFF file: ' + e.message));
      }
    };
    reader.onerror = function() {
      reject(new Error('Failed to read file'));
    };
    reader.readAsArrayBuffer(file);
  });
};
