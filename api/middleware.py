"""Middleware for rate limiting, CORS, request logging, and tracing."""

import time
from collections import defaultdict

from data.netutil import get_client_ip
from fastapi import Request, Response
from fastapi.middleware.cors import CORSMiddleware
from log import get_logger, new_request_id, request_id_var
from starlette.middleware.base import BaseHTTPMiddleware

logger = get_logger("middleware")

RATE_WINDOW = 3600  # 1 hour in seconds

ALLOWED_ORIGINS = [
    "https://filecast.io",
    "https://www.filecast.io",
    "http://localhost:8000",  # local dev
    "http://127.0.0.1:8000",
]

# Per-path request budgets per RATE_WINDOW (§10/§16-R3). The heavy server-side
# /convert keeps the original 20/hr; the per-conversion tracking POST fires on
# EVERY conversion, so it needs a far higher limit or history/counter breaks for
# active users. Longest-prefix wins (most specific first).
PATH_LIMITS: list[tuple[str, int]] = [
    ("/api/v1/auth/dev-login", 20),
    ("/api/v1/conversions", 120),
    ("/api/v1/ratings", 30),
    ("/api/v1/errors", 60),
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
    """Simple in-memory per-path rate limiter by client IP.

    In-memory is fine on a single process (ledger P1 inversion — FastAPI is a
    long-lived process with shared memory); Redis only if the API scales to
    multiple instances (Phase 7).
    """

    def __init__(self, app):
        super().__init__(app)
        # key = f"{bucket}:{ip}" -> list[timestamp]
        self.requests = defaultdict(list)

    @staticmethod
    def _match_limit(path: str) -> tuple[str, int] | None:
        for prefix, limit in PATH_LIMITS:
            if path.startswith(prefix):
                return prefix, limit
        return None

    def _clean_old(self, key: str, now: float):
        cutoff = now - RATE_WINDOW
        self.requests[key] = [t for t in self.requests[key] if t > cutoff]

    async def dispatch(self, request: Request, call_next):
        matched = self._match_limit(request.url.path)
        if matched is None:
            return await call_next(request)
        bucket, limit = matched

        ip = get_client_ip(request)
        key = f"{bucket}:{ip}"
        now = time.time()
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
