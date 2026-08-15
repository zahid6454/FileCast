## XML vs YAML — When to Use Each

| Feature | XML | YAML |
|---|---|---|
| Structure markers | Opening/closing tags | Indentation |
| Readability | Verbose | Compact, easy to scan |
| Schema validation | XSD/DTD, widely supported | Less standardized |
| Comments | `<!-- -->` | `#` (more common in practice) |
| Common uses | Enterprise systems, SOAP APIs, legacy config | Docker, Kubernetes, CI/CD, modern app config |

XML's explicit tags make it easy to validate strictly. YAML's indentation-based syntax makes it easier for a person to read and edit directly.

### Keep XML When

- A target system (ERP, SOAP API, legacy platform) specifically requires XML.
- You need strict schema validation (XSD) as part of a data contract.

### Convert to YAML When

- You're writing configuration for Docker, Kubernetes, GitHub Actions, or similar YAML-first tooling.
- Humans will be reading or editing the file directly, and readability matters more than strict validation.
- You want a more compact representation of the same structured data.
