## Frequently Asked Questions

### Is my data uploaded anywhere?

No. Encoding and decoding both happen entirely in your browser — nothing is sent to any server.

### How does the tool know whether to encode or decode?

It checks whether your input contains `%` followed by two hex digits (a percent-encoded sequence) and whether that decodes without error. If so, it decodes; otherwise, it treats your input as plain text and encodes it.

### Why did my `+` turn into `%2B` instead of staying a space?

This tool uses `encodeURIComponent`, the standard for encoding individual values (query parameters, path segments). It represents a literal space as `%20`. Some older systems use `+` for spaces specifically inside `application/x-www-form-urlencoded` form bodies — a different, narrower convention this tool doesn't target.

### Does this encode an entire URL, or just a value inside one?

It encodes whatever you paste as a single value — every reserved character gets escaped, including `/`, `:`, and `?`. If you paste a full URL, those structural characters will be encoded too, not just the query string parts. To build a full URL, encode each value separately and assemble the URL around the encoded pieces.

### Why does decoding sometimes fail with an error?

A malformed `%` sequence — like a stray `%` not followed by two valid hex digits, or a `%` sequence that doesn't form valid UTF-8 when several are combined — can't be decoded unambiguously. When that happens, the tool falls back to encoding your input instead of guessing.
