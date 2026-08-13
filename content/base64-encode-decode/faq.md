## Frequently Asked Questions

### Is it safe to use this on sensitive data?

Yes. Encoding and decoding both happen entirely in your browser — nothing is uploaded to any server. That said, remember Base64 is not encryption: anyone who has the encoded string can decode it just as easily. Don't rely on it to keep secrets hidden.

### How does the tool know whether to encode or decode?

It checks whether what you pasted is valid Base64 (the right character set, correct padding) and whether it decodes to readable UTF-8 text. If both are true, it decodes; otherwise, it treats your input as plain text and encodes it.

### Can I force it to always encode, even if my text looks like Base64?

Not directly — the tool always auto-detects. If your plain text happens to look exactly like valid Base64 (e.g. it's only letters, numbers, `+`, `/`, and padding), it may be decoded instead of encoded. In that edge case, add a character outside the Base64 alphabet (like a space or punctuation) and it will encode as expected.

### Does this handle Unicode text, like emoji or non-English characters?

Yes. Text is encoded as UTF-8 bytes before Base64 encoding, and decoded output is interpreted as UTF-8, so accented characters, emoji, and non-Latin scripts all round-trip correctly.

### What's the difference between this and "Base64 URL-safe" encoding?

Standard Base64 uses `+` and `/`, which aren't safe inside URLs without additional escaping. This tool produces standard Base64. If you need the URL-safe variant (used by JWTs, which replaces `+`/`/` with `-`/`_` and drops padding), see our [JWT Decoder](/convert/jwt-decoder/) for that specific format.
