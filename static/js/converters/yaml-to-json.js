(function () {
'use strict';

window.convertText = function(text) {
  var data = parseYaml(text);
  return { text: JSON.stringify(data, null, 2), filename: 'data.json' };
};

function parseYaml(text) {
  var lines = text.split('\n');
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
    if (raw.trim() === '' || raw.trim().charAt(0) === '#') { i++; continue; }

    var lineIndent = raw.length - raw.trimStart().length;
    if (lineIndent < baseIndent) break;

    var trimmed = raw.trimStart();

    if (trimmed.charAt(0) === '-' && (trimmed.charAt(1) === ' ' || trimmed.length === 1)) {
      isArray = true;
      var itemContent = trimmed.substring(2);
      if (itemContent.trim() === '' || (itemContent.indexOf(':') !== -1 && !isSimpleValue(itemContent.trim()))) {
        if (itemContent.trim() !== '' && itemContent.indexOf(':') !== -1) {
          var tempLines = [rpt(' ', lineIndent + 2) + itemContent.trim()];
          var j = i + 1;
          while (j < lines.length) {
            var nr = lines[j];
            if (nr.trim() === '' || nr.trim().charAt(0) === '#') { j++; continue; }
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
  if ((str.charAt(0) === '"' && str.charAt(str.length - 1) === '"') ||
      (str.charAt(0) === "'" && str.charAt(str.length - 1) === "'")) {
    return str.substring(1, str.length - 1);
  }
  if (str.charAt(0) === '[' || str.charAt(0) === '{') {
    try { return JSON.parse(str); } catch (e) { return str; }
  }
  if (!isNaN(str) && str.trim() !== '') return Number(str);
  return str;
}

function rpt(str, n) {
  var out = '';
  for (var i = 0; i < n; i++) out += str;
  return out;
}

})();
