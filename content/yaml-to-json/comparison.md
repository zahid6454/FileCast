## YAML vs JSON — When to Use Each

Both formats carry the same types of data, but they serve different purposes.

| Feature | YAML | JSON |
|---|---|---|
| Syntax | Indentation-based | Braces and brackets |
| Readability | Clean, human-friendly | Compact, dense |
| Comments | Supported with # | Not supported |
| Strictness | Flexible, forgiving | Strict, unambiguous |
| Best for | Config files, DevOps tools | APIs, data exchange, programming |

### Keep YAML When

- The file is a configuration for Docker, Kubernetes, or CI/CD
- Humans will read and edit the file regularly
- You need inline comments to document settings
- The consuming tool expects YAML format

### Convert to JSON When

- You need to send the data to an API endpoint
- The receiving application only accepts JSON
- You are processing the data in JavaScript, Python, or another language
- You want strict parsing with no ambiguity from indentation
- The data will be stored in a database or cache that uses JSON
