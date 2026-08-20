## What Is SVG Optimization?

SVG files exported from design tools like Illustrator, Figma, or Inkscape often carry extra content that has nothing to do with how the image actually looks: editor comments, empty metadata blocks, editor-specific attributes (like Inkscape's own namespaced fields), and formatting whitespace. None of it is visible when the SVG renders — it just adds to the file size.

Optimizing an SVG strips that cruft out while leaving the visible artwork completely unchanged — same shapes, same colors, same rendering, just fewer bytes.

### Why Optimize an SVG?

A cleaner SVG loads faster, is easier to read if you ever open it in a code editor, and doesn't leak details about which design tool produced it. For icons and logos used across a website, the savings from stripping editor cruft add up across every page that loads them.

### What This Tool Removes

XML comments, `<metadata>` blocks entirely (they're never rendered), `<title>` and `<desc>` elements only when they're empty (non-empty ones are kept, since they matter for accessibility), editor-specific attributes and elements (Inkscape's and Sodipodi's own namespaced fields), and insignificant whitespace between tags. Whitespace inside `<text>`, `<style>`, and `<script>` elements — where it can affect what's rendered — is always preserved.

### How This Tool Works

This tool runs entirely in your browser, parsing the SVG's XML structure and removing only the cruft described above — it never touches the actual path data, shapes, or styling. Your file is never uploaded to any server.
