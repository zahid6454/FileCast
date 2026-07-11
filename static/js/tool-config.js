// Reads the tool configuration from a non-executable JSON data island
// (<script type="application/json" id="tool-config">) and exposes it as
// window.TOOL_CONFIG. This keeps the page compatible with a strict
// `script-src 'self'` CSP: the JSON block is inert data, not executable
// script, so it is never blocked. Loaded before shared.js so every handler
// sees window.TOOL_CONFIG when it initializes.
(function () {
  'use strict';
  var el = document.getElementById('tool-config');
  if (!el) return;
  try {
    window.TOOL_CONFIG = JSON.parse(el.textContent);
  } catch (e) {
    console.error('FileCast: failed to parse tool config', e);
  }
})();
