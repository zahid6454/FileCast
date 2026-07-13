"""FileCast API — server-side file conversion + data layer.

Handles DOCX/XLSX/PPTX/HTML to PDF via Gotenberg, PDF compression via
Ghostscript, and (Phase 1) the persisted data layer: tools overlay, anonymous
counters/ratings, error logs, announcements, sessions, and admin stats.
"""

import os
from contextlib import asynccontextmanager

from converter import GOTENBERG_URL
from converter import router as converter_router
from data.db import async_engine
from data.routers import all_routers
from fastapi import FastAPI
from log import ENVIRONMENT, SERVICE_NAME, get_logger, setup_logging
from middleware import RateLimitMiddleware, RequestLoggingMiddleware, add_cors
from sqlalchemy import text

setup_logging()
logger = get_logger("app")


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

    logger.info(
        "FileCast API started",
        extra={
            "data": {
                "event": "startup",
                "version": "1.0.0",
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
    version="1.0.0",
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
    lifespan=lifespan,
)

# Middleware order matters: the LAST added is the OUTERMOST. CORS is added last
# so it wraps everything — otherwise a rate-limiter 429 (or any early response)
# would skip CORS and a browser couldn't read it on a credentialed request, and
# preflight OPTIONS would be rate-limited instead of answered. RateLimit stays
# inner of RequestLogging (unchanged relative order, so /convert behaves as before).
app.add_middleware(RateLimitMiddleware)
app.add_middleware(RequestLoggingMiddleware)
add_cors(app)

app.include_router(converter_router)
for data_router in all_routers:
    app.include_router(data_router)


@app.get("/")
async def root():
    return {"service": SERVICE_NAME, "env": ENVIRONMENT, "version": "1.0.0"}
