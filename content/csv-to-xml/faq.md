## Frequently Asked Questions

### Is it safe to convert my data here?

Yes. This tool runs entirely in your browser. Your CSV is read and processed on your own device — nothing is uploaded to a server. Once you close or refresh the page, the data is gone.

### Does the first row become the element names?

Yes. The first row of your CSV is treated as headers. Each subsequent row becomes a `<row>` element, with each column's value wrapped in a tag named after its header — for example, a header of `name,email` produces `<name>` and `<email>` tags inside each `<row>`.

### What happens if a header isn't a valid XML tag name?

XML tag names can't contain spaces or most punctuation, and can't start with a digit. Any header that isn't already valid is automatically cleaned up — spaces and special characters become underscores, and a leading digit gets an underscore prefix — so the output is always well-formed XML.

### Are special characters like `&` and `<` escaped automatically?

Yes. Any characters in your data that would otherwise break the XML (`&`, `<`, `>`, quotes) are automatically escaped, so the output is valid XML even if your original values contain them.

### Can I convert multiple files at once?

This tool processes one file at a time. If you have several CSV files to convert, run each one through individually so you can review each result before moving on to the next.
