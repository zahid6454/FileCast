## Frequently Asked Questions

### Is it safe to convert my data here?

Yes. This tool runs entirely in your browser. Your YAML is read and processed on your own device — nothing is uploaded to a server. Once you close or refresh the page, the data is gone.

### What do list items become in the XML output?

Each item in a YAML list becomes a repeated `<item>` element inside its parent tag. For example, a `colors:` list with three entries becomes a `<colors>` element containing three `<item>` children.

### What happens to keys that aren't valid XML tag names?

XML element names can't contain spaces or most punctuation, and can't start with a digit. Any YAML key that isn't already valid is automatically cleaned up the same way — spaces and special characters become underscores — so the output is always well-formed XML.

### Are special characters like `&` and `<` escaped automatically?

Yes. Any characters in your YAML values that would otherwise break the XML (`&`, `<`, `>`, quotes) are automatically escaped, so the output is valid even if your original values contain them.

### What if my YAML is invalid?

The tool parses your YAML before converting. If the top-level value isn't a mapping or list — for example, a single scalar with nothing to nest it under — you'll get a clear error message rather than a broken conversion.
