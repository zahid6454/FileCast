(function () {
  'use strict';

  // Code 128, subset B only (covers all printable ASCII 32-126 — the vast
  // majority of real-world barcode content: SKUs, product codes,
  // alphanumeric IDs). Subsets A (control chars) and C (digit-pair
  // compression) aren't implemented; subset B alone needs no code-set
  // switching, which keeps the encoder simple and its output unambiguous.
  //
  // CODES[v] is the 11-module bar/space pattern for symbol value v (0-106),
  // '1' = bar, '0' = space, one character per module. Ported from the
  // Code 128 spec's standard symbol table (the same table used by every
  // Code 128 encoder — e.g. the python-barcode library's charsets/code128.py).
  var CODES = [
    '11011001100',
    '11001101100',
    '11001100110',
    '10010011000',
    '10010001100',
    '10001001100',
    '10011001000',
    '10011000100',
    '10001100100',
    '11001001000',
    '11001000100',
    '11000100100',
    '10110011100',
    '10011011100',
    '10011001110',
    '10111001100',
    '10011101100',
    '10011100110',
    '11001110010',
    '11001011100',
    '11001001110',
    '11011100100',
    '11001110100',
    '11101101110',
    '11101001100',
    '11100101100',
    '11100100110',
    '11101100100',
    '11100110100',
    '11100110010',
    '11011011000',
    '11011000110',
    '11000110110',
    '10100011000',
    '10001011000',
    '10001000110',
    '10110001000',
    '10001101000',
    '10001100010',
    '11010001000',
    '11000101000',
    '11000100010',
    '10110111000',
    '10110001110',
    '10001101110',
    '10111011000',
    '10111000110',
    '10001110110',
    '11101110110',
    '11010001110',
    '11000101110',
    '11011101000',
    '11011100010',
    '11011101110',
    '11101011000',
    '11101000110',
    '11100010110',
    '11101101000',
    '11101100010',
    '11100011010',
    '11101111010',
    '11001000010',
    '11110001010',
    '10100110000',
    '10100001100',
    '10010110000',
    '10010000110',
    '10000101100',
    '10000100110',
    '10110010000',
    '10110000100',
    '10011010000',
    '10011000010',
    '10000110100',
    '10000110010',
    '11000010010',
    '11001010000',
    '11110111010',
    '11000010100',
    '10001111010',
    '10100111100',
    '10010111100',
    '10010011110',
    '10111100100',
    '10011110100',
    '10011110010',
    '11110100100',
    '11110010100',
    '11110010010',
    '11011011110',
    '11011110110',
    '11110110110',
    '10101111000',
    '10100011110',
    '10001011110',
    '10111101000',
    '10111100010',
    '11110101000',
    '11110100010',
    '10111011110',
    '10111101110',
    '11101011110',
    '11110101110',
    '11010000100',
    '11010010000',
    '11010011100'
  ];
  // The Code 128 "Stop" symbol is 13 modules: the 11-module stop pattern
  // plus a trailing 2-module termination bar (verified against
  // python-barcode's codex.py, which appends the same literal "11").
  var STOP_PATTERN = '11000111010' + '11';
  var START_B = 104;
  var MIN_CODE = 32;
  var MAX_CODE = 126;

  window.convertText = function (text) {
    var value = (text || '').replace(/\r\n/g, '\n').split('\n')[0];
    if (!value) {
      throw new Error('Enter the text or code you want to turn into a barcode.');
    }
    for (var i = 0; i < value.length; i++) {
      var code = value.charCodeAt(i);
      if (code < MIN_CODE || code > MAX_CODE) {
        throw new Error(
          'Code 128 (subset B) only supports printable ASCII characters (space through ~). ' +
            'Found an unsupported character: ' +
            JSON.stringify(value[i])
        );
      }
    }
    if (value.length > 80) {
      throw new Error('Keep barcode content to 80 characters or fewer for a scannable result.');
    }

    var symbolValues = [START_B];
    for (var j = 0; j < value.length; j++) {
      symbolValues.push(value.charCodeAt(j) - MIN_CODE);
    }

    var checksum = symbolValues[0];
    for (var k = 1; k < symbolValues.length; k++) {
      checksum += k * symbolValues[k];
    }
    checksum = checksum % 103;
    symbolValues.push(checksum);

    var pattern = symbolValues
      .map(function (v) {
        return CODES[v];
      })
      .join('');
    pattern += STOP_PATTERN;

    var svg = renderSvg(pattern, value);
    var base64 = btoa(unescape(encodeURIComponent(svg)));

    return {
      text: 'data:image/svg+xml;base64,' + base64,
      filename: 'barcode.svg'
    };
  };

  function renderSvg(pattern, label) {
    var moduleWidth = 2;
    var barHeight = 90;
    var quietZone = 10 * moduleWidth;
    var labelHeight = 20;
    var width = pattern.length * moduleWidth + quietZone * 2;
    var height = barHeight + labelHeight;

    var bars = '';
    var x = quietZone;
    for (var i = 0; i < pattern.length; i++) {
      if (pattern[i] === '1') {
        bars +=
          '<rect x="' + x + '" y="0" width="' + moduleWidth + '" height="' + barHeight + '"/>';
      }
      x += moduleWidth;
    }

    var escapedLabel = String(label)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      width +
      '" height="' +
      height +
      '" viewBox="0 0 ' +
      width +
      ' ' +
      height +
      '">' +
      '<rect x="0" y="0" width="' +
      width +
      '" height="' +
      height +
      '" fill="#ffffff"/>' +
      '<g fill="#000000">' +
      bars +
      '</g>' +
      '<text x="' +
      width / 2 +
      '" y="' +
      (barHeight + 15) +
      '" font-family="monospace" font-size="14" text-anchor="middle" fill="#000000">' +
      escapedLabel +
      '</text>' +
      '</svg>'
    );
  }
})();
