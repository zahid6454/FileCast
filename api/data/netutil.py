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

**Why unconditional trust is safe in prod:** ``CF-Connecting-IP`` is only
trustworthy if the origin accepts traffic *exclusively* from Cloudflare — and it
does. ``docker-compose.prod.yml`` binds the API to ``127.0.0.1:8090`` (no public
port) and the only ingress is the ``cloudflared`` tunnel sidecar (DEVELOPMENT.md
"Production Deployment" / "Third-Party Services" — status: Live); there is no
public inbound path to forge the header against. This is a deploy-topology
invariant, not a code-level guarantee — if the API ever gains a public port
(bypassing the tunnel) or moves off Cloudflare, this header stops being
trustworthy and must be gated on ``trusted_proxies`` like XFF instead, exactly
as ``get_client_ip`` already does for X-Forwarded-For below. Locally no such
header is sent, so this is inert in dev.
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
