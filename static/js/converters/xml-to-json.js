(function () {
  'use strict';

  window.convertText = function (text) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(text, 'text/xml');

    var errorNode = doc.querySelector('parsererror');
    if (errorNode) {
      var msg = errorNode.textContent || 'Invalid XML';
      msg = msg.split('\n')[0].trim();
      throw new Error('Invalid XML: ' + msg);
    }

    var root = doc.documentElement;
    var result = {};
    result[root.tagName] = nodeToObj(root);

    return { text: JSON.stringify(result, null, 2), filename: 'data.json' };
  };

  function nodeToObj(node) {
    var obj = {};
    var hasChildren = false;
    var hasAttributes = false;

    if (node.attributes && node.attributes.length > 0) {
      hasAttributes = true;
      for (var a = 0; a < node.attributes.length; a++) {
        var attr = node.attributes[a];
        obj['@' + attr.name] = attr.value;
      }
    }

    var childElements = [];
    var textParts = [];

    for (var i = 0; i < node.childNodes.length; i++) {
      var child = node.childNodes[i];
      if (child.nodeType === 1) {
        childElements.push(child);
      } else if (child.nodeType === 3 || child.nodeType === 4) {
        var t = child.nodeValue.trim();
        if (t) textParts.push(t);
      }
    }

    if (childElements.length === 0 && !hasAttributes) {
      var text = textParts.join('');
      return parseValue(text);
    }

    if (childElements.length === 0 && hasAttributes) {
      if (textParts.length > 0) {
        obj['#text'] = parseValue(textParts.join(''));
      }
      return obj;
    }

    hasChildren = true;
    var counts = {};
    childElements.forEach(function (el) {
      counts[el.tagName] = (counts[el.tagName] || 0) + 1;
    });

    childElements.forEach(function (el) {
      var val = nodeToObj(el);
      if (counts[el.tagName] > 1) {
        if (!Array.isArray(obj[el.tagName])) {
          obj[el.tagName] = [];
        }
        obj[el.tagName].push(val);
      } else {
        obj[el.tagName] = val;
      }
    });

    if (textParts.length > 0) {
      obj['#text'] = parseValue(textParts.join(''));
    }

    return obj;
  }

  function parseValue(str) {
    if (str === '') return null;
    if (str === 'true') return true;
    if (str === 'false') return false;
    if (!isNaN(str) && str.trim() !== '') return Number(str);
    return str;
  }
})();
