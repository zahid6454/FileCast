## Frequently Asked Questions

### Is my data uploaded anywhere?

No. Every conversion happens entirely in your browser — nothing is sent to any server.

### How do I tell the tool which base my number is in?

Prefix it: `0x` for hexadecimal, `0b` for binary, `0o` for octal. Plain digits with no prefix are read as decimal. A number containing only the letters A-F with no prefix (like `FF`) is automatically treated as hex, since it can't be anything else.

### Can I convert more than one number at a time?

Yes. Put each number on its own line, and the tool converts all of them in one pass, showing all four representations for each.

### Does this handle negative numbers?

Yes — prefix a number with `-` and the sign is preserved across all four output representations. Note this is a simple signed magnitude (a minus sign shown in front), not two's complement binary representation.

### Does this handle very large numbers?

Yes. Conversions use arbitrary-precision arithmetic, so numbers far larger than what a 32-bit or 64-bit integer could normally hold still convert accurately, with no precision loss.
