// Anti-FOUC theme applier (P20). Render-blocking, loaded in <head> BEFORE the
// CSS link so `data-theme` is set on <html> before styles first apply — the
// palette is correct on first paint, no flash of the wrong theme.
//
// This MUST be an external same-origin file (not an inline snippet) to pass a
// strict `script-src 'self'` CSP. It stays tiny and is cached after first load.
//
// Single source of truth: localStorage['fc_theme'] ∈ {'light','dark', absent}.
//   'light' | 'dark' → set data-theme explicitly (an explicit choice always wins)
//   absent (system)  → leave data-theme unset so `prefers-color-scheme` governs
(function () {
  'use strict';
  try {
    var theme = localStorage.getItem('fc_theme');
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.dataset.theme = theme;
    }
  } catch (e) {
    // localStorage can throw (privacy mode / disabled). Fall back to system.
  }
})();
