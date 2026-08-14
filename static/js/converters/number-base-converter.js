(function () {
  'use strict';

  // BigInt gives arbitrary-precision arithmetic and a built-in toString(base)
  // for any radix 2-36 — no manual bit-twiddling needed, and no precision
  // loss for numbers beyond Number.MAX_SAFE_INTEGER.
  window.convertText = function (text) {
    var lines = text.split('\n');
    var blocks = [];

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].trim();
      if (!raw) continue;
      blocks.push(formatLine(raw, i + 1));
    }

    if (blocks.length === 0) {
      throw new Error('Enter at least one number to convert.');
    }

    return { text: blocks.join('\n\n'), filename: 'number-bases.txt' };
  };

  function formatLine(raw, lineNumber) {
    var value = parseNumber(raw, lineNumber);
    var negative = value < 0n;
    var abs = negative ? -value : value;
    var sign = negative ? '-' : '';

    return (
      'Input: ' +
      raw +
      '\n' +
      '  Binary:  ' +
      sign +
      abs.toString(2) +
      '\n' +
      '  Decimal: ' +
      sign +
      abs.toString(10) +
      '\n' +
      '  Hex:     ' +
      sign +
      abs.toString(16).toUpperCase() +
      '\n' +
      '  Octal:   ' +
      sign +
      abs.toString(8)
    );
  }

  function parseNumber(raw, lineNumber) {
    var trimmed = raw;
    var sign = '';
    if (trimmed.charAt(0) === '-' || trimmed.charAt(0) === '+') {
      sign = trimmed.charAt(0) === '-' ? '-' : '';
      trimmed = trimmed.slice(1);
    }

    var literal;
    if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
      literal = trimmed;
    } else if (/^0b[01]+$/.test(trimmed)) {
      literal = trimmed;
    } else if (/^0o[0-7]+$/.test(trimmed)) {
      literal = trimmed;
    } else if (/^[0-9]+$/.test(trimmed)) {
      literal = trimmed;
    } else if (/^[0-9a-fA-F]+$/.test(trimmed) && /[a-fA-F]/.test(trimmed)) {
      // Contains a hex-only letter (a-f) with no 0x prefix — unambiguous, so
      // treat it as hex rather than rejecting it outright.
      literal = '0x' + trimmed;
    } else {
      throw new Error(
        'Line ' +
          lineNumber +
          ': could not parse "' +
          raw +
          '" as a number. Use plain digits for decimal, or a 0x/0b/0o prefix for hex/binary/octal.'
      );
    }

    try {
      // BigInt()'s string grammar only allows a leading sign before a plain
      // decimal literal, not before a 0x/0b/0o-prefixed one — BigInt('-0xFF')
      // throws even though BigInt('0xFF') is fine. Parsing the literal
      // unsigned and negating the resulting BigInt sidesteps that entirely,
      // so "-0xFF"/"-0b1010"/"-FF" work the same as "-255" does.
      var value = BigInt(literal);
      return sign === '-' ? -value : value;
    } catch (e) {
      throw new Error('Line ' + lineNumber + ': "' + raw + '" is not a valid number.');
    }
  }
})();
