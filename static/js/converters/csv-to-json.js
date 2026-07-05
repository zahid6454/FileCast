window.convertText = function(text) {
  var lines = [];
  var current = '';
  var inQuotes = false;

  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
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

  lines = lines.filter(function(l) { return l.trim() !== ''; });

  if (lines.length < 2) {
    throw new Error('CSV must have at least a header row and one data row.');
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

  var headers = parseLine(lines[0]).map(function(h) { return h.trim(); });
  var result = [];

  for (var r = 1; r < lines.length; r++) {
    var values = parseLine(lines[r]);
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var val = (values[c] || '').trim();
      if (val === '') {
        obj[headers[c]] = null;
      } else if (val === 'true') {
        obj[headers[c]] = true;
      } else if (val === 'false') {
        obj[headers[c]] = false;
      } else if (!isNaN(val) && val !== '') {
        obj[headers[c]] = Number(val);
      } else {
        obj[headers[c]] = val;
      }
    }
    result.push(obj);
  }

  return { text: JSON.stringify(result, null, 2), filename: 'data.json' };
};
