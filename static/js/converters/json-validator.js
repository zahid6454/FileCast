(function () {
  'use strict';

  window.convertText = function (text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error('Invalid JSON — ' + describeError(e, text));
    }
    var report = '✓ Valid JSON\n\n' + JSON.stringify(parsed, null, 2);
    return { text: report, filename: 'validation-result.txt' };
  };

  // JSON.parse's native SyntaxError already carries a "position N" offset —
  // this converts that raw character offset into a line/column pair so the
  // error points at somewhere a person can actually find in a multi-line
  // paste, instead of making them count characters.
  function describeError(e, text) {
    var msg = (e && e.message) || 'could not parse input.';
    // Some engines' JSON.parse messages already include their own "(line N
    // column N)" — appending a second one would just be confusing noise.
    if (/\bline\s+\d+/i.test(msg)) return msg;
    var match = /position (\d+)/.exec(msg);
    if (!match) return msg;
    var loc = lineColumnAt(text, Number(match[1]));
    return msg + ' (line ' + loc.line + ', column ' + loc.column + ')';
  }

  function lineColumnAt(text, pos) {
    var line = 1;
    var col = 1;
    var end = Math.min(pos, text.length);
    for (var i = 0; i < end; i++) {
      if (text.charAt(i) === '\n') {
        line++;
        col = 1;
      } else {
        col++;
      }
    }
    return { line: line, column: col };
  }
})();
