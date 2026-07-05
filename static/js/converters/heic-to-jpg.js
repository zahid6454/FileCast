window.convertFile = function(file) {
  return heic2any({
    blob: file,
    toType: 'image/jpeg',
    quality: 0.92
  }).then(function(result) {
    if (Array.isArray(result)) {
      return result[0];
    }
    return result;
  });
};
