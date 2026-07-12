"""Spoof-resistant client-IP extraction (§10/§16-R4).

The old ``_get_client_ip`` trusted the first ``X-Forwarded-For`` hop
unconditionally — spoofable, which would let an attacker rotate fake IPs to
bypass **both** the rate limiter and the rating dedup. This single helper is
shared by the rate limiter (``middleware.py``) and ``fingerprint.py``:

- Prefer ``CF-Connecting-IP`` (the backend sits behind Cloudflare in prod).
- Trust ``X-Forwarded-For`` **only** when the immediate peer
  (``request.client.host``) is in the configured ``trusted_proxies`` allowlist.
- Otherwise fall back to ``request.client.host`` (the real peer). Locally, with
  no proxies configured, this is just the loopback address.

**PHASE 7 SECURITY DEPENDENCY (do not ship to prod without this):**
``CF-Connecting-IP`` is trusted unconditionally here, which is only safe if the
origin accepts traffic *exclusively* from Cloudflare (firewall/allowlist Cloudflare
IP ranges, or an Authenticated Origin Pull). If the origin is directly reachable,
an attacker can forge ``CF-Connecting-IP`` to spoof arbitrary IPs and bypass BOTH
the rate limiter and the rating dedup. Phase 7 must either lock the origin to
Cloudflare or gate ``CF-Connecting-IP`` on ``trusted_proxies`` like XFF. Locally
no such header is sent, so this is inert in dev.
"""

from starlette.requests import HTTPConnection

from data.config import settings


def get_client_ip(request: HTTPConnection) -> str:
    peer = request.client.host if request.client else "unknown"

    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()

    if peer in settings.trusted_proxy_set:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            # left-most is the original client when the chain is trusted
            return forwarded.split(",")[0].strip()

    return peer
