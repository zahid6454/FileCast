## What Is a JWT?

A JWT (JSON Web Token) is a compact way to pass a set of claims — like a user ID, a role, or an expiration time — between two parties, often used for authentication and API access tokens. It's three Base64url-encoded segments joined by dots: `header.payload.signature`.

The header describes the token (typically the signing algorithm). The payload holds the actual claims, as JSON. The signature lets the token's issuer prove it wasn't tampered with — but only the issuer, holding the secret or private key, can create or check a valid one.

### Why Decode a JWT?

The header and payload are Base64url-encoded, not encrypted — anyone can read them without a secret key. Decoding lets you inspect exactly what claims a token carries: who it's for, when it was issued, when it expires, and any custom fields an application added.

### How This Tool Works

Paste a JWT into the box below and click Decode JWT. This tool splits the token into its three parts, Base64url-decodes the header and payload, and shows you the resulting JSON. **It does not verify the signature** — it can't, without the secret or public key — so treat the decoded contents as informational only, never as proof the token is genuine or unexpired. Everything runs in your browser; nothing is uploaded to any server.
