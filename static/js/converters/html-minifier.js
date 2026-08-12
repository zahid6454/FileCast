(function () {
  'use strict';

  // Content inside these must survive byte-for-byte: whitespace is
  // significant in <pre>/<textarea>, and both HTML-comment-stripping and
  // whitespace-collapsing would otherwise be free to mangle <script>/<style>
  // source (a `//` comment inside inline JS, or a string containing extra
  // spaces, must not be touched by the HTML-level pass below).
  var PROTECTED_RE = /<(pre|textarea|script|style)([^>]*)>([\s\S]*?)<\/\1>/gi;

  // NUL is never legal in HTML text content (the parsing spec replaces any
  // literal NUL with U+FFFD), so a NUL-delimited placeholder can't collide
  // with real markup and — unlike a whitespace-delimited one — survives the
  // trim() below even when a protected block sits at the very start or end
  // of the input with nothing else around it.
  var MARK = String.fromCharCode(0);

  window.convertText = function (text) {
    var protectedBlocks = [];
    var placeholder = function (match) {
      var idx = protectedBlocks.push(match) - 1;
      return MARK + 'P' + idx + MARK;
    };

    var out = text.replace(PROTECTED_RE, placeholder);
    out = out.replace(/<!--[\s\S]*?-->/g, ''); // strip comments
    out = out.replace(/>\s+</g, '><'); // collapse whitespace between tags
    out = out.replace(/[ \t\r\n]+/g, ' ').trim(); // collapse remaining runs

    var restoreRe = new RegExp(MARK + 'P(\\d+)' + MARK, 'g');
    out = out.replace(restoreRe, function (_, idx) {
      return protectedBlocks[Number(idx)];
    });

    return { text: out, filename: 'minified.html' };
  };
})();
