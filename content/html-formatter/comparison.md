## Minified vs. Formatted HTML

| Feature | Minified HTML | Formatted HTML |
|---|---|---|
| Layout | Single line, no spaces | Indented, one element per line |
| File size | Smallest | Larger (whitespace adds bytes) |
| Human readability | Hard to scan | Easy to scan and diff |
| Best for | Production page weight | Debugging, code review, documentation |

### Keep HTML Minified When

- It's the version actually served to visitors (page weight matters)
- It's embedded inside another minified asset
- It's cached or stored and never read directly

### Format HTML When

- You're debugging a layout issue in "View Source" output
- You need to review a template change in a pull request
- You're documenting a markup snippet for other developers
- You're copying HTML out of a browser's dev tools for reuse elsewhere
