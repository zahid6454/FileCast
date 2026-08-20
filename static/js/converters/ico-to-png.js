window.convertFile = function (file) {
  return file.arrayBuffer().then(function (buffer) {
    if (buffer.byteLength < 6) {
      throw new Error('This does not look like a valid ICO file.');
    }

    var view = new DataView(buffer);
    var reserved = view.getUint16(0, true);
    var type = view.getUint16(2, true);
    var count = view.getUint16(4, true);
    if (reserved !== 0 || type !== 1 || count === 0) {
      throw new Error('This does not look like a valid ICO file.');
    }

    var best = null;
    var dirOffset = 6;
    for (var i = 0; i < count; i++) {
      if (dirOffset + 16 > buffer.byteLength) break;

      var width = view.getUint8(dirOffset) || 256;
      var height = view.getUint8(dirOffset + 1) || 256;
      var bytesInRes = view.getUint32(dirOffset + 8, true);
      var imageOffset = view.getUint32(dirOffset + 12, true);

      if (!best || width * height > best.width * best.height) {
        best = { width: width, height: height, bytesInRes: bytesInRes, imageOffset: imageOffset };
      }
      dirOffset += 16;
    }

    if (!best || best.imageOffset + best.bytesInRes > buffer.byteLength) {
      throw new Error('Could not read any icon images from this file.');
    }

    var imageBytes = new Uint8Array(buffer, best.imageOffset, best.bytesInRes);
    // Full 8-byte PNG signature, not just the 4-byte "\x89PNG" prefix — the
    // remaining 4 bytes (\r\n\x1a\n) exist specifically to catch line-ending
    // and EOF-transform corruption, so checking all 8 is the correct check
    // even though no other 4-byte-prefix format could plausibly collide here.
    var PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    var isPng =
      imageBytes.length >= PNG_SIGNATURE.length &&
      PNG_SIGNATURE.every(function (byte, i) {
        return imageBytes[i] === byte;
      });

    if (!isPng) {
      throw new Error(
        'This ICO file uses a legacy BMP-format icon image, which is not supported. Only PNG-format ICO files (the modern standard used by browsers and favicon generators) can be converted.'
      );
    }

    return new Blob([imageBytes], { type: 'image/png' });
  });
};
