## CSV vs XML — When to Use Each

| Feature | CSV | XML |
|---|---|---|
| Structure | Flat rows and columns | Nested, self-describing tags |
| Nesting | Not supported | Fully supported |
| Schema validation | None built-in | XSD/DTD support |
| File size | Compact | Larger (repeated tag names) |
| Tool support | Spreadsheets, legacy exports | Enterprise systems, SOAP APIs, config files |
| Best uses | Reports, exports, simple lists | Data exchange with legacy/enterprise systems |

CSV is compact and easy to open in a spreadsheet. XML is verbose but self-describing and widely supported by older enterprise tooling that predates JSON.

### Keep CSV When

- You're working in Excel or Google Sheets and need a format they handle natively.
- Your data is genuinely flat, with no nested relationships to express.
- File size matters and you don't need tag-level structure.

### Convert to XML When

- A target system (ERP, SOAP API, legacy platform) specifically requires XML input.
- You need schema validation (XSD) as part of a data contract.
- You're integrating with older Java/.NET tooling that reads XML configuration or data files.
