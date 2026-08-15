## Frequently Asked Questions

### Is it safe to hash my data here?

Yes. This tool runs entirely in your browser. Your text is processed on your own device — nothing is uploaded to a server. Once you close or refresh the page, it's gone.

### Why does this tool generate both MD5 and SHA-256 instead of letting me pick one?

Both are computed in a fraction of a second, and most people checking a hash need to match whatever algorithm the other side published — showing both at once avoids needing to guess or re-run the tool.

### Is MD5 safe to use?

MD5 is fine for catching accidental corruption (a bad download, a copy-paste error) but is not safe for anything security-sensitive. It's been possible to deliberately construct two different inputs with the same MD5 hash since the mid-2000s, so it should never be relied on to detect intentional tampering.

### Can I hash a whole file, not just typed text?

This tool hashes whatever text you paste or type into it. If you need to hash the raw bytes of a binary file, you'll need a tool designed for file input specifically — the result for a text representation of a file's contents won't match hashing its actual bytes.

### Should I use this to hash passwords?

No. Neither MD5 nor plain SHA-256 is appropriate for storing passwords — both are too fast, which makes them practical to brute-force. Password storage needs a purpose-built, deliberately slow algorithm like bcrypt, scrypt, or Argon2.
