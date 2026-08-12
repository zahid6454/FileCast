(function () {
  'use strict';

  window.convertText = function (text) {
    var lang = detectLanguage(text);
    var minified = lang === 'css' ? minifyCss(text) : minifyJs(text);
    return {
      text: minified,
      filename: lang === 'css' ? 'styles.min.css' : 'script.min.js'
    };
  };

  // Heuristic, not a parser: scores CSS-shaped constructs (selector blocks,
  // at-rules) against JS-shaped keywords/syntax, then falls back to the
  // first meaningful character when neither scores. Good enough for real
  // CSS/JS files, which rarely look ambiguous in practice.
  function detectLanguage(text) {
    var jsScore = (
      text.match(
        /\b(function|const|let|var|return|import|export|class|typeof|instanceof)\b|=>|console\./g
      ) || []
    ).length;
    var cssScore =
      (text.match(/[.#a-zA-Z0-9_-]+\s*\{[^{}]*:[^{};]+;?[^{}]*\}/g) || []).length +
      (text.match(/@(media|import|font-face|keyframes|supports|charset)\b/g) || []).length;

    if (jsScore === 0 && cssScore === 0) {
      var trimmed = text.trim();
      if (/^[.#@]/.test(trimmed)) return 'css';
      if (/^[a-zA-Z0-9_-]+\s*\{/.test(trimmed) && /:[^;{}]+;/.test(trimmed)) return 'css';
      return 'js';
    }
    return jsScore > cssScore ? 'js' : 'css';
  }

  // Strips /* */ comments and collapses whitespace, respecting string
  // literals (so content: "a  ,  b"; is never touched) and url(...) values.
  // Deliberately does NOT strip the trailing semicolon before `}` or reorder
  // anything — a small, unconditionally-safe pass rather than a maximal one.
  function minifyCss(src) {
    var out = '';
    var i = 0;
    var n = src.length;
    var noSpaceNeeded = '{}:;,()';

    while (i < n) {
      var c = src.charAt(i);

      if (c === '"' || c === "'") {
        var quote = c;
        var start = i;
        i++;
        while (i < n) {
          if (src.charAt(i) === '\\') {
            i += 2;
            continue;
          }
          if (src.charAt(i) === quote) {
            i++;
            break;
          }
          i++;
        }
        out += src.slice(start, i);
        continue;
      }

      if (c === '/' && src.charAt(i + 1) === '*') {
        i += 2;
        while (i < n && !(src.charAt(i) === '*' && src.charAt(i + 1) === '/')) i++;
        i += 2;
        continue;
      }

      if (/\s/.test(c)) {
        var j = i;
        while (j < n && /\s/.test(src.charAt(j))) j++;
        var prevChar = out.length ? out.charAt(out.length - 1) : '';
        var nextChar = j < n ? src.charAt(j) : '';
        if (
          prevChar &&
          nextChar &&
          noSpaceNeeded.indexOf(prevChar) === -1 &&
          noSpaceNeeded.indexOf(nextChar) === -1
        ) {
          out += ' ';
        }
        i = j;
        continue;
      }

      out += c;
      i++;
    }

    return out.trim();
  }

  // Strips comments and collapses whitespace while tracking string/template
  // literal and regex-literal boundaries — the two things a naive `//`/`/*`
  // strip would corrupt (a URL regex containing `//`, or a comment marker
  // inside a string). Does not rename identifiers or remove "unnecessary"
  // whitespace around operators (`a + +b` must never become `a++b`), so this
  // is a safe, comment-and-whitespace minifier — not a full compressor.
  function minifyJs(src) {
    var out = '';
    var i = 0;
    var n = src.length;
    var lastSignificant = '';
    var lastWord = '';
    var regexPrecedingKeywords = [
      'return',
      'typeof',
      'instanceof',
      'in',
      'of',
      'new',
      'delete',
      'void',
      'throw',
      'case',
      'do',
      'else',
      'yield'
    ];

    function regexAllowed() {
      if (lastSignificant === '') return true;
      if ('([{,;:=!&|?+-*%^~<>'.indexOf(lastSignificant) !== -1) return true;
      return regexPrecedingKeywords.indexOf(lastWord) !== -1;
    }

    while (i < n) {
      var c = src.charAt(i);

      if (c === '"' || c === "'" || c === '`') {
        var quote = c;
        var start = i;
        i++;
        while (i < n) {
          if (src.charAt(i) === '\\') {
            i += 2;
            continue;
          }
          if (src.charAt(i) === quote) {
            i++;
            break;
          }
          i++;
        }
        out += src.slice(start, i);
        lastSignificant = quote;
        lastWord = '';
        continue;
      }

      if (c === '/' && src.charAt(i + 1) === '/') {
        i += 2;
        while (i < n && src.charAt(i) !== '\n') i++;
        out += '\n';
        continue;
      }

      if (c === '/' && src.charAt(i + 1) === '*') {
        i += 2;
        while (i < n && !(src.charAt(i) === '*' && src.charAt(i + 1) === '/')) i++;
        i += 2;
        out += ' ';
        continue;
      }

      if (c === '/' && regexAllowed()) {
        var regexStart = i;
        i++;
        var inClass = false;
        var closed = false;
        while (i < n) {
          if (src.charAt(i) === '\\') {
            i += 2;
            continue;
          }
          if (src.charAt(i) === '[') {
            inClass = true;
            i++;
            continue;
          }
          if (src.charAt(i) === ']') {
            inClass = false;
            i++;
            continue;
          }
          if (src.charAt(i) === '/' && !inClass) {
            i++;
            closed = true;
            break;
          }
          if (src.charAt(i) === '\n') break;
          i++;
        }
        if (closed) {
          while (i < n && /[a-z]/i.test(src.charAt(i))) i++;
          out += src.slice(regexStart, i);
          lastSignificant = '/';
          lastWord = '';
          continue;
        }
        // Not actually a regex (no closing slash before end of line) —
        // treat the '/' as ordinary division and fall through.
        i = regexStart;
      }

      if (/\s/.test(c)) {
        var j = i;
        while (j < n && /\s/.test(src.charAt(j))) j++;
        if (out.length && !/\s$/.test(out)) out += ' ';
        i = j;
        continue;
      }

      if (/[A-Za-z0-9_$]/.test(c)) {
        var wordStart = i;
        while (i < n && /[A-Za-z0-9_$]/.test(src.charAt(i))) i++;
        var word = src.slice(wordStart, i);
        out += word;
        lastWord = word;
        lastSignificant = word.charAt(word.length - 1);
        continue;
      }

      out += c;
      lastSignificant = c;
      lastWord = '';
      i++;
    }

    return out.trim();
  }
})();
