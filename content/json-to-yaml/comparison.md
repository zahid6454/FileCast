## JSON vs YAML — When to Use Each

Both formats represent structured data, but they are optimized for different audiences.

| Feature | JSON | YAML |
|---|---|---|
| Syntax | Braces and brackets | Indentation-based |
| Readability | Compact, dense | Clean, easy to scan |
| Comments | Not supported | Supported with # |
| Quoting | Keys and strings must be quoted | Quotes usually optional |
| Best for | APIs, JavaScript apps, data exchange | Config files, DevOps, infrastructure |

### Keep JSON When

- The data is consumed by an API or JavaScript application
- The receiving system requires JSON format
- You need strict, unambiguous parsing with no whitespace sensitivity
- The data will be processed programmatically, not read by humans

### Convert to YAML When

- You are writing configuration for Docker, Kubernetes, or CI/CD pipelines
- The file will be read and edited by people regularly
- You want to add comments explaining configuration choices
- The target tool expects YAML input
- You prefer a cleaner visual layout for nested settings
