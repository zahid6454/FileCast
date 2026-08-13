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
    out = out.replace(/<[^>]+>/g, '');

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

  function decodeEntities(str) {
    str = str.replace(/&#x([0-9a-fA-F]+);/g, function (_, hex) {
      return codePointToChar(parseInt(hex, 16));
    });
    str = str.replace(/&#(\d+);/g, function (_, dec) {
      return codePointToChar(parseInt(dec, 10));
    });
    str = str.replace(/&([a-zA-Z]+);/g, function (match, name) {
      var lower = name.toLowerCase();
      return Object.hasOwn(NAMED_ENTITIES, lower) ? NAMED_ENTITIES[lower] : match;
    });
    return str;
  }

  function codePointToChar(codePoint) {
    try {
      return String.fromCodePoint(codePoint);
    } catch (e) {
      return '';
    }
  }
})();
