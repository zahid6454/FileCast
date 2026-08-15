window.convertText = function (text) {
  // RFC-4180-ish line splitter: tracks quote state only to tell a real
  // row-ending newline apart from one embedded inside a quoted field —
  // every character, quotes included, is kept in `current` so parseLine()
  // below sees the real quoting syntax rather than an already-stripped line.
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

  var headers = parseLine(lines[0]).map(function (h) {
    return sanitizeTag(h.trim());
  });

  var xml = '<?xml version="1.0" encoding="UTF-8"?>\n<rows>\n';
  for (var r = 1; r < lines.length; r++) {
    var values = parseLine(lines[r]);
    xml += '  <row>\n';
    for (var c = 0; c < headers.length; c++) {
      var val = (values[c] || '').trim();
      xml += '    <' + headers[c] + '>' + escapeXml(val) + '</' + headers[c] + '>\n';
    }
    xml += '  </row>\n';
  }
  xml += '</rows>\n';

  return { text: xml, filename: 'data.xml' };

  // Column headers become XML element names, which have narrower grammar
  // than CSV headers (no spaces, no leading digit, only [A-Za-z0-9_.-]).
  function sanitizeTag(name) {
    var safe = (name || 'field').replace(/[^a-zA-Z0-9_.-]/g, '_');
    if (!safe || /^[0-9.-]/.test(safe)) safe = '_' + safe;
    return safe;
  }

  function escapeXml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
};
