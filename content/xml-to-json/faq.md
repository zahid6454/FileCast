## Frequently Asked Questions

### Is it safe to convert my data here?

Yes. This tool processes your data entirely in your browser. Nothing is uploaded to any server — the conversion happens locally on your device. No one else can see or access your data during or after conversion.

### How are XML attributes handled?

Attributes are converted to JSON keys prefixed with the @ symbol. For example, an XML element like `<item id="5">` becomes `{"@id": 5}` in the JSON output. This convention preserves attribute data clearly.

### What happens with empty or self-closing tags?

Empty elements like `<value/>` are converted to null in the JSON output. This keeps the structure intact while representing the absence of content in a way that JSON handles naturally.

### Are CDATA sections supported?

Yes. CDATA sections are treated as regular text content. The tool extracts the text inside the CDATA block and places it in the corresponding JSON value without any special wrapping.

### Can I convert multiple files at once?

This tool converts one input at a time. Paste your XML, convert it, and copy or download the result. For additional data, clear the input and repeat the process.
