"""FileCast API — server-side file conversion + data layer.

Handles DOCX/XLSX/PPTX/HTML to PDF via Gotenberg, PDF compression via
Ghostscript, and (Phase 1) the persisted data layer: tools overlay, anonymous
counters/ratings, error logs, announcements, sessions, and admin stats.
"""

import os
from contextlib import asynccontextmanager

import sentry_sdk
from converter import GOTENBERG_URL
from converter import router as converter_router
from data.config import settings
from data.db import async_engine
from data.routers import all_routers
from fastapi import FastAPI
from log import ENVIRONMENT, SERVICE_NAME, get_logger, setup_logging
from middleware import (
    NoIndexMiddleware,
    RateLimitMiddleware,
    RequestLoggingMiddleware,
    SelectiveGZipMiddleware,
    add_cors,
)
from sqlalchemy import text

setup_logging()
logger = get_logger("app")

VERSION = "1.0.0"
# Baked into the image by the Dockerfile's GIT_SHA build arg. "unknown" means the
# image was built without one — the drift check treats that as unverifiable, not
# as up to date. Read once at import: it cannot change while the process lives.
GIT_SHA = os.getenv("GIT_SHA") or "unknown"

# Phase 9 §9.2: backend error tracking. Empty DSN ⇒ never calls sentry_sdk.init()
# at all, so the SDK stays fully inert (no network calls, no monkeypatching) —
# same posture as GOOGLE_CLIENT_ID/GITHUB_PAT being optional above. FastAPI's
# integration auto-enables from the installed `sentry-sdk[fastapi]` extra; no
# explicit integrations=[...] needed.
#
# include_local_variables=False: the SDK default (True) attaches every stack
# frame's local variables to captured events via LoggingIntegration, independent
# of send_default_pii (that flag only gates request-body capture). Every convert
# route funnels errors through converter.py's `except Exception: logger.error(...,
# exc_info=True)`, whose frame holds the raw uploaded file bytes as a local —
# with the default on, that content ships to Sentry verbatim on any conversion
# failure, straight against log.py's own "never logs file content" privacy
# guarantee. Still get exception type/message/full stack trace without it.
if settings.sentry_dsn:
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=ENVIRONMENT,
        release=GIT_SHA,
        include_local_variables=False,
        traces_sample_rate=settings.sentry_traces_sample_rate,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Verify DB connectivity on startup (F12 — lifespan, not @app.on_event).
    try:
        async with async_engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
        logger.error(
            "Database connectivity check failed at startup",
            exc_info=True,
            extra={"data": {"event": "startup_db_error"}},
        )

    # Phase 5.5: an empty owner allow-list in prod means no path to a first admin
    # (dev-login is 404, DB surgery is gone, POST /admin/staff needs an admin).
    if ENVIRONMENT != "development" and not settings.initial_admin_email_set:
        logger.warning(
            "INITIAL_ADMIN_EMAILS is empty in a non-development environment — no "
            "account can become admin. Set it to at least one owner email.",
            extra={"data": {"event": "startup_no_admin_bootstrap"}},
        )

    logger.info(
        "FileCast API started",
        extra={
            "data": {
                "event": "startup",
                "version": VERSION,
                "commit": GIT_SHA,
                "gotenberg_url": GOTENBERG_URL,
                "workers": os.getenv("WEB_CONCURRENCY", "4"),
                "database": "ok" if db_ok else "unreachable",
            }
        },
    )
    try:
        yield
    finally:
        await async_engine.dispose()


# Interactive API docs (Swagger/ReDoc/OpenAPI) are exposed only in development;
# disabled in production as a hardening measure (ENVIRONMENT is set by compose /
# Phase 7 deploy).
_docs_enabled = ENVIRONMENT == "development"

app = FastAPI(
    title="FileCast API",
    version=VERSION,
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
    lifespan=lifespan,
)

# Middleware order matters: the LAST added is the OUTERMOST. CORS is added
# before NoIndex so it still wraps everything below it — otherwise a
# rate-limiter 429 (or any early response) would skip CORS and a browser
# couldn't read it on a credentialed request, and preflight OPTIONS would be
# rate-limited instead of answered. RateLimit stays inner of RequestLogging
# (unchanged relative order, so /convert behaves as before). NoIndex is added
# last (outermost) so the header lands on literally every response this app
# returns, including CORS preflights and 429s. GZip is added first (innermost)
# so it compresses the actual response body right as it leaves the route,
# before any other middleware touches it — every JSON response shipped
# uncompressed until now. /convert output is already a compressed binary
# format (PDF/DOCX/XLSX/PPTX) — excluded so it isn't gzipped a second time for
# no size benefit at real CPU cost on the app's largest, most latency-sensitive
# responses.
app.add_middleware(
    SelectiveGZipMiddleware, exclude_prefixes=("/api/v1/convert",), minimum_size=500
)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(RequestLoggingMiddleware)
add_cors(app)
app.add_middleware(NoIndexMiddleware)

app.include_router(converter_router)
for data_router in all_routers:
    app.include_router(data_router)


@app.get("/")
async def root():
    # `commit` is read unauthenticated by the deploy workflow's drift check, so it
    # has to live on a public route. It leaks nothing: the repo is public (Apache
    # 2.0), so the sha maps to a commit anyone can already read.
    return {
        "service": SERVICE_NAME,
        "env": ENVIRONMENT,
        "version": VERSION,
        "commit": GIT_SHA,
    }
