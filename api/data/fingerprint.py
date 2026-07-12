"""Server-side rating-dedup fingerprint (ledger D4/P3).

**No client-side canvas fingerprinting** (blocked/randomized by
Brave/Safari/uBlock/Tor — exactly our users — and GDPR-murky). Instead, derive a
per-tool, daily-rotated hash from the (spoof-resistant) client IP:

    sha256(daily_salt : client_ip : tool_id)

The daily salt rotates the value each UTC day, and the raw IP is never stored —
only this opaque hash lands in ``ratings.fingerprint`` for the
``UNIQUE(tool_id, fingerprint)`` dedup.
"""

import hashlib
from datetime import UTC, datetime

from starlette.requests import HTTPConnection

from data.config import settings
from data.netutil import get_client_ip


def _daily_salt() -> str:
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    return f"{settings.fingerprint_salt}:{today}"


def compute_fingerprint(request: HTTPConnection, tool_id: str) -> str:
    ip = get_client_ip(request)
    raw = f"{_daily_salt()}:{ip}:{tool_id}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
