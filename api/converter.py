"""Conversion routes — Gotenberg for documents, Ghostscript for PDF compress."""

import asyncio
import json
import os
import subprocess
import tempfile
import time
from collections import defaultdict

import httpx
from data.db import async_engine
from data.models import User
from data.security import current_user_for_convert
from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import Response
from log import get_logger, request_id_var
from sqlalchemy import text
from validation import (
    MAX_FILE_SIZE,
    ValidationError,
    validate_compress_quality,
    validate_upload,
)

logger = get_logger("converter")

router = APIRouter(prefix="/api/v1")

GOTENBERG_URL = os.getenv("GOTENBERG_URL", "http://gotenberg:3000")
REQUEST_TIMEOUT = 60.0
# /health's DB connectivity check (P2 §20) — bounds the same way the
# Gotenberg check's httpx timeout does. A module-level constant (not an
# inline literal) so a test can monkeypatch it down instead of actually
# waiting out a multi-second timeout to prove the bound works.
HEALTH_DB_TIMEOUT_SECONDS = 5.0

# Request queue for Gotenberg conversions (P3 §31). Gotenberg's container is
# memory-capped at 1g (docker-compose.yml, P3 §30) on a shared 12GB VM that
# also runs the API, Postgres-adjacent services, and cloudflared — a burst of
# concurrent LibreOffice/Chromium conversions can each spike well past a
# couple hundred MB, so an unbounded number of in-flight requests can OOM the
# container under load. The report's own suggestion (BullMQ + Redis) doesn't
# fit: this is a FastAPI/asyncio codebase with no Node runtime and no Redis
# anywhere else in the stack (rate limiting in middleware.py is already a
# plain in-process structure for the same reason). An ``asyncio.Semaphore``
# is the equivalent in-process primitive — same "acceptable per-worker, not
# cross-worker" caveat as the rate limiter (uvicorn runs 4 workers, so the
# real ceiling is up to ~4x this per instance), which is fine here for the
# same reason: this is defense against a single worker's own burst, not a
# hard global cap.
GOTENBERG_MAX_CONCURRENT = int(os.getenv("GOTENBERG_MAX_CONCURRENT", "2"))
# How long a request waits in queue for a free slot before giving up. Bounded
# so a pile-up of requests behind two slow conversions fails fast with a
# retryable error instead of each queuing request holding its connection open
# indefinitely (and, upstream, holding open the client's XHR).
GOTENBERG_QUEUE_TIMEOUT_SECONDS = 30.0

_gotenberg_semaphore = asyncio.Semaphore(GOTENBERG_MAX_CONCURRENT)


class ConversionQueueTimeout(Exception):
    """Raised when a request waited GOTENBERG_QUEUE_TIMEOUT_SECONDS for a free
    Gotenberg slot and none opened up."""


metrics = {
    "conversions": defaultdict(int),
    "failures": defaultdict(int),
    "total_duration_ms": defaultdict(float),
}


def _error_response(
    msg: str, error_type: str, status: int = 400, headers: dict | None = None
) -> Response:
    return Response(
        content=json.dumps({"error": msg, "error_type": error_type}),
        status_code=status,
        media_type="application/json",
        headers=headers,
    )


def _record_metric(tool_id: str, success: bool, duration_ms: float):
    if success:
        metrics["conversions"][tool_id] += 1
    else:
        metrics["failures"][tool_id] += 1
    metrics["total_duration_ms"][tool_id] += duration_ms


