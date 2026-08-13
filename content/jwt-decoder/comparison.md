## Decoding a JWT vs. Verifying a JWT

| Feature | Decoding | Verifying |
|---|---|---|
| What it checks | Nothing — just reads the Base64url content | The signature, against a secret or public key |
| Requires a secret/key | No | Yes |
| Tells you the claims | Yes | Yes |
| Tells you if the token is genuine | No | Yes |
| Tells you if it's expired | You can read `exp`, but nothing enforces it | Yes, as part of validation |
| Safe to base an authorization decision on | No | Yes |

### Decode a JWT When

- You're debugging what claims a token actually contains
- You're inspecting a token during development, not making a security decision based on it

### Verify a JWT When

- Your application needs to trust the token's claims (authenticating a request, checking a role)
- You need to confirm the token hasn't been tampered with or expired

This tool only decodes. Verification always needs to happen in your backend, using your actual signing secret or public key — never in a browser tool like this one, and never based on the payload's contents alone.
