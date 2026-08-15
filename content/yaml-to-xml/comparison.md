## YAML vs XML — When to Use Each

| Feature | YAML | XML |
|---|---|---|
| Structure markers | Indentation | Opening/closing tags |
| Readability | Compact, easy to scan | Verbose |
| Schema validation | Less standardized | XSD/DTD, widely supported |
| Common uses | Docker, Kubernetes, CI/CD, modern app config | Enterprise systems, SOAP APIs, legacy config |
| Tool support | Modern DevOps tooling | Enterprise and legacy platforms |

YAML is easier to write and read by hand. XML is more verbose but is still the required format for a lot of older, schema-driven systems.

### Keep YAML When

- You're writing configuration for Docker, Kubernetes, GitHub Actions, or similar YAML-first tooling.
- Human readability matters more than strict schema validation.

### Convert to XML When

- A target system (ERP, SOAP API, legacy platform) specifically requires XML input.
- You need schema validation (XSD) as part of a data exchange contract.
- You're integrating with older Java/.NET tooling that only reads XML configuration or data files.
