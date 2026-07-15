// Safe DOM builders — the P23 firewall for the admin SPA (Phase 4 §6).
//
// The admin panel renders admin-controlled AND attacker-controlled strings
// (error_message/error_type/browser come from the *public, anonymous*
// POST /api/v1/errors — a stored-XSS vector aimed at whoever opens the feed).
// The non-negotiable rule: server/user data reaches the DOM ONLY via
// textContent / setAttribute / createElementNS text nodes — NEVER innerHTML,
// insertAdjacentHTML, outerHTML, or string-concatenated markup. Event handlers
// are bound by callers via addEventListener, never as on* attributes (P7).
//
// This module contains NO innerHTML at all. Callers that want a static, zero-
// interpolation developer string still go through h()/text() — there is no
// escape hatch here by design.
(function () {
  'use strict';
  var ADMIN = (window.ADMIN = window.ADMIN || {});

  var SVG_NS = 'http://www.w3.org/2000/svg';

  // Append a string (as a text node) or an existing node to `parent`.
  // `null`/`undefined`/`false` children are skipped so callers can write
  // `cond && h(...)` inline.
  function append(parent, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) {
      child.forEach(function (c) {
        append(parent, c);
      });
      return;
    }
    if (child instanceof Node) {
      parent.appendChild(child);
    } else {
      // Strings/numbers become TEXT NODES — the interpolation firewall.
      parent.appendChild(document.createTextNode(String(child)));
    }
  }

  // Apply attributes/props. Keys are set via setAttribute (safe: attribute
  // values are never parsed as markup). Special-cased: `class`, `dataset`,
  // `disabled`/`checked`/`hidden` (boolean props), and DOM props like `value`.
  function applyAttrs(node, attrs) {
    if (!attrs) return;
    Object.keys(attrs).forEach(function (key) {
      var val = attrs[key];
      if (val === null || val === undefined || val === false) return;
      if (key === 'class' || key === 'className') {
        node.setAttribute('class', val);
      } else if (key === 'dataset') {
        Object.keys(val).forEach(function (dk) {
          node.dataset[dk] = val[dk];
        });
      } else if (key === 'value') {
        // Form-control value is a property, not an attribute (P23-safe: the
        // browser never parses .value as HTML).
        node.value = val;
      } else if (key === 'disabled' || key === 'checked' || key === 'hidden') {
        if (val === true) node.setAttribute(key, '');
      } else {
        node.setAttribute(key, String(val));
      }
    });
  }

  // h(tag, attrs?, children?) — build an HTML element safely.
  // - attrs: plain object of attributes (see applyAttrs). Omit or pass a
  //   node/string/array to skip straight to children.
  // - children: string (→ text node), Node, or (nested) array of those.
  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    if (
      attrs instanceof Node ||
      typeof attrs === 'string' ||
      typeof attrs === 'number' ||
      Array.isArray(attrs)
    ) {
      // Called as h(tag, children) — shift.
      children = attrs;
      attrs = null;
    }
    applyAttrs(node, attrs);
    append(node, children);
    return node;
  }

  // svg(tag, attrs?, children?) — same contract via createElementNS for chart
  // nodes. <text> labels get their value as a text-node child (tool names are
  // admin data but still go through the firewall — R10).
  function svg(tag, attrs, children) {
    var node = document.createElementNS(SVG_NS, tag);
    if (
      attrs instanceof Node ||
      typeof attrs === 'string' ||
      typeof attrs === 'number' ||
      Array.isArray(attrs)
    ) {
      children = attrs;
      attrs = null;
    }
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var val = attrs[key];
        if (val === null || val === undefined || val === false) return;
        if (key === 'class' || key === 'className') {
          node.setAttribute('class', val);
        } else {
          node.setAttribute(key, String(val));
        }
      });
    }
    append(node, children);
    return node;
  }

  // A bare text node (for readability at call sites).
  function text(value) {
    return document.createTextNode(value === undefined ? '' : String(value));
  }

  // Empty a container without innerHTML='' (keeps the no-innerHTML audit clean
  // and drops any listeners on removed subtrees).
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  // safeHref(url) — sanitize an admin-authored announcement link. Allow only
  // http:/https: and root-relative (`/…`) URLs; reject javascript:/data:/vbscript:
  // and everything else → return '#' so the link is inert (an admin-authored
  // `javascript:` link is still an XSS-equivalent foot-gun — §6).
  function safeHref(url) {
    if (typeof url !== 'string') return '#';
    var trimmed = url.trim();
    if (trimmed === '') return '#';
    // Root-relative candidate. Don't trust the two-char prefix alone: browsers
    // fold backslashes to slashes, so `/\evil.com` (prefix looks root-relative)
    // resolves to `//evil.com` — offsite. Validate it actually stays same-origin.
    if (trimmed.charAt(0) === '/' && trimmed.charAt(1) !== '/') {
      try {
        var rel = new URL(trimmed, window.location.href);
        if (rel.origin === window.location.origin) return trimmed;
      } catch (e) {
        /* fall through to inert */
      }
      return '#';
    }
    // Anything with a scheme must be http/https. Parse against the current
    // origin so protocol-relative (`//evil`) resolves to a real protocol.
    try {
      var parsed = new URL(trimmed, window.location.href);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.href;
      }
    } catch (e) {
      /* fall through to inert */
    }
    return '#';
  }

  ADMIN.dom = {
    h: h,
    svg: svg,
    text: text,
    clear: clear,
    append: append,
    safeHref: safeHref,
  };
})();
