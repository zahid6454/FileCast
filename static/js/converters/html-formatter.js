(function () {
  'use strict';

  // HTML5 void elements — never have a closing tag, so the indenter must not
  // wait for one before dedenting (unlike xml-formatter.js, which has no
  // concept of void elements since XML has no fixed element vocabulary).
  var VOID_TAGS = {
    area: true,
    base: true,
    br: true,
    col: true,
    embed: true,
    hr: true,
    img: true,
    input: true,
    link: true,
    meta: true,
    param: true,
    source: true,
    track: true,
    wbr: true
  };

  window.convertText = function (text) {
    return { text: formatMarkup(text), filename: 'formatted.html' };
  };

  // Reformats the ORIGINAL text (not a DOM re-serialization via innerHTML),
  // so attribute order/quoting and any HTML5 shorthand (unquoted attributes,
  // omitted optional tags) are preserved — only whitespace between tags
  // changes. There is no well-formedness check here: HTML5 parsing is
  // deliberately lenient (browsers auto-correct broken markup instead of
  // rejecting it), so unlike XML there's no "invalid HTML" error to throw.
  function formatMarkup(src) {
    src = src.trim().replace(/>\s*</g, '>\n<');
    var lines = src.split('\n');
    var out = [];
    var indent = 0;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      if (/^<!--/.test(line) || /^<!DOCTYPE/i.test(line)) {
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
      var tagName = openMatch ? openMatch[1].toLowerCase() : '';
      var selfClosing = /\/>\s*$/.test(line);
      var isVoid = VOID_TAGS[tagName] === true;
      var closesOnSameLine =
        openMatch && new RegExp('</' + escapeRegExp(openMatch[1]) + '>\\s*$', 'i').test(line);

      out.push(pad(indent) + line);
      if (openMatch && !selfClosing && !isVoid && !closesOnSameLine) indent++;
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
