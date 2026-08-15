(function () {
  'use strict';

  // Matches JSON's own number grammar: no leading zeros, no bare
  // "Infinity"/"NaN".
  var NUMERIC_RE = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

  window.convertText = function (text) {
    var data = parseYaml(text);
    if (data === null || typeof data !== 'object') {
      throw new Error('Top-level YAML value must be a mapping or list to convert to XML.');
    }
    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += toXml(data, 'root', 0);
    return { text: xml, filename: 'data.xml' };
  };

  // --- YAML parsing (same shape as yaml-to-json.js) -------------------------

  function parseYaml(input) {
    var lines = input.split('\n');
    var result = parseBlock(lines, 0, 0);
    return result.value;
  }

  function parseBlock(lines, startIdx, baseIndent) {
    var isArray = false;
    var obj = {};
    var arr = [];
    var i = startIdx;

    while (i < lines.length) {
      var raw = lines[i];
      if (raw.trim() === '' || raw.trim().charAt(0) === '#') {
        i++;
        continue;
      }

      var lineIndent = raw.length - raw.trimStart().length;
      if (lineIndent < baseIndent) break;

      var trimmed = raw.trimStart();

      if (trimmed.charAt(0) === '-' && (trimmed.charAt(1) === ' ' || trimmed.length === 1)) {
        isArray = true;
        var itemContent = trimmed.substring(2);
        if (
          itemContent.trim() === '' ||
          (itemContent.indexOf(':') !== -1 && !isSimpleValue(itemContent.trim()))
        ) {
          if (itemContent.trim() !== '' && itemContent.indexOf(':') !== -1) {
            var tempLines = [rpt(' ', lineIndent + 2) + itemContent.trim()];
            var j = i + 1;
            while (j < lines.length) {
              var nr = lines[j];
              if (nr.trim() === '' || nr.trim().charAt(0) === '#') {
                j++;
                continue;
              }
              var ni = nr.length - nr.trimStart().length;
              if (ni <= lineIndent) break;
              tempLines.push(nr);
              j++;
            }
            var sub = parseBlock(tempLines, 0, lineIndent + 2);
            arr.push(sub.value);
            i = j;
          } else {
            var sub2 = parseBlock(lines, i + 1, lineIndent + 2);
            arr.push(sub2.value);
            i = sub2.nextIdx;
          }
        } else {
          arr.push(parseScalar(itemContent.trim()));
          i++;
        }
      } else if (trimmed.indexOf(':') !== -1) {
        var colonIdx = trimmed.indexOf(':');
        var key = trimmed.substring(0, colonIdx).trim();
        if (key.charAt(0) === '"' && key.charAt(key.length - 1) === '"') {
          key = key.substring(1, key.length - 1);
        }
        var valPart = trimmed.substring(colonIdx + 1).trim();

        if (valPart === '' || valPart === '|' || valPart === '>') {
          var sub3 = parseBlock(lines, i + 1, lineIndent + 2);
          obj[key] = sub3.value;
          i = sub3.nextIdx;
        } else {
          obj[key] = parseScalar(valPart);
          i++;
        }
      } else {
        i++;
      }
    }

    if (isArray) return { value: arr, nextIdx: i };
    if (Object.keys(obj).length > 0) return { value: obj, nextIdx: i };
    return { value: null, nextIdx: i };
  }

  function isSimpleValue(str) {
    if (str.charAt(0) === '"' || str.charAt(0) === "'") return true;
    if (!isNaN(str)) return true;
    if (str === 'true' || str === 'false' || str === 'null') return true;
    if (str.indexOf(' ') === -1 && str.indexOf(':') === -1) return true;
    return false;
  }

  function parseScalar(str) {
    if (str === 'null' || str === '~') return null;
    if (str === 'true') return true;
    if (str === 'false') return false;
    if (
      (str.charAt(0) === '"' && str.charAt(str.length - 1) === '"') ||
      (str.charAt(0) === "'" && str.charAt(str.length - 1) === "'")
    ) {
      return str.substring(1, str.length - 1);
    }
    if (str.charAt(0) === '[' || str.charAt(0) === '{') {
      try {
        return JSON.parse(str);
      } catch (e) {
        return str;
      }
    }
    if (NUMERIC_RE.test(str)) return Number(str);
    return str;
  }

  // --- XML serialization (same shape as json-to-xml.js) ---------------------

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
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function rpt(str, n) {
    var out = '';
    for (var i = 0; i < n; i++) out += str;
    return out;
  }
})();
