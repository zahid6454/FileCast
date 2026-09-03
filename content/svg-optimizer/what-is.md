## What Is SVG Optimization?

SVG files exported from design tools like Illustrator, Figma, or Inkscape often carry extra content that has nothing to do with how the image actually looks: editor comments, empty metadata blocks, editor-specific attributes (like Inkscape's own namespaced fields), and formatting whitespace. None of it is visible when the SVG renders — it just adds to the file size.

Optimizing an SVG strips that cruft out while leaving the visible artwork completely unchanged — same shapes, same colors, same rendering, just fewer bytes.

### Why Optimize an SVG?

A cleaner SVG loads faster, is easier to read if you ever open it in a code editor, and doesn't leak details about which design tool produced it. For icons and logos used across a website, the savings from stripping editor cruft add up across every page that loads them.

### What This Tool Removes

XML comments, `<metadata>` blocks entirely (they're never rendered), `<title>` and `<desc>` elements only when they're empty (non-empty ones are kept, since they matter for accessibility), editor-specific attributes and elements (Inkscape's and Sodipodi's own namespaced fields), and insignificant whitespace between tags. Whitespace inside `<text>`, `<style>`, and `<script>` elements — where it can affect what's rendered — is always preserved.

<div class="eyebrow">At a Glance</div>
<div class="stat-strip">
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-minimize"></use></svg></span>
    <span class="stat-tile__label">Smaller file</span>
    <span class="stat-tile__sub">Editor cruft stripped</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg></span>
    <span class="stat-tile__label">Zero visual change</span>
    <span class="stat-tile__sub">Pixel-identical rendering</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-edit"></use></svg></span>
    <span class="stat-tile__label">Geometry untouched</span>
    <span class="stat-tile__sub">Paths &amp; shapes never modified</span>
  </div>
</div>

### How This Tool Works

<div class="callout">
  <svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>
  <p>This tool runs <strong>entirely in your browser</strong>, parsing the SVG's XML structure and removing only the cruft described above — it never touches the actual path data, shapes, or styling. Your file is never uploaded to any server.</p>
</div>
