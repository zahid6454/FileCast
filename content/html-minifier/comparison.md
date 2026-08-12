## Formatted vs. Minified HTML

| Feature | Formatted HTML | Minified HTML |
|---|---|---|
| Layout | Indented, one element per line | Comments and inter-tag whitespace removed |
| File size | Larger | Smaller |
| Human readability | Easy to scan | Hard to scan |
| Best for | Development, debugging | Production page weight |

### What Gets Removed

- HTML comments (`<!-- ... -->`)
- Line breaks and indentation between tags

### What Stays Untouched

- The exact content of `<pre>` and `<textarea>` (whitespace there is part of what's displayed or submitted)
- The exact content of `<script>` and `<style>` blocks (whitespace inside JS/CSS can be meaningful, and needs its own minifier — see our [CSS/JS Minifier](/convert/css-js-minifier/))
- All attributes, attribute values, and text content
