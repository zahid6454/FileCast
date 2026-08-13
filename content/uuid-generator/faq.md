## Frequently Asked Questions

### Are these UUIDs actually unique?

Practically, yes. A version 4 UUID has 122 random bits, giving roughly 5.3 undecillion possible values. Even generating billions of UUIDs per second, the chance of ever producing a duplicate is negligible for virtually any real-world use case.

### Is this safe to use for security purposes, like session tokens?

The randomness itself is safe — `crypto.randomUUID()` uses your browser's cryptographically secure random number generator, not a weak pseudo-random one. That said, a UUID alone isn't a full security solution: for authentication tokens, pair it with proper expiration, hashing, and server-side validation.

### Are the UUIDs generated on a server?

No. Every UUID is generated locally in your browser using the Web Crypto API. Nothing is sent anywhere, and this tool has no way to log or see the values you generate.

### What UUID version does this generate?

Version 4 — the randomly-generated variant, and the most commonly used one. It doesn't encode a timestamp, MAC address, or any other identifying information, unlike some other UUID versions.

### How many can I generate at once?

Up to 100 per click. For more, just click Generate again and combine the results, or download each batch as a text file.
