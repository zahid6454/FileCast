(function () {
  'use strict';

  window.convertText = function (text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error('Invalid JSON: ' + e.message);
    }

    // A Map (not a plain object) so insertion order is guaranteed and
    // re-inserting the same key (the reserve-then-fill trick below) doesn't
    // move it — that's what keeps the root interface printed first even
    // though its body isn't finished being built until every nested object
    // it references has already been discovered.
    var interfaces = new Map();
    var usedNames = new Set();

    var rootType = typeOf(parsed, 'RootObject', true);
    var out = [];

    // Root is a bare array/primitive rather than an object: emit a `type`
    // alias up top so there's still a named entry point, then whatever
    // object interfaces its elements needed underneath.
    if (rootType !== 'RootObject' || !interfaces.has('RootObject')) {
      out.push('type RootObject = ' + rootType + ';');
    }
    interfaces.forEach(function (body, name) {
      out.push('interface ' + name + ' {\n' + body + '\n}');
    });

    return { text: out.join('\n\n') + '\n', filename: 'interfaces.ts' };

    function typeOf(value, nameHint, isRoot) {
      if (value === null) return 'null';
      if (Array.isArray(value)) return arrayType(value, nameHint);

      var t = typeof value;
      if (t === 'string') return 'string';
      if (t === 'boolean') return 'boolean';
      if (t === 'number') return 'number';
      if (t === 'object') {
        var name = isRoot ? reserveName(nameHint) : uniqueName(nameHint);
        buildInterface(name, value);
        return name;
      }
      return 'any';
    }

    function arrayType(arr, nameHint) {
      if (arr.length === 0) return 'any[]';
      // Only the first element's shape is inspected — documented as a known
      // limitation (see the FAQ content) rather than merging every element,
      // which would need a much heavier structural-union algorithm for a
      // free, client-side tool.
      var elementType = typeOf(arr[0], singularize(nameHint), false);
      return /[|&]/.test(elementType) ? '(' + elementType + ')[]' : elementType + '[]';
    }

    function buildInterface(name, obj) {
      interfaces.set(name, ''); // reserve position before recursing into nested keys
      var keys = Object.keys(obj);
      var lines = keys.map(function (key) {
        var safeKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
        return '  ' + safeKey + ': ' + typeOf(obj[key], key, false) + ';';
      });
      interfaces.set(name, lines.join('\n'));
    }

    function singularize(name) {
      if (/ies$/i.test(name)) return name.slice(0, -3) + 'y';
      if (/s$/i.test(name) && !/ss$/i.test(name)) return name.slice(0, -1);
      return name + 'Item';
    }

    function reserveName(name) {
      var clean = toPascalCase(name);
      usedNames.add(clean);
      return clean;
    }

    function uniqueName(name) {
      var base = toPascalCase(name);
      if (!usedNames.has(base)) {
        usedNames.add(base);
        return base;
      }
      var i = 2;
      while (usedNames.has(base + i)) i++;
      usedNames.add(base + i);
      return base + i;
    }

    function toPascalCase(name) {
      var clean = String(name)
        .replace(/[^A-Za-z0-9]+(.)?/g, function (_, c) {
          return c ? c.toUpperCase() : '';
        })
        .replace(/^[0-9]+/, '');
      clean = clean.charAt(0).toUpperCase() + clean.slice(1);
      return clean || 'Obj';
    }
  };
})();
