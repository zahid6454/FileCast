## Formatted vs. Minified JSON

| Feature | Formatted JSON | Minified JSON |
|---|---|---|
| Layout | Indented, one field per line | Single line, no extra spaces |
| File size | Larger | Smallest possible for the same data |
| Human readability | Easy to scan | Hard to scan |
| Best for | Debugging, code review | Network transfer, storage, embedding |

### Keep JSON Formatted When

- A person needs to read or edit it
- It's checked into version control, where diffs matter
- You're actively debugging its structure

### Minify JSON When

- It's being sent over the network and size matters
- It's embedded inside another minified file (a bundled JS asset, for example)
- It's stored in a database column or cache and never read directly by a person
