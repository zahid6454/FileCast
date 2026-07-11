# Security Review Guide

Checklist for the security dimension. Load when the change touches input
handling, auth, data access, network calls, headers, secrets, or dependencies.

## Contents
- Trust boundaries & input validation
- Injection (SQL, command, XSS, template, header)
- AuthN / AuthZ & access control
- Secrets & credentials
- Transport, headers & CSP
- SSRF, path traversal & file handling
- Deserialization & parsing
- Dependencies & supply chain
- Privacy & PII
- Weakened-control detection (regression guard)

## Trust boundaries & input validation
- Every input crossing a trust boundary (HTTP body/query/header, file upload,
  env, IPC, third-party API response) is validated for type, range, length,
  and format before use.
- Validation is allowlist ("only these"), not denylist ("not these").
- Size limits on uploads, request bodies, and array/loop bounds to prevent
  resource exhaustion.

## Injection
- **SQL/NoSQL:** parameterized queries / prepared statements only; never string
  concatenation of user input into queries.
- **Command:** no user input in shell strings; use argument arrays and avoid
  `shell=True` / `eval` equivalents.
- **XSS:** output is contextually escaped; no `innerHTML`/`dangerouslySetInnerHTML`
  with untrusted data; framework auto-escaping not bypassed.
- **Template/SSTI, header/CRLF, log injection:** untrusted data never
  interpolated into templates, response headers, or log lines unescaped.

## AuthN / AuthZ & access control
- Every new endpoint/action checks authentication AND authorization — not just
  "is logged in" but "is allowed to touch THIS resource" (guard against IDOR).
- Server-side enforcement; never trust client-supplied role/owner/price fields.
- Session/token handling: expiry, rotation, secure + httpOnly + sameSite cookies.

## Secrets & credentials
- No hardcoded keys, tokens, passwords, or connection strings in code, tests,
  or fixtures. They belong in env/secret managers.
- Secrets never logged, echoed in errors, or sent to analytics/telemetry.
- New config for a secret is wired through the existing secret mechanism, not a
  committed file.

## Transport, headers & CSP
- HTTPS enforced for anything sensitive; no mixed content.
- Security headers preserved/added as appropriate (CSP, HSTS, X-Content-Type,
  frame-ancestors).
- **CSP specifically:** no new inline `<script>`/`on* =` handlers under a strict
  `script-src`; no widening to `'unsafe-inline'`/`'unsafe-eval'`/`*`. Inline
  config should be a `type="application/json"` data island read by a `'self'`
  script, not executable inline code.

## SSRF, path traversal & file handling
- Server-side fetches to user-controlled URLs are restricted (allowlist host,
  block internal/metadata IP ranges).
- File paths built from user input are canonicalized and confined to an
  intended directory (no `../` escape).
- Uploaded file types/sizes validated; served with correct, non-executable
  content types.

## Deserialization & parsing
- No unsafe deserialization of untrusted data (pickle, native `unserialize`,
  YAML `load` without SafeLoader).
- Parsers configured against entity expansion / billion-laughs (XML) and deep
  nesting.

## Dependencies & supply chain
- New dependencies are reputable, maintained, and pinned; lockfile updated.
- No obviously abandoned or typosquatted packages; scope of transitive additions
  is reasonable.

## Privacy & PII
- Personal data collection is intentional and minimal; not silently logged or
  exported.
- Data-retention / user-facing privacy claims still hold after the change (a
  feature that starts sending data upstream may contradict "stays on device").

## Weakened-control detection (regression guard)
Flag as **blocking** any change that *removes or loosens* an existing control:
disabled validation, broadened CORS/CSP, removed auth check, `verify=False`,
downgraded crypto, added `# nosec`/lint-ignore over a real issue. A weakened
control is higher severity than a missing one.
