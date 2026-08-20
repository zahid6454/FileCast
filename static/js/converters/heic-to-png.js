window.convertFile = function (file) {
  return heic2any({
    blob: file,
    toType: 'image/png'
  }).then(function (result) {
    if (Array.isArray(result)) {
      return result[0];
    }
    return result;
  });
};
