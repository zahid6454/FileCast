## What Is CSS/JS Minification?

Minification removes the parts of a CSS or JavaScript file that exist purely for a human developer's benefit — comments and formatting whitespace — without changing what the code does. A minified file behaves identically to its source; it's just smaller and harder for a person to read.

### Why Minify CSS or JavaScript?

Every byte of a stylesheet or script has to download before a page can finish rendering. Comments and indentation add up, especially across a large file, and none of it does anything for the visitor — stripping it is pure savings with no functional cost.

### How This Tool Works

This minifier runs entirely in your browser. Paste CSS or JavaScript into the text area — it automatically detects which one you pasted — and click Minify. It safely strips comments and unnecessary whitespace while respecting string literals, template literals, and (for JavaScript) regular expression syntax, so a URL like `http://` inside a regex or a comment marker inside a string is never mistaken for real code. Your data is never uploaded to any server — minification happens locally on your device.

This tool does not rename variables or otherwise restructure your code — see the comparison below for what that distinction means in practice.
