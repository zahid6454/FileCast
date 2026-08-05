"""Middleware for rate limiting, CORS, request logging, and tracing."""

import time
from collections import defaultdict

from data.config import settings
from data.netutil import get_client_ip
from fastapi import Request, Response
from fastapi.middleware.cors import CORSMiddleware
from log import get_logger, new_request_id, request_id_var
from starlette.middleware.base import BaseHTTPMiddleware

logger = get_logger("middleware")

RATE_WINDOW = 3600  # 1 hour in seconds

PROD_ORIGINS = [
    "https://filecast.org",
    "https://www.filecast.org",
]

# Only outside production. Shipping these live was never an exploitable hole —
# SameSite=Lax means a cross-site request originating at localhost carries no
# fc_session, so CORS approval buys an attacker an unauthenticated response —
# but "loose but mitigated" is not a property worth keeping when the fix is a
# conditional. Gated on ``environment == "development"`` — the same var and the
# same exact-match test dev-login uses (§16-R1) — so the two dev-only
# affordances turn on and off together, and an unrecognised ENVIRONMENT value
# fails closed rather than quietly re-allowing localhost.
DEV_ORIGINS = [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]


def allowed_origins(environment: str) -> list[str]:
    return PROD_ORIGINS + (DEV_ORIGINS if environment == "development" else [])


ALLOWED_ORIGINS = allowed_origins(settings.environment)

# Per-path request budgets per RATE_WINDOW (§10/§16-R3). The heavy server-side
# /convert keeps the original 20/hr; the per-conversion tracking POST fires on
# EVERY conversion, so it needs a far higher limit or history/counter breaks for
# active users. Match is longest-prefix (see ``_match_limit``), so ordering here
# is for readability only. Note ``/api/v1/convert`` and ``/api/v1/conversions``
# are NOT a nested pair — they diverge mid-segment, so neither is a startswith
# prefix of the other and no ordering could confuse them. Longest-prefix only
# matters if a genuinely nested pair (e.g. ``/api/v1/x`` + ``/api/v1/x/y``) is
# ever added; this keeps that future case order-independent.
PATH_LIMITS: list[tuple[str, int]] = [
    ("/api/v1/auth/dev-login", 20),
    # Google sign-in: /google (start) + /google/callback. The callback makes an
    # outbound token+userinfo exchange, so give it a budget. One prefix covers
    # both; ~15 sign-in round-trips/hr per IP.
    ("/api/v1/auth/google", 30),
    ("/api/v1/conversions", 120),
    ("/api/v1/ratings", 30),
    ("/api/v1/errors", 60),
    # Public, unauthenticated, DB-touching read (/announcements/active).
    ("/api/v1/announcements", 120),
    # Authenticated write; also size/key-guarded in the router.
    ("/api/v1/preferences", 60),
    ("/api/v1/convert", 20),
]


def add_cors(app):
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,  # F5 — required for credentials:'include' + cookies
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        # A literal "*" is invalid alongside credentials; be explicit (§16-R2).
        allow_headers=["Content-Type"],
        max_age=3600,
    )


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Assign request ID, log request/response, add timing header."""

    async def dispatch(self, request: Request, call_next):
        rid = new_request_id()
        request_id_var.set(rid)

        start = time.time()
        ip = get_client_ip(request)
        method = request.method
        path = request.url.path

        response = await call_next(request)

        duration_ms = round((time.time() - start) * 1000, 1)
        response.headers["X-Request-Id"] = rid
        response.headers["X-Response-Time"] = f"{duration_ms}ms"

        logger.info(
            "%s %s %s %sms",
            method,
            path,
            response.status_code,
            duration_ms,
            extra={
                "data": {
                    "event": "request",
                    "method": method,
                    "path": path,
                    "status": response.status_code,
                    "duration_ms": duration_ms,
                    "ip": ip,
                }
            },
        )

        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """In-memory per-path rate limiter keyed by client IP.

    KNOWN LIMITATION (per-worker): the API runs ``uvicorn --workers 4``, so each
    worker process holds its OWN ``requests`` dict and requests are load-balanced
    across workers. Limits are therefore enforced **per worker** — a configured
    20/hr is effectively up to ~4×20/hr across the instance, and counts are not
    shared. This is acceptable for Phase 1 (defense-in-depth, not a hard quota);
    Phase 7 moves enforcement to a shared store (Redis) to make limits exact and
    cross-worker.

    Memory is bounded: buckets for IPs that go idle are evicted by a periodic
    sweep (``_sweep``) once per ``RATE_WINDOW`` — without it, distinct client IPs
    (e.g. behind Cloudflare or under IP-rotating abuse) would accumulate keys
    forever and leak.
    """

    def __init__(self, app):
        super().__init__(app)
        # key = f"{bucket}:{ip}" -> list[timestamp]
        self.requests = defaultdict(list)
        self._last_sweep = time.time()

    @staticmethod
    def _match_limit(path: str) -> tuple[str, int] | None:
        # Longest matching prefix wins, independent of PATH_LIMITS ordering.
        # Defensive future-proofing: no current pair is nested (/convert is not a
        # startswith-prefix of /conversions — they diverge mid-segment), but a
        # genuinely nested pair added later would otherwise be order-sensitive.
        best: tuple[str, int] | None = None
        for prefix, limit in PATH_LIMITS:
            if path.startswith(prefix) and (best is None or len(prefix) > len(best[0])):
                best = (prefix, limit)
        return best

    def _clean_old(self, key: str, now: float):
        cutoff = now - RATE_WINDOW
        self.requests[key] = [t for t in self.requests[key] if t > cutoff]

    def _sweep(self, now: float):
        """Drop stale/empty buckets so idle IPs don't accumulate unboundedly."""
        cutoff = now - RATE_WINDOW
        for key in list(self.requests.keys()):
            fresh = [t for t in self.requests[key] if t > cutoff]
            if fresh:
                self.requests[key] = fresh
            else:
                del self.requests[key]
        self._last_sweep = now

    async def dispatch(self, request: Request, call_next):
        matched = self._match_limit(request.url.path)
        if matched is None:
            return await call_next(request)
        bucket, limit = matched

        ip = get_client_ip(request)
        key = f"{bucket}:{ip}"
        now = time.time()
        if now - self._last_sweep > RATE_WINDOW:
            self._sweep(now)
        self._clean_old(key, now)

        if len(self.requests[key]) >= limit:
            logger.warning(
                "Rate limited %s on %s",
                ip,
                bucket,
                extra={
                    "data": {
                        "event": "rate_limited",
                        "ip": ip,
                        "path": request.url.path,
                        "limit": limit,
                    }
                },
            )
            return Response(
                content='{"error":"Rate limit exceeded. Try again later.","error_type":"rate_limited"}',
                status_code=429,
                media_type="application/json",
                headers={"Retry-After": str(RATE_WINDOW)},
            )

        self.requests[key].append(now)
        return await call_next(request)
