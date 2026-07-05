"""Structured JSON logging for FileCast API.

Outputs one JSON object per line — parseable by Datadog, ELK, CloudWatch,
or any log aggregator without custom parsers.

Privacy: never logs file names, file content, or user-identifiable data
beyond IP address (needed for rate limit debugging).
"""

import json
import logging
import os
import sys
import traceback
import uuid
from contextvars import ContextVar

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

SERVICE_NAME = "filecast-api"
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")


class JSONFormatter(logging.Formatter):
    def format(self, record):
        entry = {
            "ts": record.created,
            "level": record.levelname.lower(),
            "msg": record.getMessage(),
            "service": SERVICE_NAME,
            "env": ENVIRONMENT,
            "logger": record.name,
            "request_id": request_id_var.get("-"),
        }
        if record.exc_info and record.exc_info[1]:
            entry["error"] = str(record.exc_info[1])
            entry["error_class"] = type(record.exc_info[1]).__name__
            entry["traceback"] = traceback.format_exception(*record.exc_info)[-3:]
        if hasattr(record, "data"):
            entry.update(record.data)
        return json.dumps(entry, default=str)


def setup_logging():
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.INFO)

    logging.getLogger("uvicorn.access").handlers.clear()
    logging.getLogger("uvicorn.access").propagate = False
    logging.getLogger("uvicorn.error").handlers.clear()
    logging.getLogger("uvicorn.error").propagate = False

    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"filecast.{name}")


def new_request_id() -> str:
    return uuid.uuid4().hex[:12]
