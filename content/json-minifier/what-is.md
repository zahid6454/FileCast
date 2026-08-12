## What Is JSON Minification?

Minification strips every byte of JSON that exists purely for human readability — indentation, line breaks, and the spaces after colons and commas — without touching the data itself. The result parses to exactly the same object; it's just smaller and harder for a person to read.

### Why Minify JSON?

Whitespace can easily account for 20-40% of a formatted JSON file's size, especially with deep nesting. For a config file baked into a build, a payload sent over the network, or a blob stored in a database, that whitespace is pure overhead — nothing reads it as anything other than bytes to transfer or store.

### How This Tool Works

This minifier runs entirely in your browser. Paste your JSON into the text area, click Minify, and get the smallest valid single-line output instantly. Your data is never uploaded to any server — minification happens locally on your device.
