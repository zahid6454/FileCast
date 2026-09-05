window.convertFile = function (file) {
  return window.FC.materializeFile(file).then(function (safeFile) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(new Blob([reader.result], { type: 'text/plain' }));
      };
      reader.onerror = function () {
        reject(new Error('Failed to read the image file.'));
      };
      reader.readAsDataURL(safeFile);
    });
  });
};
