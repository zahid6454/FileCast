(function () {
  'use strict';

  // Matches JSON's own number grammar: no leading zeros (so "00501" stays a
  // string, not 501), no bare "Infinity"/"NaN".
  var NUMERIC_RE = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

  window.convertText = function (text) {
    var root;
    try {
      root = parseXml(text);
    } catch (e) {
      throw new Error('Invalid XML: ' + e.message);
    }

    var data = {};
    data[root.tagName] = nodeToValue(root);

    return { text: toYaml(data, 0), filename: 'data.yaml' };
  };

  // --- XML parsing -----------------------------------------------------
  //
  // Hand-rolled rather than DOMParser: this converter runs inside a Web
  // Worker (shared-text.js/text-converter-worker.js move every text-input
  // tool off the main thread), and DOMParser is not exposed on
  // DedicatedWorkerGlobalScope in current Chromium/Firefox/Safari, despite
  // some older guidance suggesting otherwise — confirmed directly against
  // a real worker before writing this. A dependency-free parser sidesteps
  // that gap entirely, the same way this codebase already hand-rolls its
  // YAML parser rather than assuming a browser API covers it.
  //
  // Produces { tagName, attributes, children, text } nodes, then
  // nodeToValue() below reshapes that into the exact same object contract
  // xml-to-json.js's DOM-based nodeToObj() produces (@-prefixed attributes,
  // repeated children become arrays, mixed content gets '#text') — so the
  // downstream YAML serialization needs no changes for the parser swap.

  var XML_NAME_RE = /^[A-Za-z_:][A-Za-z0-9_:.-]*/;

  function parseXml(xmlText) {
    var pos = 0;
    var len = xmlText.length;

    function fail(msg) {
      throw new Error(msg);
    }

    function isWhitespace(ch) {
      return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
    }

    function skipWhitespace() {
      while (pos < len && isWhitespace(xmlText[pos])) pos++;
    }

    function startsWith(str) {
      return xmlText.indexOf(str, pos) === pos;
    }

    function skipProlog() {
      for (;;) {
        skipWhitespace();
        if (startsWith('<?')) {
          var end = xmlText.indexOf('?>', pos);
          if (end === -1) fail('Unterminated processing instruction.');
          pos = end + 2;
        } else if (startsWith('<!--')) {
          var cend = xmlText.indexOf('-->', pos);
          if (cend === -1) fail('Unterminated comment.');
          pos = cend + 3;
        } else if (startsWith('<!DOCTYPE') || startsWith('<!doctype')) {
          var depth = 0;
          var i = pos;
          for (; i < len; i++) {
            if (xmlText[i] === '[') depth++;
            else if (xmlText[i] === ']') depth--;
            else if (xmlText[i] === '>' && depth <= 0) break;
          }
          if (i >= len) fail('Unterminated DOCTYPE declaration.');
          pos = i + 1;
        } else {
          break;
        }
      }
    }

    function readName() {
      var m = XML_NAME_RE.exec(xmlText.slice(pos));
      if (!m) fail('Expected an element or attribute name at position ' + pos + '.');
      pos += m[0].length;
      return m[0];
    }

    function decodeEntities(str) {
      return str.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, function (whole, ent) {
        if (ent === 'amp') return '&';
        if (ent === 'lt') return '<';
        if (ent === 'gt') return '>';
        if (ent === 'quot') return '"';
        if (ent === 'apos') return "'";
        if (ent.charAt(0) === '#') {
          var code =
            ent.charAt(1) === 'x' || ent.charAt(1) === 'X'
              ? Number.parseInt(ent.slice(2), 16)
              : Number.parseInt(ent.slice(1), 10);
          if (!Number.isNaN(code)) return String.fromCodePoint(code);
        }
        return whole;
      });
    }

    function parseAttributes() {
      var attrs = {};
      for (;;) {
        skipWhitespace();
        if (startsWith('/>') || startsWith('>') || pos >= len) break;
        var name = readName();
        skipWhitespace();
        if (xmlText[pos] !== '=') fail('Expected "=" after attribute name "' + name + '".');
        pos++;
        skipWhitespace();
        var quote = xmlText[pos];
        if (quote !== '"' && quote !== "'") {
          fail('Expected a quoted attribute value for "' + name + '".');
        }
        pos++;
        var end = xmlText.indexOf(quote, pos);
        if (end === -1) fail('Unterminated attribute value for "' + name + '".');
        attrs[name] = decodeEntities(xmlText.slice(pos, end));
        pos = end + 1;
      }
      return attrs;
    }

    function parseElement() {
      if (xmlText[pos] !== '<') fail('Expected "<" at position ' + pos + '.');
      pos++;
      var tagName = readName();
      var attributes = parseAttributes();
      skipWhitespace();

      if (startsWith('/>')) {
        pos += 2;
        return { tagName: tagName, attributes: attributes, children: [], text: '' };
      }
      if (xmlText[pos] !== '>') fail('Expected ">" to close start tag "' + tagName + '".');
      pos++;

      var children = [];
      var textParts = [];

      for (;;) {
        if (pos >= len) fail('Unexpected end of input inside element "' + tagName + '".');
        if (startsWith('</')) {
          pos += 2;
          skipWhitespace();
          var closeName = readName();
          skipWhitespace();
          if (xmlText[pos] !== '>') fail('Expected ">" to close tag "' + closeName + '".');
          pos++;
          if (closeName !== tagName) {
            fail(
              'Mismatched closing tag: expected "</' +
                tagName +
                '>" but found "</' +
                closeName +
                '>".'
            );
          }
          break;
        } else if (startsWith('<!--')) {
          var cend2 = xmlText.indexOf('-->', pos);
          if (cend2 === -1) fail('Unterminated comment.');
          pos = cend2 + 3;
        } else if (startsWith('<![CDATA[')) {
          var cdEnd = xmlText.indexOf(']]>', pos);
          if (cdEnd === -1) fail('Unterminated CDATA section.');
          textParts.push(xmlText.slice(pos + 9, cdEnd));
          pos = cdEnd + 3;
        } else if (startsWith('<?')) {
          var piEnd = xmlText.indexOf('?>', pos);
          if (piEnd === -1) fail('Unterminated processing instruction.');
          pos = piEnd + 2;
        } else if (xmlText[pos] === '<') {
          children.push(parseElement());
        } else {
          var next = xmlText.indexOf('<', pos);
          if (next === -1) fail('Unexpected end of input inside element "' + tagName + '".');
          textParts.push(decodeEntities(xmlText.slice(pos, next)));
          pos = next;
        }
      }

      return {
        tagName: tagName,
        attributes: attributes,
        children: children,
        text: textParts.join('')
      };
    }

    skipProlog();
    skipWhitespace();
    if (pos >= len || xmlText[pos] !== '<') fail('No root element found.');
    var root = parseElement();
    return root;
  }

  function nodeToValue(node) {
    var attrNames = Object.keys(node.attributes);
    var hasAttributes = attrNames.length > 0;
    var obj = {};

    if (hasAttributes) {
      attrNames.forEach(function (name) {
        obj['@' + name] = node.attributes[name];
      });
    }

    if (node.children.length === 0 && !hasAttributes) {
      return parseValue(node.text.trim());
    }

    if (node.children.length === 0 && hasAttributes) {
      var trimmed = node.text.trim();
      if (trimmed) obj['#text'] = parseValue(trimmed);
      return obj;
    }

    var counts = {};
    node.children.forEach(function (child) {
      counts[child.tagName] = (counts[child.tagName] || 0) + 1;
    });

    node.children.forEach(function (child) {
      var val = nodeToValue(child);
      if (counts[child.tagName] > 1) {
        if (!Array.isArray(obj[child.tagName])) obj[child.tagName] = [];
        obj[child.tagName].push(val);
      } else {
        obj[child.tagName] = val;
      }
    });

    var trailingText = node.text.trim();
    if (trailingText) obj['#text'] = parseValue(trailingText);

    return obj;
  }

  function parseValue(str) {
    if (str === '') return null;
    if (str === 'true') return true;
    if (str === 'false') return false;
    if (NUMERIC_RE.test(str)) return Number(str);
    return str;
  }

  // --- YAML serialization (same shape as json-to-yaml.js) ------------------

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
          out += prefix + '- ' + keys[0] + ':' + afterColon(toYaml(item[keys[0]], indent + 2));
          for (var k = 1; k < keys.length; k++) {
            out += prefix + '  ' + keys[k] + ':' + afterColon(toYaml(item[keys[k]], indent + 2));
          }
        } else {
          out += prefix + '-' + afterColon(toYaml(item, indent + 1));
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
        result += prefix + safeKey + ':' + afterColon(toYaml(value[key], indent + 1));
      });
      return result;
    }

    return String(value) + '\n';
  }

  // A nested object/array's own toYaml() output always starts with exactly
  // one '\n' (its first entry begins on its own indented line) — a block
  // value like that MUST start on the line after "key:", never glued onto
  // it (previously used .trimStart() here, which stripped that required
  // newline — and the nested block's own leading indentation along with it
  // — collapsing the first nested key onto the parent's "key:" line as
  // invalid YAML). A scalar's toYaml() never starts with '\n', so it still
  // renders inline as "key: value".
  function afterColon(childYaml) {
    return childYaml.charAt(0) === '\n' ? childYaml : ' ' + childYaml;
  }

  function rpt(str, n) {
    var out = '';
    for (var i = 0; i < n; i++) out += str;
    return out;
  }
})();