async def _gotenberg_request(endpoint: str, files: dict, tool_id: str) -> bytes:
    url = f"{GOTENBERG_URL}{endpoint}"
    rid = request_id_var.get("-")
    headers = {"X-Request-Id": rid}

    # Queue behind GOTENBERG_MAX_CONCURRENT other in-flight Gotenberg calls
    # (P3 §31) rather than firing straight through — see the module-level
    # comment on _gotenberg_semaphore for why this exists and why it's a
    # semaphore rather than an external queue.
    queue_start = time.time()
    try:
        await asyncio.wait_for(
            _gotenberg_semaphore.acquire(), timeout=GOTENBERG_QUEUE_TIMEOUT_SECONDS
        )
    except TimeoutError:
        queue_ms = round((time.time() - queue_start) * 1000, 1)
        logger.warning(
            "Gotenberg queue timeout: %s waited %sms for a free slot",
            tool_id,
            queue_ms,
            extra={
                "data": {
                    "event": "gotenberg_queue_timeout",
                    "tool_id": tool_id,
                    "gotenberg_endpoint": endpoint,
                    "queue_ms": queue_ms,
                }
            },
        )
        raise ConversionQueueTimeout(
            "The conversion service is busy right now. Please try again in a moment."
        ) from None

    queue_ms = round((time.time() - queue_start) * 1000, 1)
    try:
        start = time.time()
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.post(url, files=files, headers=headers)
        gotenberg_ms = round((time.time() - start) * 1000, 1)
    finally:
        _gotenberg_semaphore.release()

    if queue_ms > 50:
        # Only log queueing that actually happened — most requests acquire
        # the semaphore immediately and this would otherwise fire on every
        # single conversion.
        logger.info(
            "Gotenberg request queued %sms before starting: %s",
            queue_ms,
            tool_id,
            extra={
                "data": {
                    "event": "gotenberg_queued",
                    "tool_id": tool_id,
                    "gotenberg_endpoint": endpoint,
                    "queue_ms": queue_ms,
                }
            },
        )

    if resp.status_code != 200:
        error_body = resp.text[:500]
        logger.error(
            "Gotenberg error: %s returned %s",
            endpoint,
            resp.status_code,
            extra={
                "data": {
                    "event": "gotenberg_error",
                    "tool_id": tool_id,
                    "gotenberg_endpoint": endpoint,
                    "gotenberg_status": resp.status_code,
                    "gotenberg_body": error_body,
                    "gotenberg_ms": gotenberg_ms,
                }
            },
        )
        raise RuntimeError(
            f"Gotenberg {endpoint} returned {resp.status_code}: {error_body}"
        )

    logger.info(
        "Gotenberg OK: %s %sms",
        endpoint,
        gotenberg_ms,
        extra={
            "data": {
                "event": "gotenberg_call",
                "tool_id": tool_id,
                "gotenberg_endpoint": endpoint,
                "gotenberg_status": 200,
                "gotenberg_ms": gotenberg_ms,
                "gotenberg_output_bytes": len(resp.content),
            }
        },
    )
    return resp.content


async def _convert_libreoffice(
    content: bytes,
    filename: str,
    extra_form: dict | None = None,
) -> bytes:
    files = {"files": (filename, content)}
    if extra_form:
        for k, v in extra_form.items():
            files[k] = (None, v)
    return await _gotenberg_request(
        "/forms/libreoffice/convert",
        files,
        "libreoffice",
    )


async def _convert_chromium_html(content: bytes, filename: str) -> bytes:
    return await _gotenberg_request(
        "/forms/chromium/convert/html",
        {"files": ("index.html", content)},
        "chromium",
    )


def _compress_ghostscript_sync(content: bytes, quality: str) -> bytes:
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp_in:
        tmp_in.write(content)
        tmp_in_path = tmp_in.name
    tmp_out_path = tmp_in_path + ".out.pdf"

    try:
        start = time.time()
        result = subprocess.run(
            [
                "gs",
                "-sDEVICE=pdfwrite",
                "-dCompatibilityLevel=1.4",
                f"-dPDFSETTINGS=/{quality}",
                "-dNOPAUSE",
                "-dQUIET",
                "-dBATCH",
                f"-sOutputFile={tmp_out_path}",
                tmp_in_path,
            ],
            capture_output=True,
            timeout=REQUEST_TIMEOUT,
        )
        gs_ms = round((time.time() - start) * 1000, 1)

        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace")[:500]
            logger.error(
                "Ghostscript failed: exit %s",
                result.returncode,
                extra={
                    "data": {
                        "event": "ghostscript_error",
                        "gs_returncode": result.returncode,
                        "gs_stderr": stderr,
                        "gs_quality": quality,
                        "gs_ms": gs_ms,
                    }
                },
            )
            raise RuntimeError(f"Ghostscript exit {result.returncode}: {stderr}")

        with open(tmp_out_path, "rb") as f:
            output = f.read()

        logger.info(
            "Ghostscript OK: %s %sms",
            quality,
            gs_ms,
            extra={
                "data": {
                    "event": "ghostscript_call",
                    "gs_quality": quality,
                    "gs_ms": gs_ms,
                    "gs_input_bytes": len(content),
                    "gs_output_bytes": len(output),
                }
            },
        )
        return output
    finally:
        for p in (tmp_in_path, tmp_out_path):
            try:
                os.unlink(p)
            except OSError:
                pass


