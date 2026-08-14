## Common Scenarios for Decoding a JWT

### Debugging Why an API Call Is Being Rejected

If an API returns a 401 or claims your token is invalid, decoding it here shows you exactly what claims it actually carries — the right `sub`, the expected `aud`, or maybe an unexpectedly wrong value that explains the rejection.

### Checking When a Token Expires

JWTs commonly include an `exp` (expiration) and `iat` (issued-at) claim, both stored as Unix timestamps. After decoding here, paste those numeric values into our [Unix Timestamp Converter](/convert/unix-timestamp-converter/) to see the actual expiration date and time.

### Reviewing What Data an Auth Provider Puts in a Token

When integrating a third-party auth provider (Auth0, Firebase, Cognito, and similar), decoding a sample token shows you exactly what claims and custom fields it includes, so you know what's actually available to your application code.

### Verifying Your Own Backend Is Issuing the Right Claims

While developing token-issuing code, decoding a freshly generated token confirms the payload matches what you intended — the right user ID, roles, and expiration — before you wire up anything that depends on it.

### Teaching or Learning How JWTs Work

Because a JWT's header and payload are just Base64url-encoded JSON, decoding one is a fast, hands-on way to see that structure directly, without writing any code.
