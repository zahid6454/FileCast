(function () {
  'use strict';

  window.convertText = function (text) {
    try {
      checkWellFormed(text);
    } catch (e) {
      throw new Error('Invalid XML: ' + e.message);
    }

    var lines = formatMarkup(text).split('\n');
    // A comment is valid XML anywhere in the prolog EXCEPT before the XML
    // declaration, which must be the very first thing in the document — so
    // this stays valid, parseable XML rather than a plain-text confirmation.
    var insertAt = /^<\?xml/i.test(lines[0]) ? 1 : 0;
    lines.splice(insertAt, 0, '<!-- ✓ Valid XML -->');

    return { text: lines.join('\n'), filename: 'validated.xml' };
  };

  // Hand-rolled well-formedness check — NOT DOMParser. DOMParser is a
  // Window-only API (not exposed in Worker global scope in any browser, per
  // spec), and this converter always runs inside text-converter-worker.js,
  // never on the main thread. Checks: every tag closes, tags nest without
  // overlapping, exactly one root element, and bare "&" outside tags is
  // rejected (must be escaped as "&amp;").
  function checkWellFormed(text) {
    var trimmed = text.trim();
    if (!trimmed) throw new Error('the document is empty.');

    // Blank out comments/CDATA/PI/DOCTYPE (same length, so nothing inside
    // them — including text that looks like a tag — reaches the tag scan).
    var cleaned = trimmed
      .replace(/<!--[\s\S]*?-->/g, blank)
      .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, blank)
      .replace(/<\?[\s\S]*?\?>/g, blank)
      .replace(/<!DOCTYPE[\s\S]*?>/gi, blank);

    var tagRe = /<(\/)?([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^"'>])*?)(\/)?>/g;
    var stack = [];
    var seenRootClose = false;
    var lastEnd = 0;
    var match;

    while ((match = tagRe.exec(cleaned)) !== null) {
      checkEntities(cleaned.slice(lastEnd, match.index));
      checkAttributeEntities(match[3] || '');
      lastEnd = tagRe.lastIndex;

      var isClose = !!match[1];
      var name = match[2];
      var selfClose = !!match[4] || /\/\s*$/.test(match[3] || '');

      if (isClose) {
        if (stack.length === 0) {
          throw new Error('closing tag </' + name + '> has no matching opening tag.');
        }
        var top = stack.pop();
        if (top !== name) {
          throw new Error(
            'tag <' + top + '> is closed by </' + name + '> instead of </' + top + '>.'
          );
        }
        if (stack.length === 0) {
          if (seenRootClose)
            throw new Error('found more than one root element — XML allows exactly one.');
          seenRootClose = true;
        }
      } else if (selfClose) {
        if (stack.length === 0) {
          if (seenRootClose)
            throw new Error('found more than one root element — XML allows exactly one.');
          seenRootClose = true;
        }
      } else {
        if (stack.length === 0 && seenRootClose) {
          throw new Error('found more than one root element — XML allows exactly one.');
        }
        stack.push(name);
      }
    }
    var trailing = cleaned.slice(lastEnd);
    checkEntities(trailing);

    if (stack.length > 0) {
      throw new Error('tag <' + stack[stack.length - 1] + '> was never closed.');
    }
    if (!seenRootClose) {
      throw new Error('no root element found.');
    }
    if (/\S/.test(trailing)) {
      throw new Error("content found after the root element's closing tag.");
    }
  }

  function checkEntities(textChunk) {
    if (/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#[0-9]+|#x[0-9a-fA-F]+);)/.test(textChunk)) {
      throw new Error('unescaped "&" — use "&amp;" instead.');
    }
  }

  // checkEntities() above only ever sees text BETWEEN tags — an unescaped
  // "&" inside a quoted attribute value (<a href="x&y">) never reached it,
  // since that text lives inside the tag match itself. Pulls each quoted
  // attribute value back out of the tag's attribute string and runs the
  // same check against its (unquoted) contents.
  function checkAttributeEntities(attrs) {
    var re = /"([^"]*)"|'([^']*)'/g;
    var m;
    while ((m = re.exec(attrs)) !== null) {
      checkEntities(m[1] !== undefined ? m[1] : m[2]);
    }
  }

  function blank(m) {
    var out = '';
    for (var i = 0; i < m.length; i++) out += ' ';
    return out;
  }

  function formatMarkup(src) {
    src = src.trim().replace(/>\s*</g, '>\n<');
    var lines = src.split('\n');
    var out = [];
    var indent = 0;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      if (
        /^<\?/.test(line) ||
        /^<!--/.test(line) ||
        /^<!\[CDATA\[/.test(line) ||
        /^<!DOCTYPE/i.test(line)
      ) {
        out.push(pad(indent) + line);
        continue;
      }

      var closeMatch = /^<\/([^\s>]+)/.exec(line);
      if (closeMatch) {
        indent = Math.max(0, indent - 1);
        out.push(pad(indent) + line);
        continue;
      }

      var openMatch = /^<([^\s/>]+)/.exec(line);
      var selfClosing = /\/>\s*$/.test(line);
      var closesOnSameLine =
        openMatch && new RegExp('</' + escapeRegExp(openMatch[1]) + '>\\s*$').test(line);

      out.push(pad(indent) + line);
      if (openMatch && !selfClosing && !closesOnSameLine) indent++;
    }

    return out.join('\n');
  }

  function pad(n) {
    var s = '';
    for (var i = 0; i < n; i++) s += '  ';
    return s;
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
})();