async def _compress_ghostscript(content: bytes, quality: str) -> bytes:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, _compress_ghostscript_sync, content, quality
    )


def _convert_pdf2docx_sync(content: bytes) -> bytes:
    from pdf2docx import Converter

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp_in:
        tmp_in.write(content)
        tmp_in_path = tmp_in.name
    tmp_out_path = tmp_in_path + ".docx"

    try:
        start = time.time()
        cv = Converter(tmp_in_path)
        cv.convert(tmp_out_path)
        cv.close()
        p2d_ms = round((time.time() - start) * 1000, 1)

        with open(tmp_out_path, "rb") as f:
            output = f.read()

        logger.info(
            "pdf2docx OK: %sms",
            p2d_ms,
            extra={
                "data": {
                    "event": "pdf2docx_call",
                    "p2d_ms": p2d_ms,
                    "p2d_input_bytes": len(content),
                    "p2d_output_bytes": len(output),
                }
            },
        )
        return output
    except Exception:
        logger.error(
            "pdf2docx failed",
            exc_info=True,
            extra={
                "data": {
                    "event": "pdf2docx_error",
                    "p2d_input_bytes": len(content),
                }
            },
        )
        raise
    finally:
        for p in (tmp_in_path, tmp_out_path):
            try:
                os.unlink(p)
            except OSError:
                pass


async def _convert_pdf2docx(content: bytes, filename: str) -> bytes:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _convert_pdf2docx_sync, content)


def _safe_filename(filename: str, ext: str = ".pdf") -> str:
    base = filename.rsplit(".", 1)[0] if "." in filename else filename
    safe = "".join(c for c in base if c.isalnum() or c in " ._-")
    return (safe.strip() or "converted") + ext


def _max_size_for(user: User | None) -> int:
    """Signed-in users get a flat ×2 (spec §6.3); anonymous gets the base cap.
    Server-side deliberately ignores ``user.max_file_size`` to bound the
    expensive Gotenberg/Ghostscript path and match the client rule (§6.1)."""
    return MAX_FILE_SIZE * (2 if user else 1)


_READ_CHUNK_SIZE = 1024 * 1024  # 1MB


