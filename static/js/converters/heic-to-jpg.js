window.convertFile = function (file) {
  return window.FC.materializeFile(file).then(function (safeFile) {
    return heic2any({
      blob: safeFile,
      toType: 'image/jpeg',
      quality: 0.92
    }).then(function (result) {
      if (Array.isArray(result)) {
        return result[0];
      }
      return result;
    });
  });
};
