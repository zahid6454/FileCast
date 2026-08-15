(function () {
  'use strict';

  // QR Code encoder — Byte mode only (any UTF-8 input is valid; Numeric/
  // Alphanumeric mode packing is skipped for simplicity, at the cost of some
  // capacity efficiency), error correction level M, versions 1-40.
  //
  // Ported from the ISO/IEC 18004 algorithm as implemented by the `qrcode`
  // PyPI package (ported structurally: same tables, same 2-phase mask
  // selection, same module-placement order), then cross-checked against
  // that package's own output for dozens of inputs spanning versions 1
  // through 20+ — see this PR's description for how. RS_BLOCK_TABLE and
  // PATTERN_POSITION_TABLE below are transcribed directly from its source
  // (qrcode/base.py, qrcode/util.py) rather than reconstructed from memory,
  // since those two tables are the ones a QR encoder cannot self-check.

  var EC_LEVEL_M = 0; // BCH format-info field value for error correction level M

  var EXP_TABLE = new Array(256);
  var LOG_TABLE = new Array(256);
  (function initGf() {
    for (var i = 0; i < 8; i++) EXP_TABLE[i] = 1 << i;
    for (var j = 8; j < 256; j++) {
      EXP_TABLE[j] = EXP_TABLE[j - 4] ^ EXP_TABLE[j - 5] ^ EXP_TABLE[j - 6] ^ EXP_TABLE[j - 8];
    }
    for (var k = 0; k < 255; k++) LOG_TABLE[EXP_TABLE[k]] = k;
  })();

  function gexp(n) {
    return EXP_TABLE[((n % 255) + 255) % 255];
  }
  function glog(n) {
    return LOG_TABLE[n];
  }

  // --- Reed-Solomon polynomials over GF(256) --------------------------------

  function polyCreate(num, shift) {
    var offset = 0;
    while (offset < num.length - 1 && num[offset] === 0) offset++;
    var result = num.slice(offset);
    for (var i = 0; i < shift; i++) result.push(0);
    return result;
  }

  function polyMultiply(a, b) {
    var result = new Array(a.length + b.length - 1).fill(0);
    for (var i = 0; i < a.length; i++) {
      for (var j = 0; j < b.length; j++) {
        result[i + j] ^= gexp(glog(a[i]) + glog(b[j]));
      }
    }
    return result;
  }

  function polyMod(a, b) {
    if (a.length - b.length < 0) return a;
    var ratio = glog(a[0]) - glog(b[0]);
    var num = a.slice(0, b.length).map(function (item, idx) {
      return item ^ gexp(glog(b[idx]) + ratio);
    });
    var difference = a.length - b.length;
    if (difference) num = num.concat(a.slice(b.length));
    return polyMod(polyCreate(num, 0), b);
  }

  // --- Tables ported from the qrcode package (see module comment above) ----

  var PATTERN_POSITION_TABLE = [
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
    [6, 30, 54],
    [6, 32, 58],
    [6, 34, 62],
    [6, 26, 46, 66],
    [6, 26, 48, 70],
    [6, 26, 50, 74],
    [6, 30, 54, 78],
    [6, 30, 56, 82],
    [6, 30, 58, 86],
    [6, 34, 62, 90],
    [6, 28, 50, 72, 94],
    [6, 26, 50, 74, 98],
    [6, 30, 54, 78, 102],
    [6, 28, 54, 80, 106],
    [6, 32, 58, 84, 110],
    [6, 30, 58, 86, 114],
    [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122],
    [6, 30, 54, 78, 102, 126],
    [6, 26, 52, 78, 104, 130],
    [6, 30, 56, 82, 108, 134],
    [6, 34, 60, 86, 112, 138],
    [6, 30, 58, 86, 114, 142],
    [6, 34, 62, 90, 118, 146],
    [6, 30, 54, 78, 102, 126, 150],
    [6, 24, 50, 76, 102, 128, 154],
    [6, 28, 54, 80, 106, 132, 158],
    [6, 32, 58, 84, 110, 136, 162],
    [6, 26, 54, 82, 110, 138, 166],
    [6, 30, 58, 86, 114, 142, 170]
  ];

  var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
  var G18 =
    (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
  var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

  function bchDigit(data) {
    var digit = 0;
    while (data !== 0) {
      digit++;
      data = Math.floor(data / 2);
    }
    return digit;
  }
  function bchTypeInfo(data) {
    var d = data << 10;
    while (bchDigit(d) - bchDigit(G15) >= 0) {
      d ^= G15 << (bchDigit(d) - bchDigit(G15));
    }
    return ((data << 10) | d) ^ G15_MASK;
  }
  function bchTypeNumber(data) {
    var d = data << 12;
    while (bchDigit(d) - bchDigit(G18) >= 0) {
      d ^= G18 << (bchDigit(d) - bchDigit(G18));
    }
    return (data << 12) | d;
  }

  // RS_BLOCK_TABLE[(version-1)*4 + level], level 0=L 1=M 2=Q 3=H. Only level
  // M (index 1 of each group of 4) is ever read by this file, but the table
  // is kept in its original layout (rather than pre-filtered to just M) so
  // it can be diffed directly against its source.
  var RS_BLOCK_TABLE = [
    [1, 26, 19],
    [1, 26, 16],
    [1, 26, 13],
    [1, 26, 9],
    [1, 44, 34],
    [1, 44, 28],
    [1, 44, 22],
    [1, 44, 16],
    [1, 70, 55],
    [1, 70, 44],
    [2, 35, 17],
    [2, 35, 13],
    [1, 100, 80],
    [2, 50, 32],
    [2, 50, 24],
    [4, 25, 9],
    [1, 134, 108],
    [2, 67, 43],
    [2, 33, 15, 2, 34, 16],
    [2, 33, 11, 2, 34, 12],
    [2, 86, 68],
    [4, 43, 27],
    [4, 43, 19],
    [4, 43, 15],
    [2, 98, 78],
    [4, 49, 31],
    [2, 32, 14, 4, 33, 15],
    [4, 39, 13, 1, 40, 14],
    [2, 121, 97],
    [2, 60, 38, 2, 61, 39],
    [4, 40, 18, 2, 41, 19],
    [4, 40, 14, 2, 41, 15],
    [2, 146, 116],
    [3, 58, 36, 2, 59, 37],
    [4, 36, 16, 4, 37, 17],
    [4, 36, 12, 4, 37, 13],
    [2, 86, 68, 2, 87, 69],
    [4, 69, 43, 1, 70, 44],
    [6, 43, 19, 2, 44, 20],
    [6, 43, 15, 2, 44, 16],
    [4, 101, 81],
    [1, 80, 50, 4, 81, 51],
    [4, 50, 22, 4, 51, 23],
    [3, 36, 12, 8, 37, 13],
    [2, 116, 92, 2, 117, 93],
    [6, 58, 36, 2, 59, 37],
    [4, 46, 20, 6, 47, 21],
    [7, 42, 14, 4, 43, 15],
    [4, 133, 107],
    [8, 59, 37, 1, 60, 38],
    [8, 44, 20, 4, 45, 21],
    [12, 33, 11, 4, 34, 12],
    [3, 145, 115, 1, 146, 116],
    [4, 64, 40, 5, 65, 41],
    [11, 36, 16, 5, 37, 17],
    [11, 36, 12, 5, 37, 13],
    [5, 109, 87, 1, 110, 88],
    [5, 65, 41, 5, 66, 42],
    [5, 54, 24, 7, 55, 25],
    [11, 36, 12, 7, 37, 13],
    [5, 122, 98, 1, 123, 99],
    [7, 73, 45, 3, 74, 46],
    [15, 43, 19, 2, 44, 20],
    [3, 45, 15, 13, 46, 16],
    [1, 135, 107, 5, 136, 108],
    [10, 74, 46, 1, 75, 47],
    [1, 50, 22, 15, 51, 23],
    [2, 42, 14, 17, 43, 15],
    [5, 150, 120, 1, 151, 121],
    [9, 69, 43, 4, 70, 44],
    [17, 50, 22, 1, 51, 23],
    [2, 42, 14, 19, 43, 15],
    [3, 141, 113, 4, 142, 114],
    [3, 70, 44, 11, 71, 45],
    [17, 47, 21, 4, 48, 22],
    [9, 39, 13, 16, 40, 14],
    [3, 135, 107, 5, 136, 108],
    [3, 67, 41, 13, 68, 42],
    [15, 54, 24, 5, 55, 25],
    [15, 43, 15, 10, 44, 16],
    [4, 144, 116, 4, 145, 117],
    [17, 68, 42],
    [17, 50, 22, 6, 51, 23],
    [19, 46, 16, 6, 47, 17],
    [2, 139, 111, 7, 140, 112],
    [17, 74, 46],
    [7, 54, 24, 16, 55, 25],
    [34, 37, 13],
    [4, 151, 121, 5, 152, 122],
    [4, 75, 47, 14, 76, 48],
    [11, 54, 24, 14, 55, 25],
    [16, 45, 15, 14, 46, 16],
    [6, 147, 117, 4, 148, 118],
    [6, 73, 45, 14, 74, 46],
    [11, 54, 24, 16, 55, 25],
    [30, 46, 16, 2, 47, 17],
    [8, 132, 106, 4, 133, 107],
    [8, 75, 47, 13, 76, 48],
    [7, 54, 24, 22, 55, 25],
    [22, 45, 15, 13, 46, 16],
    [10, 142, 114, 2, 143, 115],
    [19, 74, 46, 4, 75, 47],
    [28, 50, 22, 6, 51, 23],
    [33, 46, 16, 4, 47, 17],
    [8, 152, 122, 4, 153, 123],
    [22, 73, 45, 3, 74, 46],
    [8, 53, 23, 26, 54, 24],
    [12, 45, 15, 28, 46, 16],
    [3, 147, 117, 10, 148, 118],
    [3, 73, 45, 23, 74, 46],
    [4, 54, 24, 31, 55, 25],
    [11, 45, 15, 31, 46, 16],
    [7, 146, 116, 7, 147, 117],
    [21, 73, 45, 7, 74, 46],
    [1, 53, 23, 37, 54, 24],
    [19, 45, 15, 26, 46, 16],
    [5, 145, 115, 10, 146, 116],
    [19, 75, 47, 10, 76, 48],
    [15, 54, 24, 25, 55, 25],
    [23, 45, 15, 25, 46, 16],
    [13, 145, 115, 3, 146, 116],
    [2, 74, 46, 29, 75, 47],
    [42, 54, 24, 1, 55, 25],
    [23, 45, 15, 28, 46, 16],
    [17, 145, 115],
    [10, 74, 46, 23, 75, 47],
    [10, 54, 24, 35, 55, 25],
    [19, 45, 15, 35, 46, 16],
    [17, 145, 115, 1, 146, 116],
    [14, 74, 46, 21, 75, 47],
    [29, 54, 24, 19, 55, 25],
    [11, 45, 15, 46, 46, 16],
    [13, 145, 115, 6, 146, 116],
    [14, 74, 46, 23, 75, 47],
    [44, 54, 24, 7, 55, 25],
    [59, 46, 16, 1, 47, 17],
    [12, 151, 121, 7, 152, 122],
    [12, 75, 47, 26, 76, 48],
    [39, 54, 24, 14, 55, 25],
    [22, 45, 15, 41, 46, 16],
    [6, 151, 121, 14, 152, 122],
    [6, 75, 47, 34, 76, 48],
    [46, 54, 24, 10, 55, 25],
    [2, 45, 15, 64, 46, 16],
    [17, 152, 122, 4, 153, 123],
    [29, 74, 46, 14, 75, 47],
    [49, 54, 24, 10, 55, 25],
    [24, 45, 15, 46, 46, 16],
    [4, 152, 122, 18, 153, 123],
    [13, 74, 46, 32, 75, 47],
    [48, 54, 24, 14, 55, 25],
    [42, 45, 15, 32, 46, 16],
    [20, 147, 117, 4, 148, 118],
    [40, 75, 47, 7, 76, 48],
    [43, 54, 24, 22, 55, 25],
    [10, 45, 15, 67, 46, 16],
    [19, 148, 118, 6, 149, 119],
    [18, 75, 47, 31, 76, 48],
    [34, 54, 24, 34, 55, 25],
    [20, 45, 15, 61, 46, 16]
  ];

  function rsBlocksForVersionM(version) {
    var row = RS_BLOCK_TABLE[(version - 1) * 4 + 1]; // level M = index 1
    var blocks = [];
    for (var i = 0; i < row.length; i += 3) {
      var count = row[i],
        totalCount = row[i + 1],
        dataCount = row[i + 2];
      for (var n = 0; n < count; n++) {
        blocks.push({ totalCount: totalCount, dataCount: dataCount });
      }
    }
    return blocks;
  }

  // --- Bit buffer -------------------------------------------------------

  function BitBuffer() {
    this.bytes = [];
    this.length = 0;
  }
  BitBuffer.prototype.putBit = function (bit) {
    var byteIndex = Math.floor(this.length / 8);
    if (this.bytes.length <= byteIndex) this.bytes.push(0);
    if (bit) this.bytes[byteIndex] |= 0x80 >> (this.length % 8);
    this.length++;
  };
  BitBuffer.prototype.put = function (num, length) {
    for (var i = 0; i < length; i++) {
      this.putBit(((num >> (length - i - 1)) & 1) === 1);
    }
  };

  // --- Version selection + data codeword construction (byte mode only) -----

  function charCountBits(version) {
    return version < 10 ? 8 : 16;
  }

  function chooseVersion(byteLength) {
    for (var version = 1; version <= 40; version++) {
      var blocks = rsBlocksForVersionM(version);
      var dataCapacityBits = blocks.reduce(function (sum, b) {
        return sum + b.dataCount * 8;
      }, 0);
      var neededBits = 4 + charCountBits(version) + byteLength * 8;
      if (neededBits <= dataCapacityBits) return version;
    }
    return null;
  }

  var PAD0 = 0xec;
  var PAD1 = 0x11;

  function buildDataCodewords(version, bytes) {
    var blocks = rsBlocksForVersionM(version);
    var bitLimit = blocks.reduce(function (sum, b) {
      return sum + b.dataCount * 8;
    }, 0);

    var buffer = new BitBuffer();
    buffer.put(0b0100, 4); // byte mode indicator
    buffer.put(bytes.length, charCountBits(version));
    for (var i = 0; i < bytes.length; i++) buffer.put(bytes[i], 8);

    var terminatorBits = Math.min(bitLimit - buffer.length, 4);
    for (var t = 0; t < terminatorBits; t++) buffer.putBit(false);

    var delimit = buffer.length % 8;
    if (delimit) {
      for (var d = 0; d < 8 - delimit; d++) buffer.putBit(false);
    }

    var bytesToFill = Math.floor((bitLimit - buffer.length) / 8);
    for (var f = 0; f < bytesToFill; f++) {
      buffer.put(f % 2 === 0 ? PAD0 : PAD1, 8);
    }

    return { dataBytes: buffer.bytes, blocks: blocks };
  }

  function buildInterleavedCodewords(dataBytes, blocks) {
    var offset = 0;
    var dcData = [];
    var ecData = [];
    var maxDc = 0;
    var maxEc = 0;

    blocks.forEach(function (block) {
      var dc = dataBytes.slice(offset, offset + block.dataCount);
      offset += block.dataCount;
      var ecCount = block.totalCount - block.dataCount;

      var rsPoly = [1];
      for (var i = 0; i < ecCount; i++) rsPoly = polyMultiply(rsPoly, [1, gexp(i)]);

      var rawPoly = polyCreate(dc, rsPoly.length - 1);
      var modPoly = polyMod(rawPoly, rsPoly);
      var modOffset = modPoly.length - ecCount;
      var ec = [];
      for (var j = 0; j < ecCount; j++) {
        var idx = j + modOffset;
        ec.push(idx >= 0 ? modPoly[idx] : 0);
      }

      dcData.push(dc);
      ecData.push(ec);
      maxDc = Math.max(maxDc, dc.length);
      maxEc = Math.max(maxEc, ec.length);
    });

    var result = [];
    for (var i2 = 0; i2 < maxDc; i2++) {
      dcData.forEach(function (dc) {
        if (i2 < dc.length) result.push(dc[i2]);
      });
    }
    for (var i3 = 0; i3 < maxEc; i3++) {
      ecData.forEach(function (ec) {
        if (i3 < ec.length) result.push(ec[i3]);
      });
    }
    return result;
  }

  // --- Matrix construction ---------------------------------------------

  function makeBlankModules(version) {
    var n = version * 4 + 17;
    var modules = [];
    for (var r = 0; r < n; r++) modules.push(new Array(n).fill(null));

    setupFinder(modules, n, 0, 0);
    setupFinder(modules, n, n - 7, 0);
    setupFinder(modules, n, 0, n - 7);
    setupAlignment(modules, n, version);
    setupTiming(modules, n);

    return modules;
  }

  function setupFinder(modules, n, row, col) {
    for (var r = -1; r <= 7; r++) {
      if (row + r <= -1 || n <= row + r) continue;
      for (var c = -1; c <= 7; c++) {
        if (col + c <= -1 || n <= col + c) continue;
        var dark =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        modules[row + r][col + c] = dark;
      }
    }
  }

  function setupTiming(modules, n) {
    for (var r = 8; r < n - 8; r++) {
      if (modules[r][6] !== null) continue;
      modules[r][6] = r % 2 === 0;
    }
    for (var c = 8; c < n - 8; c++) {
      if (modules[6][c] !== null) continue;
      modules[6][c] = c % 2 === 0;
    }
  }

  function setupAlignment(modules, n, version) {
    var positions = PATTERN_POSITION_TABLE[version - 1];
    positions.forEach(function (row) {
      positions.forEach(function (col) {
        if (modules[row][col] !== null) return;
        for (var r = -2; r <= 2; r++) {
          for (var c = -2; c <= 2; c++) {
            var dark = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
            modules[row + r][col + c] = dark;
          }
        }
      });
    });
  }

  function setupTypeInfo(modules, n, test, maskPattern) {
    var data = (EC_LEVEL_M << 3) | maskPattern;
    var bits = bchTypeInfo(data);

    for (var i = 0; i < 15; i++) {
      var mod = !test && ((bits >> i) & 1) === 1;
      if (i < 6) modules[i][8] = mod;
      else if (i < 8) modules[i + 1][8] = mod;
      else modules[n - 15 + i][8] = mod;
    }
    for (var j = 0; j < 15; j++) {
      var mod2 = !test && ((bits >> j) & 1) === 1;
      if (j < 8) modules[8][n - j - 1] = mod2;
      else if (j < 9) modules[8][15 - j - 1 + 1] = mod2;
      else modules[8][15 - j - 1] = mod2;
    }
    modules[n - 8][8] = !test;
  }

  function setupTypeNumber(modules, n, version, test) {
    var bits = bchTypeNumber(version);
    for (var i = 0; i < 18; i++) {
      var mod = !test && ((bits >> i) & 1) === 1;
      modules[Math.floor(i / 3)][(i % 3) + n - 8 - 3] = mod;
    }
    for (var j = 0; j < 18; j++) {
      var mod2 = !test && ((bits >> j) & 1) === 1;
      modules[(j % 3) + n - 8 - 3][Math.floor(j / 3)] = mod2;
    }
  }

  var MASK_FUNCS = [
    function (i, j) {
      return (i + j) % 2 === 0;
    },
    function (i) {
      return i % 2 === 0;
    },
    function (i, j) {
      return j % 3 === 0;
    },
    function (i, j) {
      return (i + j) % 3 === 0;
    },
    function (i, j) {
      return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    },
    function (i, j) {
      return ((i * j) % 2) + ((i * j) % 3) === 0;
    },
    function (i, j) {
      return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
    },
    function (i, j) {
      return (((i * j) % 3) + ((i + j) % 2)) % 2 === 0;
    }
  ];

  function mapData(modules, n, codewords, maskPattern) {
    var inc = -1;
    var row = n - 1;
    var bitIndex = 7;
    var byteIndex = 0;
    var maskFunc = MASK_FUNCS[maskPattern];
    var dataLen = codewords.length;

    // colBase steps through the fixed sequence n-1, n-3, ... 2 — the "if
    // (col <= 6) col--" skip-the-timing-column adjustment must be computed
    // fresh from colBase each time and NOT feed back into colBase itself.
    // (An earlier version applied the adjustment directly to the loop
    // variable driving `col -= 2`, which — unlike Python's `for col in
    // range(...)`, where reassigning the loop variable never affects the
    // next value the range hands out — silently shortened and shifted the
    // whole zigzag column sequence in JS's C-style for loop.)
    for (var colBase = n - 1; colBase > 0; colBase -= 2) {
      var col = colBase;
      if (col <= 6) col--;
      var colRange = [col, col - 1];

      for (;;) {
        for (var ci = 0; ci < colRange.length; ci++) {
          var c = colRange[ci];
          if (modules[row][c] === null) {
            var dark = false;
            if (byteIndex < dataLen) {
              dark = ((codewords[byteIndex] >> bitIndex) & 1) === 1;
            }
            if (maskFunc(row, c)) dark = !dark;
            modules[row][c] = dark;
            bitIndex--;
            if (bitIndex === -1) {
              byteIndex++;
              bitIndex = 7;
            }
          }
        }
        row += inc;
        if (row < 0 || n <= row) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
  }

  function buildMatrix(version, codewords, test, maskPattern) {
    var n = version * 4 + 17;
    var modules = makeBlankModules(version);
    setupTypeInfo(modules, n, test, maskPattern);
    if (version >= 7) setupTypeNumber(modules, n, version, test);
    mapData(modules, n, codewords, maskPattern);
    return modules;
  }

  // --- Penalty scoring (ISO/IEC 18004 §8.8.2) ----------------------------

  function lostPoint(modules) {
    return (
      lostPointLevel1(modules) +
      lostPointLevel2(modules) +
      lostPointLevel3(modules) +
      lostPointLevel4(modules)
    );
  }

  function lostPointLevel1(modules) {
    var n = modules.length;
    var total = 0;

    for (var row = 0; row < n; row++) {
      var prev = modules[row][0];
      var runLength = 0;
      for (var col = 0; col < n; col++) {
        if (modules[row][col] === prev) {
          runLength++;
        } else {
          if (runLength >= 5) total += runLength - 2;
          runLength = 1;
          prev = modules[row][col];
        }
      }
      if (runLength >= 5) total += runLength - 2;
    }

    for (var c2 = 0; c2 < n; c2++) {
      var prevC = modules[0][c2];
      var runLengthC = 0;
      for (var r2 = 0; r2 < n; r2++) {
        if (modules[r2][c2] === prevC) {
          runLengthC++;
        } else {
          if (runLengthC >= 5) total += runLengthC - 2;
          runLengthC = 1;
          prevC = modules[r2][c2];
        }
      }
      if (runLengthC >= 5) total += runLengthC - 2;
    }

    return total;
  }

  function lostPointLevel2(modules) {
    var n = modules.length;
    var total = 0;
    for (var row = 0; row < n - 1; row++) {
      for (var col = 0; col < n - 1; col++) {
        var a = modules[row][col];
        if (
          a === modules[row][col + 1] &&
          a === modules[row + 1][col] &&
          a === modules[row + 1][col + 1]
        ) {
          total += 3;
        }
      }
    }
    return total;
  }

  function lostPointLevel3(modules) {
    var n = modules.length;
    var total = 0;

    function matchesAt(getCell, base) {
      var v = [];
      for (var k = 0; k <= 10; k++) v.push(getCell(base + k));
      var pattern1 =
        !v[1] && v[4] && !v[5] && v[6] && !v[9] && v[0] && v[2] && v[3] && !v[7] && !v[8] && !v[10];
      var pattern2 =
        !v[1] && v[4] && !v[5] && v[6] && !v[9] && !v[0] && !v[2] && !v[3] && v[7] && v[8] && v[10];
      return pattern1 || pattern2;
    }

    for (var row = 0; row < n; row++) {
      for (var col = 0; col <= n - 11; col++) {
        if (
          matchesAt(function (idx) {
            return modules[row][idx];
          }, col)
        )
          total += 40;
      }
    }
    for (var col2 = 0; col2 < n; col2++) {
      for (var row2 = 0; row2 <= n - 11; row2++) {
        if (
          matchesAt(function (idx) {
            return modules[idx][col2];
          }, row2)
        )
          total += 40;
      }
    }
    return total;
  }

  function lostPointLevel4(modules) {
    var n = modules.length;
    var dark = 0;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (modules[r][c]) dark++;
      }
    }
    var percent = (dark / (n * n)) * 100;
    var rating = Math.floor(Math.abs(percent - 50) / 5);
    return rating * 10;
  }

  // --- SVG rendering ------------------------------------------------------

  function renderSvg(modules) {
    var n = modules.length;
    var moduleSize = 4;
    var quietModules = 4;
    var size = (n + quietModules * 2) * moduleSize;

    var rects = '';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (modules[r][c]) {
          var x = (c + quietModules) * moduleSize;
          var y = (r + quietModules) * moduleSize;
          rects +=
            '<rect x="' +
            x +
            '" y="' +
            y +
            '" width="' +
            moduleSize +
            '" height="' +
            moduleSize +
            '"/>';
        }
      }
    }

    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      size +
      '" height="' +
      size +
      '" viewBox="0 0 ' +
      size +
      ' ' +
      size +
      '" shape-rendering="crispEdges">' +
      '<rect x="0" y="0" width="' +
      size +
      '" height="' +
      size +
      '" fill="#ffffff"/>' +
      '<g fill="#000000">' +
      rects +
      '</g></svg>'
    );
  }

  // --- Entry point ---------------------------------------------------------

  window.convertText = function (text) {
    if (!text) {
      throw new Error('Enter the text or URL you want to turn into a QR code.');
    }
    var bytes = Array.from(new TextEncoder().encode(text));
    if (bytes.length > 2331) {
      throw new Error('This text is too long to fit in a QR code (max ~2,331 bytes).');
    }

    var version = chooseVersion(bytes.length);
    if (version === null) {
      throw new Error('This text is too long to fit in a QR code.');
    }

    var built = buildDataCodewords(version, bytes);
    var codewords = buildInterleavedCodewords(built.dataBytes, built.blocks);

    var bestPattern = 0;
    var bestScore = null;
    for (var pattern = 0; pattern < 8; pattern++) {
      var trialModules = buildMatrix(version, codewords, true, pattern);
      var score = lostPoint(trialModules);
      if (bestScore === null || score < bestScore) {
        bestScore = score;
        bestPattern = pattern;
      }
    }

    var finalModules = buildMatrix(version, codewords, false, bestPattern);
    var svg = renderSvg(finalModules);
    var base64 = btoa(unescape(encodeURIComponent(svg)));

    return {
      text: 'data:image/svg+xml;base64,' + base64,
      filename: 'qr-code.svg'
    };
  };
})();
