window.convertFile = function (file) {
  return heic2any({
    blob: file,
    toType: 'image/webp',
    quality: 0.9
  }).then(function (result) {
    if (Array.isArray(result)) {
      return result[0];
    }
    return result;
  });
};
