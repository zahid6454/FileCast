(function () {
  'use strict';

  // Line-number gutter for the plain <textarea> inputs/outputs on tool-text.html
  // and tool-diff.html. Wraps each `.text-editor` container's textarea with a
  // synced-scroll number column. Requires the textarea to NOT soft-wrap (see
  // style.css: `.text-editor .text-input-area/.text-output-area` set
  // `white-space: pre; overflow-x: auto;`) — with soft-wrap on, one source
  // line can span multiple visual rows and the numbers would drift out of
  // alignment with the text they label.

  function lineCount(text) {
    var n = 1;
    for (var i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) n++;
    }
    return n;
  }

  function buildNumbers(n) {
    var parts = new Array(n);
    for (var i = 0; i < n; i++) parts[i] = i + 1;
    return parts.join('\n');
  }

  function wire(wrap) {
    var textarea = wrap.querySelector('textarea');
    var gutter = wrap.querySelector('.text-editor__gutter');
    if (!textarea || !gutter) return;

    var inner = document.createElement('div');
    inner.className = 'text-editor__gutter-inner';
    gutter.appendChild(inner);

    function render() {
      inner.textContent = buildNumbers(lineCount(textarea.value));
    }
    function syncScroll() {
      inner.style.transform = 'translateY(-' + textarea.scrollTop + 'px)';
    }
    // The gutter has no height of its own — normally it matches the textarea
    // via `.text-editor`'s flex `align-items: stretch`. But a <textarea> with
    // native `resize` doesn't reliably keep participating in that stretch
    // after the user drags its handle (browsers treat a manually-resized
    // textarea's box somewhat like an out-of-flow override), so a drag can
    // leave the gutter's box a different height than the textarea next to
    // it — not just its numbers out of sync, but the whole column mismatched.
    // Setting the height explicitly here, driven by the same ResizeObserver
    // as syncScroll() below, keeps the two boxes pinned together regardless
    // of how the browser resolves the flex stretch.
    function matchHeight() {
      gutter.style.height = textarea.offsetHeight + 'px';
    }

    textarea.addEventListener('input', function () {
      render();
      syncScroll();
    });
    textarea.addEventListener('scroll', syncScroll);

    render();
    matchHeight();
    syncScroll();

    // Manual resize (drag handle) fires neither 'input' nor 'scroll' — a
    // ResizeObserver is the only way to catch it and re-run both fixups.
    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        matchHeight();
        syncScroll();
      }).observe(textarea);
    }

    // Exposed so code that sets `.value` programmatically (worker results,
    // reset, the Prettier button) can ask the gutter to catch up — those
    // assignments don't fire an 'input' event. Also re-runs matchHeight():
    // the output textarea's wrapper starts hidden (display: none, so
    // offsetHeight is 0 at wire() time) and only gets its real size once
    // shared-text.js's showResult() reveals it — this is the call that
    // fires right after that reveal, so it can't skip the same fixup
    // syncScroll() gets. Not left to the ResizeObserver above alone: a
    // display:none-to-visible transition should also fire it, but that path
    // has no test coverage here (jsdom has no ResizeObserver at all), so
    // this call stays the guaranteed, synchronous path.
    textarea._refreshLineNumbers = function () {
      render();
      matchHeight();
      syncScroll();
    };
  }

  function init() {
    var wraps = document.querySelectorAll('.text-editor');
    for (var i = 0; i < wraps.length; i++) wire(wraps[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.FC = window.FC || {};
  window.FC.refreshLineNumbers = function (textarea) {
    if (textarea && textarea._refreshLineNumbers) textarea._refreshLineNumbers();
  };
})();
