## Frequently Asked Questions

### Is it safe to convert my data here?

Yes. This tool runs entirely in your browser. Your XML is read and processed on your own device — nothing is uploaded to a server. Once you close or refresh the page, the data is gone.

### What happens to XML attributes?

Attributes are preserved as YAML keys prefixed with `@` — for example, `<user id="42">` becomes a `user` mapping with an `@id: 42` entry alongside its other children. This keeps attribute data from being silently dropped.

### What happens to repeated elements?

If an element appears more than once at the same level (like multiple `<item>` tags inside a `<list>`), they're converted into a YAML list rather than overwriting each other.

### Are numbers and booleans detected automatically?

Yes. Element text that looks like a number (`42`, `3.14`) or a boolean (`true`, `false`) is converted to that type in the YAML output, rather than staying a quoted string.

### What if my XML is invalid?

The tool validates your XML before converting. If it's malformed — an unclosed tag, mismatched nesting — you'll get a clear error message describing the problem instead of a broken or partial conversion.
