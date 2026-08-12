(function () {
  'use strict';

  window.convertText = function (text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error('Invalid JSON: ' + e.message);
    }
    return { text: JSON.stringify(parsed, null, 2), filename: 'formatted.json' };
  };
})();
