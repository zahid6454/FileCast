"""Middleware for rate limiting, CORS, request logging, and tracing."""

import time
from collections import defaultdict

from fastapi import Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from log import get_logger, new_request_id, request_id_var

logger = get_logger("middleware")

RATE_LIMIT = 20  # requests per window
RATE_WINDOW = 3600  # 1 hour in seconds

ALLOWED_ORIGINS = [
    "https://filecast.io",
    "https://www.filecast.io",
    "http://localhost:8000",  # local dev
    "http://127.0.0.1:8000",
]


def add_cors(app):
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
        max_age=3600,
    )


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Assign request ID, log request/response, add timing header."""

    def _get_client_ip(self, request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    async def dispatch(self, request: Request, call_next):
        rid = new_request_id()
        request_id_var.set(rid)

        start = time.time()
        ip = self._get_client_ip(request)
        method = request.method
        path = request.url.path

        response = await call_next(request)

        duration_ms = round((time.time() - start) * 1000, 1)
        response.headers["X-Request-Id"] = rid
        response.headers["X-Response-Time"] = f"{duration_ms}ms"

        logger.info(
            "%s %s %s %sms",
            method, path, response.status_code, duration_ms,
            extra={"data": {
                "event": "request",
                "method": method,
                "path": path,
                "status": response.status_code,
                "duration_ms": duration_ms,
                "ip": ip,
            }},
        )

        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple in-memory rate limiter by client IP."""

    def __init__(self, app):
        super().__init__(app)
        self.requests = defaultdict(list)

    def _get_client_ip(self, request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    def _clean_old(self, ip: str, now: float):
        cutoff = now - RATE_WINDOW
        self.requests[ip] = [t for t in self.requests[ip] if t > cutoff]

    async def dispatch(self, request: Request, call_next):
        if not request.url.path.startswith("/api/v1/convert"):
            return await call_next(request)

        ip = self._get_client_ip(request)
        now = time.time()
        self._clean_old(ip, now)

        if len(self.requests[ip]) >= RATE_LIMIT:
            logger.warning(
                "Rate limited %s", ip,
                extra={"data": {
                    "event": "rate_limited",
                    "ip": ip,
                    "path": request.url.path,
                }},
            )
            return Response(
                content='{"error":"Rate limit exceeded. Try again later.","error_type":"rate_limited"}',
                status_code=429,
                media_type="application/json",
                headers={"Retry-After": str(RATE_WINDOW)},
            )

        self.requests[ip].append(now)
        return await call_next(request)
