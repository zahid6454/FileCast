## Frequently Asked Questions

### Is it safe to validate my data here?

Yes. This tool processes your data entirely in your browser. Nothing is uploaded to any server — validation happens locally on your device. No one else can see or access your data during or after validation.

### What exactly does "valid JSON" mean?

It means the text follows JSON's syntax rules exactly — matched braces and brackets, double-quoted keys and strings, no trailing commas, no comments. It says nothing about whether the data itself makes sense for your application, only that it parses correctly.

### How precise is the error location?

The tool reports the line and column where the parser gave up, based on the character position JavaScript's own JSON parser reports. For most common mistakes (a missing comma, an extra brace) that's exactly where the problem is; for a few (like a missing closing brace at the very end), the reported position may be a line or two after the actual mistake, since the parser doesn't realize anything's wrong until it runs out of input.

### Does this fix invalid JSON automatically?

No. It tells you where the problem is so you can fix it yourself. Automatically guessing a fix risks silently changing your data in a way you didn't intend.

### Can I validate multiple files at once?

This tool validates one input at a time. Paste your JSON, check the result, and repeat for additional files.
