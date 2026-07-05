window.convertFile = function(file) {
  var widthInput = document.getElementById('opt-width');
  var heightInput = document.getElementById('opt-height');
  var targetWidth = widthInput ? parseInt(widthInput.value, 10) : 0;
  var targetHeight = heightInput ? parseInt(heightInput.value, 10) : 0;

  if (!targetWidth && !targetHeight) {
    return Promise.reject(new Error('Please enter a width, height, or both.'));
  }

  return new Promise(function(resolve, reject) {
    var img = new Image();
    img.onload = function() {
      var origW = img.naturalWidth;
      var origH = img.naturalHeight;
      var newW = targetWidth;
      var newH = targetHeight;

      if (newW && !newH) {
        newH = Math.round(origH * (newW / origW));
      } else if (newH && !newW) {
        newW = Math.round(origW * (newH / origH));
      }

      if (newW < 1 || newH < 1) {
        URL.revokeObjectURL(img.src);
        reject(new Error('Resulting dimensions are too small.'));
        return;
      }

      var canvas = document.createElement('canvas');
      canvas.width = newW;
      canvas.height = newH;
      var ctx = canvas.getContext('2d');

      var isPng = file.type === 'image/png';
      var isWebp = file.type === 'image/webp';
      var mimeType = isPng ? 'image/png' : isWebp ? 'image/webp' : 'image/jpeg';

      if (!isPng) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, newW, newH);
      }

      ctx.drawImage(img, 0, 0, newW, newH);

      canvas.toBlob(function(blob) {
        URL.revokeObjectURL(img.src);
        if (blob) {
          var config = window.TOOL_CONFIG;
          if (config) {
            if (isPng) config.output_extension = '.png';
            else if (isWebp) config.output_extension = '.webp';
            else config.output_extension = '.jpg';
          }
          resolve(blob);
        } else {
          reject(new Error('Failed to resize image.'));
        }
      }, mimeType, 0.92);
    };
    img.onerror = function() {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load image.'));
    };
    img.src = URL.createObjectURL(file);
  });
};
