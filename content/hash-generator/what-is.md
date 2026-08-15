## What Is a Hash Generator?

A hash function takes any input — a word, a password, an entire file — and produces a fixed-length string of characters called a hash (or digest) that's unique to that exact input. Change even one character of the input and the hash comes out completely different. Feed the same input in twice and you always get the same hash back.

This tool computes two of the most common hash algorithms at once: **MD5** (128-bit, fast, still widely used for non-security checksums) and **SHA-256** (256-bit, part of the SHA-2 family, the standard choice when security actually matters).

### MD5 vs SHA-256

MD5 is fast and produces a shorter digest, which made it popular for file checksums and cache keys. It's been cryptographically broken since the mid-2000s, though — it's possible to deliberately construct two different inputs that produce the same MD5 hash (a "collision"), so it should never be used for passwords, digital signatures, or anything where an attacker might benefit from forging a match. SHA-256 has no known practical collision attack and is the standard used in TLS certificates, Bitcoin, and Git's newer object format.

### How This Tool Works

Type or paste your text and click Generate. Both hashes are computed instantly in your browser — SHA-256 uses your browser's own built-in Web Crypto API, and MD5 is computed with a small, self-contained implementation, since browsers don't expose MD5 natively. Nothing is uploaded; your text never leaves your device.
