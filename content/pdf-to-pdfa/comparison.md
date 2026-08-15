## PDF/A Metadata Tagging vs Full PDF/A Conversion

"Convert to PDF/A" can mean two different things depending on the tool. Here's how the quick metadata tagging this tool does compares to a full, validated conversion.

| Consideration | This Tool (Metadata Tagging) | Full PDF/A Conversion (Acrobat Pro, LibreOffice) |
|---|---|---|
| Adds PDF/A identification metadata | Yes | Yes |
| Verifies all fonts are embedded | No | Yes |
| Converts color spaces / adds ICC profile | No | Yes |
| Strips disallowed features (encryption, JavaScript) | No | Yes |
| Passes a formal PDF/A validator (veraPDF) | Not guaranteed | Yes, when done correctly |
| Speed | Seconds | Minutes, requires the software installed |

### Use This Tool When

- You need a quick, no-install way to add PDF/A identification to a document
- Full ISO 19005 certification isn't a hard requirement for your use case
- You're preparing a document for a system that checks for PDF/A metadata but doesn't run a strict validator

### Use a Full Conversion Tool When

- You need a document to pass formal PDF/A validation (a legal filing, a regulated archive with strict acceptance checks)
- The source PDF has non-embedded fonts, transparency, or other features that need to be corrected, not just tagged
- Certified compliance is a contractual or regulatory requirement
