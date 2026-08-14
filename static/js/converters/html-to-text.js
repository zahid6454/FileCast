(function () {
  'use strict';

  // Tags whose *closing* tag implies a line break in plain-text output —
  // matches the block-level elements a browser would render on their own
  // line. <br>/<hr> are handled separately since they have no closing tag.
  var BLOCK_CLOSE_RE =
    /<\/(p|div|li|h[1-6]|tr|table|thead|tbody|tfoot|section|article|header|footer|blockquote|ul|ol|pre)>/gi;

  // Common named entities. Not the full HTML5 list (2000+) — covers what
  // realistically shows up in hand-written or CMS-exported markup; anything
  // else falls through to decodeNumericEntities, or is left as literal text
  // (safer than guessing wrong).
  var NAMED_ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    copy: '©',
    reg: '®',
    trade: '™',
    hellip: '…',
    mdash: '—',
    ndash: '–',
    lsquo: '‘',
    rsquo: '’',
    ldquo: '“',
    rdquo: '”',
    times: '×',
    divide: '÷',
    plusmn: '±',
    deg: '°',
    euro: '€',
    pound: '£',
    cent: '¢',
    yen: '¥',
    sect: '§',
    para: '¶',
    middot: '·'
  };

  window.convertText = function (text) {
    var out = text;

    // Content of these never becomes visible text — strip the elements
    // (tags AND content) entirely before generic tag-stripping below, or
    // inline JS/CSS would leak into the output as garbled "text".
    out = out.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    out = out.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    out = out.replace(/<!--[\s\S]*?-->/g, '');

    out = out.replace(/<(br|hr)\s*\/?>/gi, '\n');
    out = out.replace(BLOCK_CLOSE_RE, '\n');
    out = stripTags(out);

    out = decodeEntities(out);

    // Collapse horizontal whitespace runs (but not the newlines just
    // inserted above), then collapse 3+ blank lines down to a single blank
    // line, and trim trailing whitespace from each line.
    out = out
      .split('\n')
      .map(function (line) {
        return line.replace(/[ \t]+/g, ' ').trim();
      })
      .join('\n');
    out = out.replace(/\n{3,}/g, '\n\n').trim();

    return { text: out, filename: 'stripped.txt' };
  };

  // A plain /<[^>]+>/g regex treats the first ">" after "<" as the tag's
  // end — but a quoted attribute value can legally contain a literal ">"
  // (e.g. <a title="a > b">), which cuts the match short and leaks the
  // rest of the attribute value as visible text. This scans char-by-char
  // and only treats an unquoted ">" as the real tag boundary.
  function stripTags(str) {
    var out = '';
    var i = 0;
    var n = str.length;
    while (i < n) {
      if (str.charAt(i) !== '<') {
        out += str.charAt(i);
        i++;
        continue;
      }
      var j = i + 1;
      var quote = '';
      while (j < n) {
        var c = str.charAt(j);
        if (quote) {
          if (c === quote) quote = '';
        } else if (c === '"' || c === "'") {
          quote = c;
        } else if (c === '>') {
          break;
        }
        j++;
      }
      i = j + 1; // skip the whole tag, including an unterminated one at EOF
    }
    return out;
  }

  // One combined regex, one pass — three sequential .replace() calls (hex,
  // then decimal, then named) would feed each pass's OUTPUT into the next
  // pass's INPUT, so a numeric entity that happens to decode to "&" followed
  // by text like "amp;" would get re-decoded as a second, unintended named
  // entity (e.g. "&#38;amp;" should stay "&amp;", like a browser parsing it
  // once, not fully collapse to a bare "&"). Scanning the original string
  // exactly once, the way a real HTML parser's tokenizer does, avoids that.
  function decodeEntities(str) {
    return str.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, function (match, body) {
      if (body.charAt(0) === '#') {
        var isHex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
        var codePoint = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
        return codePointToChar(codePoint);
      }
      var lower = body.toLowerCase();
      return Object.hasOwn(NAMED_ENTITIES, lower) ? NAMED_ENTITIES[lower] : match;
    });
  }

  function codePointToChar(codePoint) {
    try {
      return String.fromCodePoint(codePoint);
    } catch (e) {
      return '';
    }
  }
})();
