window.convertText = function(text) {
  var data = JSON.parse(text);

  if (!Array.isArray(data)) {
    if (typeof data === 'object' && data !== null) {
      data = [data];
    } else {
      throw new Error('Input must be a JSON array of objects, e.g. [{"name": "Alice"}, {"name": "Bob"}]');
    }
  }

  if (data.length === 0) {
    throw new Error('JSON array is empty. Add at least one object to convert.');
  }

  var headers = [];
  var headerSet = {};
  data.forEach(function(row) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return;
    Object.keys(row).forEach(function(key) {
      if (!headerSet[key]) {
        headerSet[key] = true;
        headers.push(key);
      }
    });
  });

  if (headers.length === 0) {
    throw new Error('No valid objects found in the JSON array.');
  }

  function escapeCSV(val) {
    if (val === null || val === undefined) return '';
    var str = typeof val === 'object' ? JSON.stringify(val) : String(val);
    if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  var lines = [headers.map(escapeCSV).join(',')];
  data.forEach(function(row) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return;
    var values = headers.map(function(h) { return escapeCSV(row[h]); });
    lines.push(values.join(','));
  });

  return { text: lines.join('\n'), filename: 'data.csv' };
};
