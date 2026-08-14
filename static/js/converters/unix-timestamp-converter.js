(function () {
  'use strict';

  // Heuristic for seconds vs. milliseconds: a millisecond timestamp for any
  // date past ~2001 is already 13 digits; a seconds timestamp doesn't reach
  // that many digits until the year 33658. Treating anything past this
  // threshold as milliseconds matches how every other epoch-converter site
  // handles the same ambiguity.
  var MS_THRESHOLD = 1e12;

  window.convertText = function (text) {
    var lines = text.split('\n');
    var blocks = [];

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].trim();
      if (!raw) continue;
      blocks.push(formatLine(raw, i + 1));
    }

    if (blocks.length === 0) {
      throw new Error('Enter a Unix timestamp or a date to convert.');
    }

    return { text: blocks.join('\n\n'), filename: 'timestamps.txt' };
  };

  function formatLine(raw, lineNumber) {
    var ms;

    if (/^-?\d+$/.test(raw)) {
      var num = Number(raw);
      ms = Math.abs(num) >= MS_THRESHOLD ? num : num * 1000;
    } else {
      var parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error('Line ' + lineNumber + ': "' + raw + '" is not a valid timestamp or date.');
      }
      ms = parsed.getTime();
    }

    var d = new Date(ms);
    return (
      'Input: ' +
      raw +
      '\n' +
      '  Unix (seconds): ' +
      Math.floor(ms / 1000) +
      '\n' +
      '  Unix (ms):      ' +
      ms +
      '\n' +
      '  ISO 8601 (UTC): ' +
      d.toISOString() +
      '\n' +
      '  UTC:            ' +
      d.toUTCString() +
      '\n' +
      '  Local:          ' +
      d.toString()
    );
  }
})();
