window.convertText = function (text) {
  // Same quote-tracking line splitter as csv-to-xml.js, adapted for a tab
  // delimiter (TSV's own quoting convention mirrors CSV's — RFC 4180 with
  // "\t" swapped in for ",").
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
    throw new Error('Paste some TSV data — at least one row is required.');
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
      } else if (c === '\t' && !inQ) {
        fields.push(field);
        field = '';
      } else {
        field += c;
      }
    }
    fields.push(field);
    return fields;
  }

  function escapeCSV(val) {
    if (val.indexOf(',') !== -1 || val.indexOf('"') !== -1 || val.indexOf('\n') !== -1) {
      return '"' + val.replace(/"/g, '""') + '"';
    }
    return val;
  }

  var rows = lines.map(parseLine);
  var csvLines = rows.map(function (fields) {
    return fields.map(escapeCSV).join(',');
  });

  return { text: csvLines.join('\r\n'), filename: 'data.csv' };
};
