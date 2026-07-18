// Anti-FOUC theme applier + auth marker (P20 / Phase 5). Render-blocking, loaded
// in <head> BEFORE the CSS link so `data-theme` and `data-auth` are set on <html>
// before styles first apply — correct palette on first paint, and no flash of the
// signed-out account prompt for a signed-in visitor.
//
// External same-origin file (not inline) to pass a strict `script-src 'self'` CSP.
//
// Dark mode is a SIGNED-IN privilege (Phase 5): anonymous visitors are always
// light (never OS-driven dark), signed-in visitors get their stored choice, or
// system when none is stored. Gated on the fc_logged_in cookie (readable here,
// synchronously, with zero network).
(function () {
  'use strict';
  var de = document.documentElement;
  function cookie(name) {
    var m = document.cookie.match('(?:^|;\\s*)' + name + '=([^;]*)');
    return m ? m[1] : null;
  }
  var signedIn = cookie('fc_logged_in') === '1';
  de.dataset.auth = signedIn ? 'in' : 'out';
  try {
    if (signedIn) {
      var theme = localStorage.getItem('fc_theme');
      // 'light' | 'dark' → explicit; absent → system (prefers-color-scheme).
      if (theme === 'light' || theme === 'dark') de.dataset.theme = theme;
    } else {
      // Anonymous: force light so a dark OS preference can't turn the page dark.
      de.dataset.theme = 'light';
    }
  } catch (e) {
    if (!signedIn) de.dataset.theme = 'light';
  }
})();
