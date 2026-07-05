(function () {
'use strict';

window.convertText = function(text) {
  var data = JSON.parse(text);
  var xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += toXml(data, 'root', 0);
  return { text: xml, filename: 'data.xml' };
};

function toXml(value, tag, depth) {
  var indent = rpt('  ', depth);

  if (value === null || value === undefined) {
    return indent + '<' + tag + '/>\n';
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return indent + '<' + tag + '>' + String(value) + '</' + tag + '>\n';
  }
  if (typeof value === 'string') {
    return indent + '<' + tag + '>' + escapeXml(value) + '</' + tag + '>\n';
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return indent + '<' + tag + '/>\n';
    var out = indent + '<' + tag + '>\n';
    for (var i = 0; i < value.length; i++) {
      out += toXml(value[i], 'item', depth + 1);
    }
    out += indent + '</' + tag + '>\n';
    return out;
  }
  if (typeof value === 'object') {
    var keys = Object.keys(value);
    if (keys.length === 0) return indent + '<' + tag + '/>\n';
    var result = indent + '<' + tag + '>\n';
    for (var k = 0; k < keys.length; k++) {
      var safeTag = keys[k].replace(/[^a-zA-Z0-9_.-]/g, '_');
      if (/^[0-9]/.test(safeTag)) safeTag = '_' + safeTag;
      result += toXml(value[keys[k]], safeTag, depth + 1);
    }
    result += indent + '</' + tag + '>\n';
    return result;
  }
  return indent + '<' + tag + '>' + escapeXml(String(value)) + '</' + tag + '>\n';
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function rpt(str, n) {
  var out = '';
  for (var i = 0; i < n; i++) out += str;
  return out;
}

})();
