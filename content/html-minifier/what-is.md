## What Is HTML Minification?

Minification strips the parts of an HTML document that exist purely for a human editor's benefit — comments and the indentation between tags — without changing what the page renders. Browsers already ignore most whitespace between tags, so removing it costs nothing visually while trimming page weight.

<div class="eyebrow">At a Glance</div>
<div class="stat-strip">
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg></span>
    <span class="stat-tile__label">Instant, in your browser</span>
    <span class="stat-tile__sub">No upload, no server round-trip</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-minimize"></use></svg></span>
    <span class="stat-tile__label">Comments & whitespace stripped</span>
    <span class="stat-tile__sub">Zero change to what renders</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg></span>
    <span class="stat-tile__label">Meaningful whitespace preserved</span>
    <span class="stat-tile__sub">pre, textarea, script, style untouched</span>
  </div>
</div>

### Why Minify HTML?

Comments and formatting whitespace can add up across a large template, and every byte shipped to a visitor is a byte that has to download before the page renders. Minifying HTML before deployment removes that overhead for zero visual cost.

### How This Tool Works

<div class="callout">
  <svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>
  <p>This minifier runs <strong>entirely in your browser</strong>. Paste your HTML into the text area, click Minify, and get compact output instantly. It removes comments and collapses whitespace between tags, while leaving the exact content of <code>&lt;pre&gt;</code>, <code>&lt;textarea&gt;</code>, <code>&lt;script&gt;</code>, and <code>&lt;style&gt;</code> blocks untouched — those are where whitespace can be meaningful. Your data is never uploaded to any server — minification happens locally on your device.</p>
</div>
