(function () {
  'use strict';

  var EDITOR_ATTR_PREFIXES = ['inkscape:', 'sodipodi:'];
  var EDITOR_XMLNS_ATTRS = { 'xmlns:inkscape': true, 'xmlns:sodipodi': true };
  var EDITOR_ELEMENT_NAMES = { 'sodipodi:namedview': true, 'inkscape:path-effect': true };
  // Whitespace inside these can be visually significant (rendered text, or
  // raw CSS/JS content) — only whitespace-only text nodes OUTSIDE these are
  // safe to drop without changing what the SVG looks like.
  var PRESERVE_WHITESPACE_PARENTS = {
    text: true,
    tspan: true,
    textpath: true,
    style: true,
    script: true
  };

  window.convertFile = function (file) {
    return file.text().then(function (svgText) {
      var parser = new DOMParser();
      var doc = parser.parseFromString(svgText, 'image/svg+xml');

      if (doc.getElementsByTagName('parsererror').length > 0) {
        throw new Error('This file is not valid XML/SVG and could not be parsed.');
      }

      var root = doc.documentElement;
      if (!root || root.nodeName.toLowerCase() !== 'svg') {
        throw new Error('This file does not contain an <svg> root element.');
      }

      stripComments(root);
      stripEditorCruft(root);
      stripMetadataAndEmptyText(root);
      stripInsignificantWhitespace(root);

      var optimized = new XMLSerializer().serializeToString(root);
      var originalBytes = new Blob([svgText]).size;
      var optimizedBytes = new Blob([optimized]).size;

      // A file that was already clean (or one XMLSerializer happens to
      // re-format no smaller) should never come back larger — return the
      // original bytes rather than a "optimized" result that regressed.
      var output = optimizedBytes < originalBytes ? optimized : svgText;
      return new Blob([output], { type: 'image/svg+xml' });
    });
  };

  function walk(node, fn) {
    fn(node);
    var child = node.firstChild;
    while (child) {
      var next = child.nextSibling;
      walk(child, fn);
      child = next;
    }
  }

  function removeAll(nodes) {
    nodes.forEach(function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
  }

  function stripComments(root) {
    var comments = [];
    walk(root, function (n) {
      if (n.nodeType === 8) comments.push(n); // Node.COMMENT_NODE
    });
    removeAll(comments);
  }

  function stripEditorCruft(root) {
    var elementsToRemove = [];
    walk(root, function (n) {
      if (n.nodeType !== 1) return; // Node.ELEMENT_NODE
      var name = n.nodeName.toLowerCase();
      if (EDITOR_ELEMENT_NAMES[name]) {
        elementsToRemove.push(n);
        return;
      }
      if (!n.attributes) return;
      var attrNames = [];
      for (var i = 0; i < n.attributes.length; i++) attrNames.push(n.attributes[i].name);
      attrNames.forEach(function (attrName) {
        var lower = attrName.toLowerCase();
        var isEditorNamespaced = EDITOR_ATTR_PREFIXES.some(function (prefix) {
          return lower.indexOf(prefix) === 0;
        });
        if (isEditorNamespaced || EDITOR_XMLNS_ATTRS[lower]) {
          n.removeAttribute(attrName);
        }
      });
    });
    removeAll(elementsToRemove);
  }

  // <metadata> is never rendered, so it's removed unconditionally. <title>/
  // <desc> matter for accessibility when they have real content, so those
  // are only removed when empty (an editor-inserted placeholder).
  function stripMetadataAndEmptyText(root) {
    var toRemove = [];
    walk(root, function (n) {
      if (n.nodeType !== 1) return;
      var name = n.nodeName.toLowerCase();
      if (name === 'metadata') {
        toRemove.push(n);
      } else if ((name === 'title' || name === 'desc') && !n.textContent.trim()) {
        toRemove.push(n);
      }
    });
    removeAll(toRemove);
  }

  function stripInsignificantWhitespace(root) {
    var toRemove = [];
    walk(root, function (n) {
      if (n.nodeType !== 3) return; // Node.TEXT_NODE
      if (!/^\s*$/.test(n.nodeValue)) return; // real text content — keep verbatim
      var parent = n.parentNode;
      var parentName = parent && parent.nodeName ? parent.nodeName.toLowerCase() : '';
      if (PRESERVE_WHITESPACE_PARENTS[parentName]) return;
      toRemove.push(n);
    });
    removeAll(toRemove);
  }
})();
