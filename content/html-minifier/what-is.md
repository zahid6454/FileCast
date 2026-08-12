## What Is HTML Minification?

Minification strips the parts of an HTML document that exist purely for a human editor's benefit — comments and the indentation between tags — without changing what the page renders. Browsers already ignore most whitespace between tags, so removing it costs nothing visually while trimming page weight.

### Why Minify HTML?

Comments and formatting whitespace can add up across a large template, and every byte shipped to a visitor is a byte that has to download before the page renders. Minifying HTML before deployment removes that overhead for zero visual cost.

### How This Tool Works

This minifier runs entirely in your browser. Paste your HTML into the text area, click Minify, and get compact output instantly. It removes comments and collapses whitespace between tags, while leaving the exact content of `<pre>`, `<textarea>`, `<script>`, and `<style>` blocks untouched — those are where whitespace can be meaningful. Your data is never uploaded to any server — minification happens locally on your device.
