window.convertFile = function (file) {
  var quality = 75;
  var slider = document.getElementById('opt-quality');
  if (slider) {
    quality = parseInt(slider.value, 10) || 75;
  }

  var maxSizeMB = quality >= 90 ? 10 : quality >= 50 ? 5 : 2;

  var options = {
    maxSizeMB: maxSizeMB,
    maxWidthOrHeight: 4096,
    useWebWorker: true,
    initialQuality: quality / 100,
    fileType: file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  };

  return imageCompression(file, options).then(function (compressedFile) {
    return new Blob([compressedFile], { type: compressedFile.type });
  });
};
