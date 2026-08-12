(function () {
  'use strict';

  // Matches JSON's own number grammar: no leading zeros (so "00501" stays a
  // string, not 501), no bare "Infinity"/"NaN".
  var NUMERIC_RE = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

  window.convertText = function (text) {
    var rawLines = text.split(/\r\n|\n/);
    checkNoTabs(rawLines);

    var entries = buildEntries(rawLines);
    if (entries.length === 0) {
      return { text: '# ✓ Valid YAML\n\nnull\n', filename: 'validated.yaml' };
    }

    var result = parseBlock(entries, 0, 0);
    if (result.nextIdx !== entries.length) {
      var leftover = entries[result.nextIdx];
      throw new Error('Invalid YAML: unexpected indentation on line ' + leftover.lineNo + '.');
    }

    return {
      text: '# ✓ Valid YAML\n\n' + toYaml(result.value, 0),
      filename: 'validated.yaml'
    };
  };

  // YAML forbids tabs for indentation — one of the most common real-world
  // YAML mistakes, and one JSON.parse-style parsers give no help with at
  // all. Checked up front, on the RAW lines, before anything else.
  function checkNoTabs(rawLines) {
    for (var i = 0; i < rawLines.length; i++) {
      var leading = /^[ \t]*/.exec(rawLines[i])[0];
      if (leading.indexOf('\t') !== -1) {
        throw new Error(
          'Invalid YAML: tab character used for indentation on line ' +
            (i + 1) +
            ' — YAML requires spaces.'
        );
      }
    }
  }

  // Drops blank lines and full-line comments, keeping each remaining line's
  // original 1-based line number for error messages. A block scalar's
  // interior blank lines are therefore not preserved byte-for-byte in the
  // normalized output — an accepted simplification for a validator, whose
  // job is catching structural mistakes, not full-fidelity round-tripping.
  function buildEntries(rawLines) {
    var entries = [];
    for (var i = 0; i < rawLines.length; i++) {
      var raw = rawLines[i];
      var trimmed = raw.trim();
      if (trimmed === '' || trimmed.charAt(0) === '#') continue;
      entries.push({
        trimmed: trimmed,
        indent: raw.length - raw.trimStart().length,
        lineNo: i + 1
      });
    }
    return entries;
  }

  function parseBlock(entries, startIdx, baseIndent) {
    var isArray = false;
    var isMapping = false;
    var obj = {};
    var seenKeys = {};
    var arr = [];
    var i = startIdx;
    var siblingIndent = null;

    while (i < entries.length) {
      var entry = entries[i];
      if (entry.indent < baseIndent) break;

      if (siblingIndent === null) {
        siblingIndent = entry.indent;
      } else if (entry.indent !== siblingIndent) {
        throw new Error(
          'Invalid YAML: inconsistent indentation on line ' +
            entry.lineNo +
            ' (expected ' +
            siblingIndent +
            ' spaces, found ' +
            entry.indent +
            ').'
        );
      }

      var trimmed = entry.trimmed;

      if (trimmed.charAt(0) === '-' && (trimmed.length === 1 || trimmed.charAt(1) === ' ')) {
        if (isMapping) {
          throw new Error(
            'Invalid YAML: cannot mix a list item with mapping keys at the same level (line ' +
              entry.lineNo +
              ').'
          );
        }
        isArray = true;
        var itemContent = trimmed.substring(2).trim();

        if (itemContent === '') {
          var sub = parseBlock(entries, i + 1, entry.indent + 1);
          arr.push(sub.value);
          i = sub.nextIdx;
        } else if (looksLikeMappingStart(itemContent)) {
          var virtual = [{ trimmed: itemContent, indent: entry.indent + 2, lineNo: entry.lineNo }];
          var j = i + 1;
          while (j < entries.length && entries[j].indent > entry.indent) {
            virtual.push(entries[j]);
            j++;
          }
          var subResult = parseBlock(virtual, 0, entry.indent + 2);
          arr.push(subResult.value);
          i = j;
        } else {
          arr.push(parseScalar(itemContent, entry.lineNo));
          i++;
        }
        continue;
      }

      if (looksLikeMappingStart(trimmed)) {
        if (isArray) {
          throw new Error(
            'Invalid YAML: cannot mix a mapping key with list items at the same level (line ' +
              entry.lineNo +
              ').'
          );
        }
        isMapping = true;
        var colonIdx = trimmed.indexOf(':');
        var key = trimmed.substring(0, colonIdx).trim();
        if (
          (key.charAt(0) === '"' && key.charAt(key.length - 1) === '"') ||
          (key.charAt(0) === "'" && key.charAt(key.length - 1) === "'")
        ) {
          key = key.substring(1, key.length - 1);
        }
        if (Object.hasOwn(seenKeys, key)) {
          throw new Error(
            'Invalid YAML: duplicate key "' + key + '" on line ' + entry.lineNo + '.'
          );
        }
        seenKeys[key] = true;

        var valPart = trimmed.substring(colonIdx + 1).trim();

        if (valPart === '') {
          var subM = parseBlock(entries, i + 1, entry.indent + 1);
          obj[key] = subM.value;
          i = subM.nextIdx;
        } else if (/^[|>][+-]?\d*$/.test(valPart)) {
          var style = valPart.charAt(0);
          var blockLines = [];
          var k = i + 1;
          while (k < entries.length && entries[k].indent > entry.indent) {
            blockLines.push(entries[k].trimmed);
            k++;
          }
          obj[key] = style === '|' ? blockLines.join('\n') : blockLines.join(' ');
          i = k;
        } else {
          obj[key] = parseScalar(valPart, entry.lineNo);
          i++;
        }
        continue;
      }

      throw new Error(
        'Invalid YAML: could not parse line ' +
          entry.lineNo +
          ' — expected a "key: value" pair or a "- item".'
      );
    }

    if (isArray) return { value: arr, nextIdx: i };
    if (isMapping) return { value: obj, nextIdx: i };
    return { value: null, nextIdx: i };
  }

  // A line "looks like" the start of a mapping entry only if its first
  // colon is followed by a space or is the line's very last character —
  // otherwise something like a URL (`http://example.com`) or a bare time
  // (`12:30`) would be misread as a key/value pair.
  function looksLikeMappingStart(str) {
    var idx = str.indexOf(':');
    if (idx === -1) return false;
    return idx === str.length - 1 || str.charAt(idx + 1) === ' ';
  }

  function parseScalar(str, lineNo) {
    if (str === 'null' || str === '~' || str === '') return null;
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
        return parseFlow(str);
      } catch (e) {
        throw new Error('Invalid YAML: malformed flow collection on line ' + lineNo + '.');
      }
    }
    if (NUMERIC_RE.test(str)) return Number(str);
    return str;
  }

  // Minimal recursive-descent parser for YAML's flow style ([a, b] / {a: 1}).
  // JSON.parse can't be reused directly: flow scalars don't require quotes
  // ([a, b, c] is valid YAML, invalid JSON), which is exactly the common
  // case (an inline tag list) this exists to support.
  function parseFlow(str) {
    var pos = 0;

    function skipSpace() {
      while (pos < str.length && /\s/.test(str.charAt(pos))) pos++;
    }
    function coerce(raw) {
      if (raw === 'null' || raw === '~' || raw === '') return null;
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      if (NUMERIC_RE.test(raw)) return Number(raw);
      return raw;
    }
    function parseScalarToken(stopChars) {
      skipSpace();
      if (str.charAt(pos) === '"' || str.charAt(pos) === "'") {
        var quote = str.charAt(pos);
        var start = pos;
        pos++;
        while (pos < str.length && str.charAt(pos) !== quote) pos++;
        if (pos >= str.length) throw new Error('unterminated quote');
        pos++;
        return str.slice(start + 1, pos - 1);
      }
      var tokenStart = pos;
      while (pos < str.length && stopChars.indexOf(str.charAt(pos)) === -1) pos++;
      return coerce(str.slice(tokenStart, pos).trim());
    }
    function parseValue() {
      skipSpace();
      if (str.charAt(pos) === '[') return parseArray();
      if (str.charAt(pos) === '{') return parseObject();
      return parseScalarToken(',]}');
    }
    function parseArray() {
      pos++; // consume '['
      var arr = [];
      skipSpace();
      if (str.charAt(pos) === ']') {
        pos++;
        return arr;
      }
      while (true) {
        arr.push(parseValue());
        skipSpace();
        if (str.charAt(pos) === ',') {
          pos++;
          continue;
        }
        if (str.charAt(pos) === ']') {
          pos++;
          break;
        }
        throw new Error('expected , or ]');
      }
      return arr;
    }
    function parseObject() {
      pos++; // consume '{'
      var obj = {};
      skipSpace();
      if (str.charAt(pos) === '}') {
        pos++;
        return obj;
      }
      while (true) {
        var key = parseScalarToken(':');
        skipSpace();
        if (str.charAt(pos) !== ':') throw new Error('expected :');
        pos++;
        obj[String(key)] = parseValue();
        skipSpace();
        if (str.charAt(pos) === ',') {
          pos++;
          continue;
        }
        if (str.charAt(pos) === '}') {
          pos++;
          break;
        }
        throw new Error('expected , or }');
      }
      return obj;
    }

    var result = parseValue();
    skipSpace();
    if (pos !== str.length) throw new Error('trailing content after flow collection');
    return result;
  }

  // Re-serializes the parsed, now-confirmed-valid value as clean YAML —
  // adapted from json-to-yaml.js's own serializer (same quoting rules, so a
  // value like the zip code "00501" round-trips as a string, not a number).
  function toYaml(value, indent) {
    var prefix = rpt('  ', indent);

    if (value === null || value === undefined) return 'null\n';
    if (typeof value === 'boolean') return (value ? 'true' : 'false') + '\n';
    if (typeof value === 'number') return String(value) + '\n';

    if (typeof value === 'string') {
      if (
        value === '' ||
        value.indexOf('\n') !== -1 ||
        value.indexOf(':') !== -1 ||
        value.indexOf('#') !== -1 ||
        value.indexOf('{') !== -1 ||
        value.indexOf('[') !== -1 ||
        value.indexOf('"') !== -1 ||
        value.indexOf("'") !== -1 ||
        value === 'true' ||
        value === 'false' ||
        value === 'null' ||
        (!isNaN(value) && value.trim() !== '')
      ) {
        return JSON.stringify(value) + '\n';
      }
      return value + '\n';
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return '[]\n';
      var out = '\n';
      value.forEach(function (item) {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          var keys = Object.keys(item);
          if (keys.length === 0) {
            out += prefix + '- {}\n';
            return;
          }
          out += prefix + '- ' + keys[0] + ': ' + toYaml(item[keys[0]], indent + 2).trimStart();
          for (var k = 1; k < keys.length; k++) {
            out += prefix + '  ' + keys[k] + ': ' + toYaml(item[keys[k]], indent + 2).trimStart();
          }
        } else {
          out += prefix + '- ' + toYaml(item, indent + 1).trimStart();
        }
      });
      return out;
    }

    if (typeof value === 'object') {
      var objKeys = Object.keys(value);
      if (objKeys.length === 0) return '{}\n';
      var result = '\n';
      objKeys.forEach(function (key) {
        var safeKey = key;
        if (key.indexOf(':') !== -1 || key.indexOf('#') !== -1 || key.indexOf(' ') !== -1) {
          safeKey = JSON.stringify(key);
        }
        result += prefix + safeKey + ': ' + toYaml(value[key], indent + 1).trimStart();
      });
      return result;
    }

    return String(value) + '\n';
  }

  function rpt(str, n) {
    var out = '';
    for (var i = 0; i < n; i++) out += str;
    return out;
  }
})();
