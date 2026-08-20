window.convertFile = function (file) {
  var rotateEl = document.getElementById('opt-rotate');
  var flipEl = document.getElementById('opt-flip');
  var rotate = rotateEl ? parseInt(rotateEl.value, 10) : 0;
  if (rotate !== 90 && rotate !== 180 && rotate !== 270) rotate = 0;
  var flip = flipEl ? flipEl.value : 'none';

  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () {
      var origW = img.naturalWidth;
      var origH = img.naturalHeight;
      var swapped = rotate === 90 || rotate === 270;
      var canvasW = swapped ? origH : origW;
      var canvasH = swapped ? origW : origH;

      var canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      var ctx = canvas.getContext('2d');

      var isPng = file.type === 'image/png';
      var isWebp = file.type === 'image/webp';
      var mimeType = isPng ? 'image/png' : isWebp ? 'image/webp' : 'image/jpeg';

      if (!isPng) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvasW, canvasH);
      }

      // Canvas transforms compose in reverse call order — scale (the flip)
      // applies to the image's own coordinates first, then rotate, then the
      // translate that positions the rotated+flipped result on the canvas.
      // That's what makes "flip" mirror the source image regardless of
      // which rotation is also selected, instead of mirroring the already-
      // rotated result.
      ctx.save();
      ctx.translate(canvasW / 2, canvasH / 2);
      ctx.rotate((rotate * Math.PI) / 180);
      ctx.scale(flip === 'horizontal' ? -1 : 1, flip === 'vertical' ? -1 : 1);
      ctx.drawImage(img, -origW / 2, -origH / 2, origW, origH);
      ctx.restore();

      canvas.toBlob(
        function (blob) {
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
            reject(new Error('Failed to rotate/flip image.'));
          }
        },
        mimeType,
        0.92
      );
    };
    img.onerror = function () {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load image.'));
    };
    img.src = URL.createObjectURL(file);
  });
};