async def _read_capped(file: UploadFile, max_size: int) -> bytes:
    """Read ``file`` in chunks, aborting as soon as it exceeds ``max_size``.

    A plain ``await file.read()`` buffers the entire body into memory before
    ``validate_upload``'s size check ever runs — a client can make the API
    fully materialize an arbitrarily large upload as ``bytes`` regardless of
    what it declared. Chunked reads with an early abort mean a request that's
    already over the limit gets rejected without paying for the rest of it.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_READ_CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > max_size:
            raise ValidationError(
                f"File exceeds the {max_size // (1024 * 1024)}MB limit "
                "for this conversion type.",
                "too_large",
                bytes_read=total,
            )
        chunks.append(chunk)
    return b"".join(chunks)


async def _handle_conversion(
    file: UploadFile,
    tool_id: str,
    convert_fn,
    output_ext: str = ".pdf",
    output_mime: str = "application/pdf",
    max_size: int = MAX_FILE_SIZE,
) -> Response:
    start = time.time()
    input_size = 0
    try:
        content = await _read_capped(file, max_size)
        input_size = len(content)
        validate_upload(content, file.filename or "unknown", tool_id, max_size)
        result = await convert_fn(content, file.filename or "file")
        duration_ms = round((time.time() - start) * 1000, 1)
        _record_metric(tool_id, True, duration_ms)

        logger.info(
            "Conversion OK: %s",
            tool_id,
            extra={
                "data": {
                    "event": "conversion_success",
                    "tool_id": tool_id,
                    "input_bytes": input_size,
                    "output_bytes": len(result),
                    "duration_ms": duration_ms,
                }
            },
        )

        output_filename = _safe_filename(file.filename or "file", output_ext)
        return Response(
            content=result,
            media_type=output_mime,
            headers={
                "Content-Disposition": f'attachment; filename="{output_filename}"',
                "X-Conversion-Time": f"{duration_ms}ms",
            },
        )
    except ValidationError as e:
        if e.bytes_read is not None:
            input_size = e.bytes_read
        duration_ms = round((time.time() - start) * 1000, 1)
        _record_metric(tool_id, False, duration_ms)
        logger.warning(
            "Validation failed: %s — %s",
            tool_id,
            e.error_type,
            extra={
                "data": {
                    "event": "validation_error",
                    "tool_id": tool_id,
                    "error_type": e.error_type,
                    "input_bytes": input_size,
                    "duration_ms": duration_ms,
                }
            },
        )
        return _error_response(e.message, e.error_type, 400)
    except ConversionQueueTimeout as e:
        duration_ms = round((time.time() - start) * 1000, 1)
        _record_metric(tool_id, False, duration_ms)
        logger.warning(
            "Conversion queue timeout: %s",
            tool_id,
            extra={
                "data": {
                    "event": "queue_timeout",
                    "tool_id": tool_id,
                    "input_bytes": input_size,
                    "duration_ms": duration_ms,
                }
            },
        )
        # Retryable, so callers get a Retry-After the same way the rate
        # limiter's 429 does (middleware.py) rather than a bare 503.
        return _error_response(
            str(e), "queue_timeout", 503, headers={"Retry-After": "10"}
        )
    except subprocess.TimeoutExpired:
        duration_ms = round((time.time() - start) * 1000, 1)
        _record_metric(tool_id, False, duration_ms)
        logger.error(
            "Conversion timeout: %s",
            tool_id,
            extra={
                "data": {
                    "event": "conversion_timeout",
                    "tool_id": tool_id,
                    "input_bytes": input_size,
                    "duration_ms": duration_ms,
                }
            },
        )
        return _error_response(
            "Conversion timed out. Try a simpler or smaller file.",
            "timeout",
            504,
        )
    except Exception:
        duration_ms = round((time.time() - start) * 1000, 1)
        _record_metric(tool_id, False, duration_ms)
        logger.error(
            "Conversion failed: %s",
            tool_id,
            exc_info=True,
            extra={
                "data": {
                    "event": "conversion_error",
                    "tool_id": tool_id,
                    "input_bytes": input_size,
                    "duration_ms": duration_ms,
                }
            },
        )
        return _error_response(
            "Conversion failed. The file may be corrupted or password-protected.",
            "conversion_error",
            500,
        )


@router.post("/convert/docx-to-pdf")
async def docx_to_pdf(
    file: UploadFile = File(...),
    user: User | None = Depends(current_user_for_convert),
):
    return await _handle_conversion(
        file, "docx-to-pdf", _convert_libreoffice, max_size=_max_size_for(user)
    )


@router.post("/convert/xlsx-to-pdf")
async def xlsx_to_pdf(
    file: UploadFile = File(...),
    user: User | None = Depends(current_user_for_convert),
):
    async def _convert(content: bytes, filename: str) -> bytes:
        return await _convert_libreoffice(
            content,
            filename,
            extra_form={"landscape": "true", "singlePageSheets": "true"},
        )

    return await _handle_conversion(
        file, "xlsx-to-pdf", _convert, max_size=_max_size_for(user)
    )


@router.post("/convert/pptx-to-pdf")
async def pptx_to_pdf(
    file: UploadFile = File(...),
    user: User | None = Depends(current_user_for_convert),
):
    return await _handle_conversion(
        file, "pptx-to-pdf", _convert_libreoffice, max_size=_max_size_for(user)
    )


@router.post("/convert/html-to-pdf")
async def html_to_pdf(
    file: UploadFile = File(...),
    user: User | None = Depends(current_user_for_convert),
):
    return await _handle_conversion(
        file, "html-to-pdf", _convert_chromium_html, max_size=_max_size_for(user)
    )


@router.post("/convert/pdf-compress")
async def pdf_compress(
    file: UploadFile = File(...),
    quality: str = Form("ebook"),
    user: User | None = Depends(current_user_for_convert),
):
    quality = validate_compress_quality(quality)

    async def _compress(content: bytes, filename: str) -> bytes:
        return await _compress_ghostscript(content, quality)

    return await _handle_conversion(
        file, "pdf-compress", _compress, max_size=_max_size_for(user)
    )


@router.post("/convert/pdf-to-docx")
async def pdf_to_docx(
    file: UploadFile = File(...),
    user: User | None = Depends(current_user_for_convert),
):
    return await _handle_conversion(
        file,
        "pdf-to-docx",
        _convert_pdf2docx,
        output_ext=".docx",
        output_mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        max_size=_max_size_for(user),
    )


async def _check_gotenberg() -> bool:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{GOTENBERG_URL}/health")
        return resp.status_code == 200
    except Exception:
        return False


async def _check_db() -> bool:
    # P2 §20 — an uptime monitor hitting /health should see the DB as part of
    # "is the API actually usable", not just the Gotenberg dependency:
    # ratings/history/auth/admin all go through it, same connectivity check
    # main.py's startup lifespan already does, just per-request instead of
    # once at boot.
    #
    # Post-merge audit fix: bounded with the same 5s budget as the Gotenberg
    # check. `async_engine` (data/db.py) sets no `connect_timeout` — only the
    # sync engine does — so an unbounded `.connect()` here could hang past a
    # monitor's polling interval on a network partition that drops packets
    # instead of refusing the connection outright. Unlike the lifespan's
    # ONE-TIME startup check this pattern mirrors, this one is now
    # re-triggered by every external poll, so a hang here is no longer a
    # one-off — it accumulates a stuck task (and a held pool connection) per
    # poll for as long as the partition lasts.
    try:
        async with asyncio.timeout(HEALTH_DB_TIMEOUT_SECONDS):
            async with async_engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


@router.api_route("/health", methods=["GET", "HEAD"])
async def health():
    # Run concurrently, not sequentially — both checks are independently
    # bounded at 5s, but running them one after another let a partial outage
    # (both dependencies slow-but-not-instantly-refused) push total latency to
    # ~10s, right when a monitor most needs a fast "degraded" signal instead
    # of a bare timeout. gather() bounds total latency at max(5s, 5s).
    gotenberg_ok, db_ok = await asyncio.gather(_check_gotenberg(), _check_db())

    status = "healthy" if (gotenberg_ok and db_ok) else "degraded"
    if not gotenberg_ok:
        logger.warning(
            "Health check: Gotenberg unreachable",
            extra={
                "data": {
                    "event": "health_degraded",
                    "gotenberg": "down",
                }
            },
        )
    if not db_ok:
        logger.warning(
            "Health check: database unreachable",
            extra={
                "data": {
                    "event": "health_degraded",
                    "database": "down",
                }
            },
        )
    return {
        "status": status,
        "gotenberg": "up" if gotenberg_ok else "down",
        "database": "up" if db_ok else "down",
    }


@router.get("/metrics")
async def get_metrics():
    return {
        "conversions": dict(metrics["conversions"]),
        "failures": dict(metrics["failures"]),
        "avg_duration_ms": {
            k: round(v / max(metrics["conversions"][k] + metrics["failures"][k], 1), 1)
            for k, v in metrics["total_duration_ms"].items()
        },
    }
