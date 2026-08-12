(function () {
  'use strict';

  // Structural diff, not a line-based text diff: parses both sides as JSON
  // and walks the two values together so a reordered-but-identical object
  // (key order differs, values don't) reports zero differences, the way a
  // JSON-aware diff should and a plain text diff couldn't.
  window.convertText = function (textA, textB) {
    var a;
    var b;
    try {
      a = JSON.parse(textA);
    } catch (e) {
      throw new Error('Left JSON is invalid: ' + e.message);
    }
    try {
      b = JSON.parse(textB);
    } catch (e) {
      throw new Error('Right JSON is invalid: ' + e.message);
    }

    var diffs = [];
    walk(a, b, '$', diffs);

    if (diffs.length === 0) {
      return {
        text: 'No differences — both JSON values are structurally identical.\n',
        filename: 'diff.txt'
      };
    }

    var lines = [diffs.length + ' difference' + (diffs.length === 1 ? '' : 's') + ' found:', ''];
    for (var i = 0; i < diffs.length; i++) lines.push(diffs[i]);
    return { text: lines.join('\n') + '\n', filename: 'diff.txt' };
  };

  function walk(a, b, path, diffs) {
    var aType = kindOf(a);
    var bType = kindOf(b);

    if (aType !== bType) {
      diffs.push('~ ' + path + ': ' + describe(a) + ' → ' + describe(b));
      return;
    }

    if (aType === 'object') {
      var keys = unionKeys(a, b);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var childPath = path + '.' + key;
        var inA = Object.hasOwn(a, key);
        var inB = Object.hasOwn(b, key);
        if (inA && !inB) {
          diffs.push('- ' + childPath + ': ' + describe(a[key]) + ' (removed)');
        } else if (!inA && inB) {
          diffs.push('+ ' + childPath + ': ' + describe(b[key]) + ' (added)');
        } else {
          walk(a[key], b[key], childPath, diffs);
        }
      }
      return;
    }

    if (aType === 'array') {
      var maxLen = Math.max(a.length, b.length);
      for (var j = 0; j < maxLen; j++) {
        var itemPath = path + '[' + j + ']';
        if (j >= a.length) {
          diffs.push('+ ' + itemPath + ': ' + describe(b[j]) + ' (added)');
        } else if (j >= b.length) {
          diffs.push('- ' + itemPath + ': ' + describe(a[j]) + ' (removed)');
        } else {
          walk(a[j], b[j], itemPath, diffs);
        }
      }
      return;
    }

    // Scalar (string/number/boolean) or null — both sides are the same kind.
    if (a !== b) {
      diffs.push('~ ' + path + ': ' + describe(a) + ' → ' + describe(b));
    }
  }

  function kindOf(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
  }

  function unionKeys(a, b) {
    // A plain {} object's own "seen" checks are shadowed by Object.prototype
    // members — a JSON key literally named "constructor", "toString",
    // "hasOwnProperty", etc. would read as already-seen and get silently
    // dropped from the diff. Object.create(null) has no prototype at all.
    var seen = Object.create(null);
    var out = [];
    var aKeys = Object.keys(a);
    var bKeys = Object.keys(b);
    for (var i = 0; i < aKeys.length; i++) {
      if (!seen[aKeys[i]]) {
        seen[aKeys[i]] = true;
        out.push(aKeys[i]);
      }
    }
    for (var j = 0; j < bKeys.length; j++) {
      if (!seen[bKeys[j]]) {
        seen[bKeys[j]] = true;
        out.push(bKeys[j]);
      }
    }
    return out;
  }

  function describe(v) {
    if (v === undefined) return 'undefined';
    if (Array.isArray(v)) return 'array(' + v.length + ' item' + (v.length === 1 ? '' : 's') + ')';
    if (v !== null && typeof v === 'object') {
      var n = Object.keys(v).length;
      return 'object(' + n + ' key' + (n === 1 ? '' : 's') + ')';
    }
    return JSON.stringify(v);
  }
})();
