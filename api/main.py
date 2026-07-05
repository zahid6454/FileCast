"""FileCast API — server-side file conversion.

Handles DOCX/XLSX/PPTX/HTML to PDF via Gotenberg,
and PDF compression via Ghostscript.
"""

import os

from fastapi import FastAPI

from converter import GOTENBERG_URL, router as converter_router
from log import ENVIRONMENT, SERVICE_NAME, get_logger, setup_logging
from middleware import RateLimitMiddleware, RequestLoggingMiddleware, add_cors

setup_logging()
logger = get_logger("app")

app = FastAPI(
    title="FileCast API",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
)

add_cors(app)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(RequestLoggingMiddleware)

app.include_router(converter_router)


@app.on_event("startup")
async def log_startup():
    logger.info(
        "FileCast API started",
        extra={"data": {
            "event": "startup",
            "version": "1.0.0",
            "gotenberg_url": GOTENBERG_URL,
            "workers": os.getenv("WEB_CONCURRENCY", "4"),
        }},
    )


@app.get("/")
async def root():
    return {"service": SERVICE_NAME, "env": ENVIRONMENT, "version": "1.0.0"}
