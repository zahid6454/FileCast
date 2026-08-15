## MD5 vs SHA-256 — When to Use Each

| Feature | MD5 | SHA-256 |
|---|---|---|
| Digest length | 128 bits (32 hex characters) | 256 bits (64 hex characters) |
| Speed | Faster | Slower (still fast for normal use) |
| Collision resistance | Broken — collisions are practical to construct | No known practical collision attack |
| Suitable for security purposes | No | Yes |
| Common uses today | File integrity checksums, cache keys, non-adversarial deduplication | Digital signatures, TLS certificates, password hashing (with a proper KDF), blockchain |

Both produce a fixed-length fingerprint of the input. The difference is whether that fingerprint needs to hold up against someone deliberately trying to forge a match.

### Use MD5 When

- You're checking a downloaded file against a checksum the publisher provided, purely to catch accidental corruption.
- You need a quick, short key to deduplicate or index data where nobody is adversarially trying to create a collision.
- You're working with legacy systems or tools that specifically expect MD5.

### Use SHA-256 When

- Security matters at all — verifying a file from an untrusted source, generating an API signature, or anything where a forged match would be a problem.
- You're building something that will eventually need to interoperate with systems (TLS, Git, blockchain) that already standardize on SHA-256.
- You're not sure which to use — SHA-256 has no real downside for general-purpose hashing today.
