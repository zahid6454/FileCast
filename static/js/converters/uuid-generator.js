(function () {
  'use strict';

  var MIN = 1;
  var MAX = 100;

  window.convertText = function (text) {
    var trimmed = (text || '').trim();
    var count = trimmed === '' ? 1 : Number(trimmed);

    if (!Number.isInteger(count)) {
      throw new Error('Enter a whole number between ' + MIN + ' and ' + MAX + '.');
    }
    if (count < MIN || count > MAX) {
      throw new Error('Enter a number between ' + MIN + ' and ' + MAX + '.');
    }
    if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
      throw new Error('UUID generation is not supported in this browser.');
    }

    var uuids = [];
    for (var i = 0; i < count; i++) uuids.push(crypto.randomUUID());

    return { text: uuids.join('\n'), filename: 'uuids.txt' };
  };
})();
