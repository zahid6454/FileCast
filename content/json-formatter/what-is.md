## What Is JSON Formatting?

JSON (JavaScript Object Notation) is valid whether it's spread across many indented lines or crammed onto one — the parser doesn't care about whitespace. But people do. An API response, a minified config file, or a single-line log entry is technically readable JSON that's practically impossible to scan by eye.

Formatting (also called "pretty-printing" or "beautifying") adds consistent indentation and line breaks so nested objects and arrays are visually easy to follow, without changing a single value in the data.

<div class="eyebrow">At a Glance</div>
<div class="stat-strip">
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg></span>
    <span class="stat-tile__label">Instant, in your browser</span>
    <span class="stat-tile__sub">No upload, no server round-trip</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg></span>
    <span class="stat-tile__label">2-space indentation</span>
    <span class="stat-tile__sub">Consistent, readable structure</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg></span>
    <span class="stat-tile__label">No value changes</span>
    <span class="stat-tile__sub">Same data, just readable</span>
  </div>
</div>

### Why Format JSON?

Minified or single-line JSON is common — APIs return it compact to save bandwidth, and build tools strip whitespace from config files. But when you need to actually read the structure, debug a response, or review a diff, that compactness works against you. Formatting turns it back into something a human can follow.

### How This Tool Works

<div class="callout">
  <svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>
  <p>This formatter runs <strong>entirely in your browser</strong>. Paste your JSON into the text area, click Format, and get properly indented output instantly. Your data is never uploaded to any server — the formatting happens locally on your device.</p>
</div>
