## Minified vs. Formatted JSON

Both represent exactly the same data — the only difference is whitespace.

| Feature | Minified JSON | Formatted JSON |
|---|---|---|
| Layout | Single line, no spaces | Indented, one field per line |
| File size | Smallest | Larger (whitespace adds bytes) |
| Human readability | Hard to scan | Easy to scan and diff |
| Best for | API responses, storage, transfer | Debugging, code review, documentation |

### Keep JSON Minified When

- It's being sent over the network (every byte counts)
- It's stored in a database column or cache
- It's embedded in another file and never read directly

### Format JSON When

- You're debugging an API response or a config file
- You need to review changes in a pull request
- You're documenting a JSON structure for other developers
- You're pasting an example into documentation or a bug report
