window.convertFile = function (file) {
  return window.FC.materializeFile(file).then(function (safeFile) {
    return heic2any({
      blob: safeFile,
      toType: 'image/png'
    }).then(function (result) {
      if (Array.isArray(result)) {
        return result[0];
      }
      return result;
    });
  });
};
