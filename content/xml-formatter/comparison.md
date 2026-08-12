## Minified vs. Formatted XML

| Feature | Minified XML | Formatted XML |
|---|---|---|
| Layout | Single line, no spaces | Indented, one element per line |
| File size | Smallest | Larger (whitespace adds bytes) |
| Human readability | Hard to scan | Easy to scan and diff |
| Best for | API transfer, storage | Debugging, code review, documentation |

### Keep XML Minified When

- It's being sent over the network (every byte counts)
- It's stored or cached and never read directly
- It's embedded inside another file

### Format XML When

- You're debugging a SOAP response or a config file
- You need to review changes in a pull request
- You're documenting an XML schema or example for other developers
- You're inspecting an RSS/Atom feed or an Android layout file by hand
