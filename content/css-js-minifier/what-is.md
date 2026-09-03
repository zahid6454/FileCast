## What Is CSS/JS Minification?

Minification removes the parts of a CSS or JavaScript file that exist purely for a human developer's benefit — comments and formatting whitespace — without changing what the code does. A minified file behaves identically to its source; it's just smaller and harder for a person to read.

<div class="eyebrow">At a Glance</div>
<div class="stat-strip">
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-auto"></use></svg></span>
    <span class="stat-tile__label">Auto-detects CSS or JS</span>
    <span class="stat-tile__sub">Paste either — no format picker</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg></span>
    <span class="stat-tile__label">String & regex safe</span>
    <span class="stat-tile__sub">Never mistakes code for comments</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg></span>
    <span class="stat-tile__label">Runs in your browser</span>
    <span class="stat-tile__sub">No build step, no upload</span>
  </div>
</div>

### Why Minify CSS or JavaScript?

Every byte of a stylesheet or script has to download before a page can finish rendering. Comments and indentation add up, especially across a large file, and none of it does anything for the visitor — stripping it is pure savings with no functional cost.

### How This Tool Works

<div class="callout">
  <svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>
  <p>This minifier runs <strong>entirely in your browser</strong>. Paste CSS or JavaScript into the text area — it automatically detects which one you pasted — and click Minify. It safely strips comments and unnecessary whitespace while respecting string literals, template literals, and (for JavaScript) regular expression syntax, so a URL like <code>http://</code> inside a regex or a comment marker inside a string is never mistaken for real code. Your data is never uploaded to any server — minification happens locally on your device.</p>
</div>

This tool does not rename variables or otherwise restructure your code — see the comparison below for what that distinction means in practice.
