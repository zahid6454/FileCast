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

    var summary = { added: 0, removed: 0, changed: 0 };
    for (var s = 0; s < diffs.length; s++) {
      var k = diffs[s].kind;
      if (k === 'added') summary.added++;
      else if (k === 'removed') summary.removed++;
      else summary.changed++; // 'changed' and 'type-changed' both count as changed
    }

    if (diffs.length === 0) {
      return {
        text: 'No differences — both JSON values are structurally identical.\n',
        filename: 'diff.txt',
        diffs: diffs,
        summary: summary
      };
    }

    var lines = [diffs.length + ' difference' + (diffs.length === 1 ? '' : 's') + ' found:', ''];
    for (var i = 0; i < diffs.length; i++) lines.push(formatLine(diffs[i]));
    return { text: lines.join('\n') + '\n', filename: 'diff.txt', diffs: diffs, summary: summary };
  };

  // Plain-text rendering used for the copy/download output — kept identical
  // to the pre-existing format (tests and users' saved diffs depend on it).
  // The structured `diffs` entries returned alongside it are for the UI's
  // colored report and carry no extra info the text form doesn't already have.
  function formatLine(d) {
    if (d.kind === 'added') return '+ ' + d.path + ': ' + d.newDesc + ' (added)';
    if (d.kind === 'removed') return '- ' + d.path + ': ' + d.oldDesc + ' (removed)';
    return '~ ' + d.path + ': ' + d.oldDesc + ' → ' + d.newDesc;
  }

  function walk(a, b, path, diffs) {
    var aType = kindOf(a);
    var bType = kindOf(b);

    if (aType !== bType) {
      diffs.push({ kind: 'type-changed', path: path, oldDesc: describe(a), newDesc: describe(b) });
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
          diffs.push({ kind: 'removed', path: childPath, oldDesc: describe(a[key]) });
        } else if (!inA && inB) {
          diffs.push({ kind: 'added', path: childPath, newDesc: describe(b[key]) });
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
          diffs.push({ kind: 'added', path: itemPath, newDesc: describe(b[j]) });
        } else if (j >= b.length) {
          diffs.push({ kind: 'removed', path: itemPath, oldDesc: describe(a[j]) });
        } else {
          walk(a[j], b[j], itemPath, diffs);
        }
      }
      return;
    }

    // Scalar (string/number/boolean) or null — both sides are the same kind.
    if (a !== b) {
      diffs.push({ kind: 'changed', path: path, oldDesc: describe(a), newDesc: describe(b) });
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
