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

    textarea.addEventListener('input', function () {
      render();
      syncScroll();
    });
    textarea.addEventListener('scroll', syncScroll);

    render();
    syncScroll();

    // Exposed so code that sets `.value` programmatically (worker results,
    // reset, the Prettier button) can ask the gutter to catch up — those
    // assignments don't fire an 'input' event.
    textarea._refreshLineNumbers = function () {
      render();
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
