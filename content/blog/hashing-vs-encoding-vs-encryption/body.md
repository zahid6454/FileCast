## Three Words That Get Used Like Synonyms

"We hash it," "we encode it," "we encrypt it" — in casual conversation these get thrown around almost interchangeably, as if they're three ways of saying "we made it unreadable." They're not. Each one does something structurally different, and mixing them up in a real system is how "secure" designs end up not being secure at all.

## Encoding: Reversible, No Secret Involved

Encoding transforms data into a different representation using a fixed, publicly-known scheme — Base64 is the most common example. Anyone who knows the scheme (which is to say, everyone, since it's not a secret) can decode it right back to the original in one step, no password or key required. Encoding exists to make binary or special-character data safe to transmit through systems that expect plain text — it was never designed to hide anything, and it doesn't. If a piece of data is "just Base64-encoded," treat it as equivalent to plain text, because functionally, that's exactly what it is.

## Hashing: One-Way, No Way Back

Hashing runs data through a function that produces a fixed-length output (a "hash" or "digest"), and it's designed to be a one-way street — there's no operation that takes a hash and recovers the original input, by design. The same input always produces the same hash, which is what makes hashing useful for verifying data integrity (confirming a downloaded file wasn't corrupted or tampered with) and for storing password-verification data without storing the actual password. Critically: a general-purpose hash function like MD5 or SHA-256 alone is not the same as a password-hashing algorithm — proper password storage needs a purpose-built function (bcrypt, scrypt, Argon2) that adds salting and deliberate slowness specifically to resist brute-force guessing, which plain MD5/SHA-256 doesn't provide on its own.

## Encryption: Reversible, But Only With a Key

Encryption transforms data using an algorithm plus a secret key, and — unlike encoding — reversing it requires that key. Without it, recovering the original data should be computationally infeasible (for a properly implemented modern algorithm). This is the one of the three actually designed to keep data confidential from anyone who doesn't hold the key, which is why "encrypted" is the only one of these three words that should ever be used as a security claim.

## Why Confusing Them Is a Real Problem

The dangerous mix-up is treating encoding as if it were encryption — "we Base64-encoded the API key before storing it" sounds like a security measure and provides none, since decoding Base64 requires no secret at all. The same confusion in the other direction (assuming a hash can be "decrypted" back to the original password) misunderstands what hashing is for. Knowing which of the three you actually need — reversible-and-secret, reversible-and-public, or one-way — is the first question, before picking any specific algorithm.

[FileCast's Hash Generator](/convert/hash-generator/) produces MD5 and SHA-256 digests for integrity-checking and general hashing needs, and [Base64 Encode/Decode](/convert/base64-encode-decode/) handles the reversible, non-secret transformation encoding is actually for — both entirely in your browser.

## The One-Sentence Version

Encoding is reversible by anyone, hashing is reversible by no one, and encryption is reversible only with a key — and only the last of those three is a real security measure.
