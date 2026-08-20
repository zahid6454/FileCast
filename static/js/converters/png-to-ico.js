(function () {
  'use strict';

  var ICON_SIZES = [16, 32, 48, 256];

  window.convertFile = function (file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var width = img.naturalWidth;
        var height = img.naturalHeight;
        if (!width || !height) {
          URL.revokeObjectURL(img.src);
          reject(new Error('Failed to read PNG dimensions.'));
          return;
        }

        Promise.all(
          ICON_SIZES.map(function (size) {
            return renderPngAtSize(img, size);
          })
        )
          .then(function (buffers) {
            URL.revokeObjectURL(img.src);
            resolve(buildIco(buffers, ICON_SIZES));
          })
          .catch(function (err) {
            URL.revokeObjectURL(img.src);
            reject(err);
          });
      };
      img.onerror = function () {
        URL.revokeObjectURL(img.src);
        reject(new Error('Failed to load image'));
      };
      img.src = URL.createObjectURL(file);
    });
  };

  function renderPngAtSize(img, size) {
    return new Promise(function (resolve, reject) {
      var canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      canvas.toBlob(function (blob) {
        if (!blob) {
          reject(new Error('Failed to render a ' + size + 'x' + size + ' icon image.'));
          return;
        }
        blob.arrayBuffer().then(resolve, reject);
      }, 'image/png');
    });
  }

  // ICO container: a 6-byte ICONDIR header, one 16-byte ICONDIRENTRY per
  // image, then the raw image bytes back-to-back. Each entry embeds a full
  // PNG (not a legacy BMP/DIB bitmap) — the format every browser and OS has
  // accepted as a favicon/icon since Windows Vista, so no BMP encoding is
  // needed here.
  function buildIco(pngBuffers, sizes) {
    var count = pngBuffers.length;
    var headerSize = 6 + 16 * count;
    var totalSize = headerSize;
    for (var s = 0; s < count; s++) {
      totalSize += pngBuffers[s].byteLength;
    }

    var out = new Uint8Array(totalSize);
    var view = new DataView(out.buffer);

    view.setUint16(0, 0, true); // reserved, must be 0
    view.setUint16(2, 1, true); // type: 1 = icon
    view.setUint16(4, count, true);

    var dirOffset = 6;
    var dataOffset = headerSize;

    for (var i = 0; i < count; i++) {
      var size = sizes[i];
      var buffer = pngBuffers[i];
      var dim = size >= 256 ? 0 : size; // 0 means "256" in the ICO format

      out[dirOffset] = dim; // width
      out[dirOffset + 1] = dim; // height
      out[dirOffset + 2] = 0; // color palette count (0 = no palette)
      out[dirOffset + 3] = 0; // reserved
      view.setUint16(dirOffset + 4, 1, true); // color planes
      view.setUint16(dirOffset + 6, 32, true); // bits per pixel
      view.setUint32(dirOffset + 8, buffer.byteLength, true);
      view.setUint32(dirOffset + 12, dataOffset, true);

      out.set(new Uint8Array(buffer), dataOffset);

      dirOffset += 16;
      dataOffset += buffer.byteLength;
    }

    return new Blob([out], { type: 'image/x-icon' });
  }
})();
