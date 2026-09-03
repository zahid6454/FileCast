## What Is JSON Minification?

Minification strips every byte of JSON that exists purely for human readability — indentation, line breaks, and the spaces after colons and commas — without touching the data itself. The result parses to exactly the same object; it's just smaller and harder for a person to read.

<div class="eyebrow">At a Glance</div>
<div class="stat-strip">
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg></span>
    <span class="stat-tile__label">Instant, in your browser</span>
    <span class="stat-tile__sub">No upload, no server round-trip</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-minimize"></use></svg></span>
    <span class="stat-tile__label">Smallest valid output</span>
    <span class="stat-tile__sub">Single line, no extra spaces</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg></span>
    <span class="stat-tile__label">Same data, byte for byte</span>
    <span class="stat-tile__sub">Parses to the identical object</span>
  </div>
</div>

### Why Minify JSON?

Whitespace can easily account for 20-40% of a formatted JSON file's size, especially with deep nesting. For a config file baked into a build, a payload sent over the network, or a blob stored in a database, that whitespace is pure overhead — nothing reads it as anything other than bytes to transfer or store.

### How This Tool Works

<div class="callout">
  <svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>
  <p>This minifier runs <strong>entirely in your browser</strong>. Paste your JSON into the text area, click Minify, and get the smallest valid single-line output instantly. Your data is never uploaded to any server — minification happens locally on your device.</p>
</div>
