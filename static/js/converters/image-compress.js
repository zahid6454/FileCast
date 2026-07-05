window.convertFile = function(file) {
  var quality = 75;
  var slider = document.getElementById('opt-quality');
  if (slider) {
    quality = parseInt(slider.value, 10) || 75;
  }

  var maxSizeMB = quality >= 90 ? 10 : quality >= 50 ? 5 : 2;
  var outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';

  var options = {
    maxSizeMB: maxSizeMB,
    maxWidthOrHeight: 4096,
    useWebWorker: true,
    initialQuality: quality / 100,
    fileType: outputType
  };

  var config = window.TOOL_CONFIG;
  if (config) {
    if (file.type === 'image/png') config.output_extension = '.png';
    else if (file.type === 'image/webp') config.output_extension = '.webp';
    else config.output_extension = '.jpg';
  }

  return imageCompression(file, options).then(function(compressedFile) {
    return new Blob([compressedFile], { type: compressedFile.type });
  });
};
