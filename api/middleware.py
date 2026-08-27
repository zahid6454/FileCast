"""Middleware for rate limiting, CORS, request logging, and tracing."""

import asyncio
import time

from data.config import settings
from data.netutil import get_client_ip
from data.redis_client import REDIS_CALL_TIMEOUT_SECONDS, redis_client
from fastapi import Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
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
# ever added; this keeps that future case order-independent — ``/convert/jobs``
# below is exactly that case now.
#
# STRESS_TEST_REPORT.md Finding 2 / Phase 3: these were divided by ~4 as a
# rough compensating patch while enforcement was per-worker in-memory
# (measured 66/100 getting through against an advertised 20/hr). Phase 3
# moves enforcement to a shared Redis store (RateLimitMiddleware below), so
# the count is exact across all 4 uvicorn workers now — reverted back to
# these original, intended values.
PATH_LIMITS: list[tuple[str, int]] = [
    ("/api/v1/auth/dev-login", 20),
    # Google sign-in: /google (start) + /google/callback. The callback makes an
    # outbound token+userinfo exchange, so give it a budget. One prefix covers
    # both; ~15 sign-in round-trips/hr per IP.
    ("/api/v1/auth/google", 30),
    ("/api/v1/conversions", 120),
    ("/api/v1/ratings", 30),
    ("/api/v1/errors", 60),
    # Contact-page submissions — deliberately stricter than ratings/errors,
    # which fire automatically as a byproduct of normal tool use. A real
    # visitor sends at most a handful of these per hour.
    ("/api/v1/messages", 10),
    # Public, unauthenticated, DB-touching read (/announcements/active).
    ("/api/v1/announcements", 120),
    # Authenticated write; also size/key-guarded in the router.
    ("/api/v1/preferences", 60),
    ("/api/v1/convert", 20),
    # Polling GET .../jobs/{id} (Phase 3) — a cheap indexed read, and sized
    # against the frontend's own backoff-tail math (server-upload.js): a
    # worst-case job polling for most of the ~10-minute backpressure bound at
    # a steady ~15-20s cadence is ~60 requests from one job alone, so this
    # needs headroom well past that, not just past the 20/hr enqueue budget
    # above. Nested under /api/v1/convert — the longest-prefix match in
    # _match_limit already handles this without any code change.
    ("/api/v1/convert/jobs", 400),
    # Admin-only surfaces (staff.py, site_settings.py, admin_deploy.py all live
    # under /admin; tools.py and stats.py are admin-gated on every route). Every
    # route here already requires require_admin (A01), but a leaked/stolen
    # admin session previously had no throttle of its own — unbounded staff
    # churn or repeated deploy dispatches (OWASP A05). Generous enough for
    # normal panel use (dashboard loads + a handful of edits per session), not
    # for scripted abuse.
    ("/api/v1/admin", 300),
    ("/api/v1/tools", 200),
    ("/api/v1/stats", 200),
]


def add_cors(app):
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,  # F5 — required for credentials:'include' + cookies
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        # A literal "*" is invalid alongside credentials; be explicit (§16-R2).
        allow_headers=["Content-Type"],
        # Phase 3: browsers only expose a small safelisted set of response
        # headers to JS on a cross-origin request (Cache-Control,
        # Content-Language, Content-Length, Content-Type, Expires,
        # Last-Modified, Pragma) unless the server explicitly opts more in —
        # confirmed live (browser console: "Refused to get unsafe header
        # 'Retry-After'") that server-upload.js's poll loop was silently
        # never able to read the header its own backoff schedule is supposed
        # to honor, on filecast.org -> api.filecast.org's real cross-origin
        # setup (this went unnoticed against localhost:8090 direct API
        # calls, which are same-origin and unaffected).
        expose_headers=["Retry-After"],
        max_age=3600,
    )


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Baseline security headers on every API response (OWASP A05).

    The static frontend gets a full header set via dist/_headers (Cloudflare
    Pages); this process — serving /convert's binary downloads and every JSON
    response — set none of its own before this. X-Content-Type-Options is
    unconditional; HSTS is production-only so local HTTP dev isn't forced onto
    HTTPS (same env gate ``cookie_secure``/dev-login use).
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        if settings.environment == "production":
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains; preload"
            )
        return response


