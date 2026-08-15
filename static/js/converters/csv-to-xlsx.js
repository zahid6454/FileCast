window.convertText = function (text) {
  // Declared up front (not just hoisted like the function declarations
  // below) because buildXlsx()/buildZip() run before this file's later
  // `var NUMERIC_RE =`/`var CRC_TABLE =` lines would otherwise execute.
  var NUMERIC_RE = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
  var CRC_TABLE = buildCrcTable();

  // Same quote-preserving line splitter as csv-to-xml.js/tsv-to-csv.js.
  var lines = [];
  var current = '';
  var inQuotes = false;

  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (ch === '"') {
      current += ch;
      if (inQuotes && text[i + 1] === '"') {
        current += text[i + 1];
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) && !inQuotes) {
      lines.push(current);
      current = '';
      if (ch === '\r') i++;
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);

  lines = lines.filter(function (l) {
    return l.trim() !== '';
  });

  if (lines.length === 0) {
    throw new Error('Paste some CSV data — at least one row is required.');
  }

  function parseLine(line) {
    var fields = [];
    var field = '';
    var inQ = false;
    for (var j = 0; j < line.length; j++) {
      var c = line[j];
      if (c === '"') {
        if (inQ && line[j + 1] === '"') {
          field += '"';
          j++;
        } else {
          inQ = !inQ;
        }
      } else if (c === ',' && !inQ) {
        fields.push(field);
        field = '';
      } else {
        field += c;
      }
    }
    fields.push(field);
    return fields;
  }

  var rows = lines.map(parseLine);
  var bytes = buildXlsx(rows);
  var base64 = bytesToBase64(bytes);

  return {
    text: 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + base64,
    filename: 'data.xlsx'
  };

  // --------------------------------------------------------------------- //
  // Minimal OOXML worksheet — inline strings (no sharedStrings.xml needed),
  // one sheet, no styles. Every reader that opens .xlsx (Excel, LibreOffice,
  // Google Sheets, openpyxl) accepts this reduced part set.
  // --------------------------------------------------------------------- //

  function columnLetter(index) {
    var letters = '';
    var n = index + 1;
    while (n > 0) {
      var rem = (n - 1) % 26;
      letters = String.fromCharCode(65 + rem) + letters;
      n = Math.floor((n - 1) / 26);
    }
    return letters;
  }

  function escapeXml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function cellXml(value, colIndex, rowIndex) {
    var ref = columnLetter(colIndex) + (rowIndex + 1);
    if (value !== '' && NUMERIC_RE.test(value)) {
      return '<c r="' + ref + '"><v>' + Number(value) + '</v></c>';
    }
    return (
      '<c r="' +
      ref +
      '" t="inlineStr"><is><t xml:space="preserve">' +
      escapeXml(value) +
      '</t></is></c>'
    );
  }

  function buildSheetXml(rows) {
    var rowsXml = rows
      .map(function (fields, r) {
        var cells = fields
          .map(function (val, c) {
            return cellXml(val, c, r);
          })
          .join('');
        return '<row r="' + (r + 1) + '">' + cells + '</row>';
      })
      .join('');
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData>' +
      rowsXml +
      '</sheetData></worksheet>'
    );
  }

  function buildXlsx(rows) {
    var contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>';

    var rootRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    var workbook =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>' +
      '</workbook>';

    var workbookRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>';

    var sheet1 = buildSheetXml(rows);

    return buildZip([
      { name: '[Content_Types].xml', content: contentTypes },
      { name: '_rels/.rels', content: rootRels },
      { name: 'xl/workbook.xml', content: workbook },
      { name: 'xl/_rels/workbook.xml.rels', content: workbookRels },
      { name: 'xl/worksheets/sheet1.xml', content: sheet1 }
    ]);
  }

  // --------------------------------------------------------------------- //
  // Minimal ZIP writer — "stored" (uncompressed) entries only. A valid ZIP
  // doesn't require DEFLATE; every reader (including Excel/LibreOffice/
  // Google Sheets, which unzip .xlsx the same as any other .zip) accepts
  // stored entries. Trades a slightly larger file for no compression code.
  // --------------------------------------------------------------------- //

  function buildCrcTable() {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  }

  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function utf8Bytes(str) {
    return new TextEncoder().encode(str);
  }

  function u16(view, offset, value) {
    view.setUint16(offset, value, true);
  }
  function u32(view, offset, value) {
    view.setUint32(offset, value, true);
  }

  function buildZip(files) {
    // Fixed DOS date/time (1980-01-01 00:00:00) — the timestamp has no
    // functional effect on any reader opening this as a spreadsheet.
    var dosTime = 0;
    var dosDate = (1 << 5) | 1; // day 1, month 1, year 1980 (offset 0)

    var localParts = [];
    var centralParts = [];
    var offset = 0;

    files.forEach(function (file) {
      var nameBytes = utf8Bytes(file.name);
      var dataBytes = utf8Bytes(file.content);
      var crc = crc32(dataBytes);

      var localHeader = new ArrayBuffer(30);
      var lv = new DataView(localHeader);
      u32(lv, 0, 0x04034b50);
      u16(lv, 4, 20); // version needed
      u16(lv, 6, 0); // flags
      u16(lv, 8, 0); // stored
      u16(lv, 10, dosTime);
      u16(lv, 12, dosDate);
      u32(lv, 14, crc);
      u32(lv, 18, dataBytes.length);
      u32(lv, 22, dataBytes.length);
      u16(lv, 26, nameBytes.length);
      u16(lv, 28, 0);

      localParts.push(new Uint8Array(localHeader), nameBytes, dataBytes);

      var centralHeader = new ArrayBuffer(46);
      var cv = new DataView(centralHeader);
      u32(cv, 0, 0x02014b50);
      u16(cv, 4, 20); // version made by
      u16(cv, 6, 20); // version needed
      u16(cv, 8, 0); // flags
      u16(cv, 10, 0); // stored
      u16(cv, 12, dosTime);
      u16(cv, 14, dosDate);
      u32(cv, 16, crc);
      u32(cv, 20, dataBytes.length);
      u32(cv, 24, dataBytes.length);
      u16(cv, 28, nameBytes.length);
      u16(cv, 30, 0);
      u16(cv, 32, 0);
      u16(cv, 34, 0);
      u16(cv, 36, 0);
      u32(cv, 38, 0);
      u32(cv, 42, offset);

      centralParts.push(new Uint8Array(centralHeader), nameBytes);

      offset += localHeader.byteLength + nameBytes.length + dataBytes.length;
    });

    var centralStart = offset;
    var centralSize = centralParts.reduce(function (sum, part) {
      return sum + part.length;
    }, 0);

    var endRecord = new ArrayBuffer(22);
    var ev = new DataView(endRecord);
    u32(ev, 0, 0x06054b50);
    u16(ev, 4, 0);
    u16(ev, 6, 0);
    u16(ev, 8, files.length);
    u16(ev, 10, files.length);
    u32(ev, 12, centralSize);
    u32(ev, 16, centralStart);
    u16(ev, 20, 0);

    var allParts = localParts.concat(centralParts, [new Uint8Array(endRecord)]);
    var totalLength = allParts.reduce(function (sum, part) {
      return sum + part.length;
    }, 0);
    var result = new Uint8Array(totalLength);
    var pos = 0;
    allParts.forEach(function (part) {
      result.set(part, pos);
      pos += part.length;
    });
    return result;
  }

  function bytesToBase64(bytes) {
    var binary = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }
};
