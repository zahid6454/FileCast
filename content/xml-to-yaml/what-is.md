## What Is XML to YAML Conversion?

XML (eXtensible Markup Language) structures data with opening and closing tags — verbose, but explicit and well-suited to schema validation. YAML (YAML Ain't Markup Language) structures the same kind of nested data using indentation instead of tags, which makes it dramatically easier for a human to read and edit by hand.

Converting XML to YAML preserves the same nested structure — elements become keys, attributes become `@`-prefixed keys, repeated sibling elements become lists — but strips away the tag markup in favor of clean, indented text.

### Why Convert to YAML?

- Modern configuration formats (Docker Compose, Kubernetes, GitHub Actions, Ansible) are YAML-first, not XML.
- YAML has no closing tags to match up, which makes hand-editing far less error-prone than XML.
- A YAML file is typically shorter and easier to scan than the equivalent XML.
- Comments are supported natively in YAML (`#`), unlike XML's more awkward `<!-- -->` syntax.

### How This Tool Works

Paste your XML and the conversion happens instantly in your browser. Each element becomes a YAML key, attributes are preserved with an `@` prefix, and repeated elements become a YAML list. Nothing is uploaded — your data never leaves your device.