class NoIndexMiddleware(BaseHTTPMiddleware):
    """Tag every response ``X-Robots-Tag: noindex, nofollow``.

    api.filecast.org is a JSON API, not a page — nothing here belongs in search
    results. filecast.org's robots.txt (build.py) is scoped to that origin only
    and has no effect on this subdomain, so the header is what actually stops a
    crawler here.
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Robots-Tag"] = "noindex, nofollow"
        return response


class SelectiveGZipMiddleware:
    """``GZipMiddleware``, skipped for the given path prefixes.

    File-conversion output (PDF/DOCX/XLSX/PPTX) is already an internally
    compressed binary format — gzipping it again buys ~0% size reduction while
    paying real CPU (compresslevel 9) and a second full in-memory buffer, on
    the request the user is synchronously waiting on. Raw ASGI (not
    ``BaseHTTPMiddleware``) to wrap ``GZipMiddleware`` directly rather than
    re-buffering the response ourselves just to decide whether to skip it.
    """

    def __init__(self, app, exclude_prefixes=(), **gzip_kwargs):
        self._plain_app = app
        self._gzip_app = GZipMiddleware(app, **gzip_kwargs)
        self._exclude_prefixes = tuple(exclude_prefixes)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].startswith(self._exclude_prefixes):
            await self._plain_app(scope, receive, send)
        else:
            await self._gzip_app(scope, receive, send)


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


# Atomic sliding-window check-and-increment (Phase 3 —
# STRESS_TEST_PHASE3_PLAN.md). Atomicity is the actual point, not decoration:
# without it, two concurrent requests near the limit landing on different
# uvicorn workers could both read "19 so far, under 20" and both get through
# — a subtler version of exactly the per-worker gap this replaces. One round
# trip does ZREMRANGEBYSCORE (evict anything outside the window) + a unique
# ZADD (only when still under the limit — a plain timestamp score isn't a
# unique member, so a monotonic per-key sequence number is what disambiguates
# same-millisecond concurrent requests) + ZCARD + EXPIRE, all inside Redis's
# single-threaded script execution, so no other request's check can interleave
# between "read count" and "write new entry."
#
# EXPIRE is reissued on EVERY call (both the zset key and its sequence
# counter), not just on first creation — a one-shot EXPIRE at key-birth would
# let a bucket seeing fresh activity right up to its TTL vanish early,
# silently truncating a still-active window (this replaces the old in-memory
# `_sweep`'s manual idle-bucket eviction entirely; Redis's own TTL does that
# job now).
#
# A Lua number reply truncates any fractional part (Redis converts it to a
# RESP integer) — the oldest-entry score needs to survive the round trip as a
# full-precision timestamp for the reset-time math below, so the script
# returns it as a string instead.
_RATE_LIMIT_SCRIPT = """
local zkey = KEYS[1]
local seqkey = KEYS[2]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local cutoff = now - window

redis.call('ZREMRANGEBYSCORE', zkey, '-inf', '(' .. cutoff)
local count = redis.call('ZCARD', zkey)
local allowed = 0

if count < limit then
    local seq = redis.call('INCR', seqkey)
    redis.call('ZADD', zkey, now, seq)
    count = count + 1
    allowed = 1
end

redis.call('EXPIRE', zkey, window)
redis.call('EXPIRE', seqkey, window)

local oldest_score = now
local oldest = redis.call('ZRANGE', zkey, 0, 0, 'WITHSCORES')
if oldest[2] then
    oldest_score = tonumber(oldest[2])
end

return {allowed, count, tostring(oldest_score)}
"""


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Redis-backed per-path rate limiter keyed by client IP (Phase 3).

    Replaces the old in-memory-per-worker limiter: the API runs
    ``uvicorn --workers 4``, so a plain in-process counter was enforced per
    worker, not per instance (STRESS_TEST_REPORT.md Finding 2 measured
    66/100 requests getting through against an advertised 20/hr). A shared
    Redis store makes the count exact across all 4 workers instead —
    PATH_LIMITS is back to its originally-intended values (see the comment
    above it), not the ~4x-divided compensating patch that shipped first.

    **Fails open**: if Redis is unreachable, this logs a warning and lets the
    request through rather than 503-ing everything. A broken rate limiter is
    defense-in-depth, not a hard quota — Redis must not become a new single
    point of total failure the way Gotenberg was in Finding 1.
    """

    def __init__(self, app):
        super().__init__(app)
        self._script = redis_client.register_script(_RATE_LIMIT_SCRIPT)

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

    @staticmethod
    def _reset_seconds(now: float, oldest_score: float) -> int:
        """Seconds until the bucket's oldest request ages out of RATE_WINDOW —
        i.e. until at least one more request is allowed again."""
        return max(0, round(RATE_WINDOW - (now - oldest_score)))

    async def dispatch(self, request: Request, call_next):
        matched = self._match_limit(request.url.path)
        if matched is None:
            return await call_next(request)
        bucket, limit = matched

        ip = get_client_ip(request)
        key = f"ratelimit:{bucket}:{ip}"
        now = time.time()

        try:
            allowed, count, oldest_score_str = await asyncio.wait_for(
                self._script(keys=[key, f"{key}:seq"], args=[now, RATE_WINDOW, limit]),
                timeout=REDIS_CALL_TIMEOUT_SECONDS,
            )
            oldest_score = float(oldest_score_str)
        except Exception:
            logger.warning(
                "Rate limiter: Redis unreachable, failing open",
                extra={
                    "data": {
                        "event": "rate_limiter_redis_down",
                        "path": request.url.path,
                    }
                },
            )
            return await call_next(request)

        if not allowed:
            reset_in = self._reset_seconds(now, oldest_score)
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
                # Retry-After and X-RateLimit-Reset (§10/P2 §22) agree on the
                # same number — the seconds until the oldest request in THIS
                # bucket ages out and one more is allowed, not a blanket
                # RATE_WINDOW every time.
                headers={
                    "Retry-After": str(reset_in),
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(reset_in),
                },
            )

        # `count` already reflects this request's own claimed slot — the
        # Lua script did the check-and-increment atomically server-side, so
        # unlike the old in-memory version there's no separate "snapshot
        # before awaiting call_next" concern: this number is correct before
        # call_next is ever awaited.
        remaining = max(0, limit - count)
        reset_in = self._reset_seconds(now, oldest_score)
        response = await call_next(request)
        # Rate-limit headers on the allowed path too (P2 §22) — not just the
        # 429, so a well-behaved client can see it's approaching the limit
        # before it gets cut off.
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-RateLimit-Reset"] = str(reset_in)
        return response
