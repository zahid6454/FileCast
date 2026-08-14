## Frequently Asked Questions

### Is my token uploaded anywhere?

No. Decoding happens entirely in your browser — nothing is sent to any server. That said, treat any real production token with the same care you'd give a password: if you're pasting one into a tool at all, prefer a test or expired token when possible.

### Does this verify the signature?

No, and it can't — verifying a signature requires the secret key (for HMAC algorithms) or the public key (for RSA/ECDSA algorithms) that only the token's issuer has. This tool only decodes the header and payload, which are readable by anyone without any key at all.

### Does that mean the claims I see could be fake?

If the token wasn't verified, yes — anyone can construct a JWT-shaped string with any payload they like. Never make an authorization decision based on decoded-but-unverified claims. Signature verification always has to happen server-side, as part of your actual authentication logic.

### What does the "alg" field in the header mean?

It names the signing algorithm the issuer claims to have used, like `HS256` (HMAC-SHA256) or `RS256` (RSA-SHA256). It's part of what a real verification step checks — a properly implemented verifier should never blindly trust this field either, since it's just as unverified as the rest of the token.

### Why did I get an error saying the JWT couldn't be decoded?

Either the input isn't a JWT at all (it needs exactly three dot-separated parts), or one of the header/payload segments isn't valid Base64url-encoded JSON — often because the token was truncated or a character got altered when it was copied.
