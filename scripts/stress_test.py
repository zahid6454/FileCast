#!/usr/bin/env python3
"""Local stress/load test for the FileCast API.

Targets the local docker-compose stack ONLY (default http://localhost:8090).
Never point this at api.filecast.org — it will burn Neon's monthly CU-h
budget and trip production rate limits against real traffic.

Usage:
    python scripts/stress_test.py convert --concurrency 10 --requests 200
    python scripts/stress_test.py convert --tool html-to-pdf --concurrency 20 --requests 200
    python scripts/stress_test.py data --concurrency 50 --requests 1000
    python scripts/stress_test.py ratelimit --tool docx-to-pdf

Requires: httpx (already a runtime dep of api/requirements.txt).
"""

from __future__ import annotations

import argparse
import asyncio
import statistics
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import httpx

TEST_FILES_DIR = Path(__file__).resolve().parent.parent / "api" / "test-files"

CONVERT_TOOLS = {
    "docx-to-pdf": (
        "test.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    "xlsx-to-pdf": (
        "test.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
    "pptx-to-pdf": (
        "test.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ),
    "html-to-pdf": ("test.html", "text/html"),
    "pdf-compress": ("test.pdf", "application/pdf"),
    "pdf-to-docx": ("test.pdf", "application/pdf"),
}


@dataclass
class Result:
    status: int | None
    elapsed: float
    error: str | None = None


@dataclass
class Report:
    results: list[Result] = field(default_factory=list)

    def add(self, r: Result) -> None:
        self.results.append(r)

    def summarize(self, label: str, wall_time: float) -> None:
        n = len(self.results)
        ok = [r for r in self.results if r.status and 200 <= r.status < 300]
        rate_limited = [r for r in self.results if r.status == 429]
        client_err = [
            r
            for r in self.results
            if r.status and 400 <= r.status < 500 and r.status != 429
        ]
        server_err = [r for r in self.results if r.status and r.status >= 500]
        exceptions = [r for r in self.results if r.error]
        latencies = sorted(r.elapsed for r in self.results if r.status is not None)

        print(f"\n=== {label} ===")
        print(f"total requests   : {n}")
        print(f"wall time        : {wall_time:.2f}s  ({n / wall_time:.1f} req/s)")
        print(f"  2xx            : {len(ok)}")
        print(f"  429 rate-limit : {len(rate_limited)}")
        print(f"  4xx (other)    : {len(client_err)}")
        print(f"  5xx            : {len(server_err)}")
        print(f"  exceptions     : {len(exceptions)}")
        if latencies:

            def p(pct: float) -> float:
                return latencies[min(len(latencies) - 1, int(len(latencies) * pct))]

            print(
                f"latency (s)      : min={latencies[0]:.2f} p50={p(0.5):.2f} "
                f"p95={p(0.95):.2f} p99={p(0.99):.2f} max={latencies[-1]:.2f} "
                f"mean={statistics.mean(latencies):.2f}"
            )
        if exceptions:
            seen = {}
            for r in exceptions:
                seen[r.error] = seen.get(r.error, 0) + 1
            print("exception types  :", seen)
        if server_err:
            print("5xx sample       :", server_err[0].status)


async def _one_convert(
    client: httpx.AsyncClient, tool: str, filename: str, content: bytes, mime: str
) -> Result:
    t0 = time.monotonic()
    try:
        resp = await client.post(
            f"/api/v1/convert/{tool}",
            files={"file": (filename, content, mime)},
            timeout=60.0,
        )
        return Result(status=resp.status_code, elapsed=time.monotonic() - t0)
    except Exception as e:  # noqa: BLE001 - want every exception type surfaced in the report
        return Result(
            status=None, elapsed=time.monotonic() - t0, error=f"{type(e).__name__}: {e}"
        )


async def run_convert(
    base_url: str,
    tool: str,
    concurrency: int,
    total: int,
    file_override: str | None = None,
) -> None:
    filename, mime = CONVERT_TOOLS[tool]
    if file_override:
        # The bundled fixtures are deliberately tiny (test.pdf is 541 bytes)
        # so the default run stays fast — too small to put real load on
        # Ghostscript/LibreOffice/Chromium. Point at a bigger, realistic file
        # (e.g. a multi-MB image-heavy PDF) to actually stress pdf-compress;
        # STRESS_TEST_REPORT.md Finding 3's concurrency-cap numbers were
        # measured this way, not against the bundled test.pdf.
        content = Path(file_override).read_bytes()
        filename = Path(file_override).name
    else:
        content = (TEST_FILES_DIR / filename).read_bytes()
    report = Report()
    sem = asyncio.Semaphore(concurrency)

    async def worker(client: httpx.AsyncClient) -> None:
        async with sem:
            report.add(await _one_convert(client, tool, filename, content, mime))

    async with httpx.AsyncClient(base_url=base_url) as client:
        t0 = time.monotonic()
        await asyncio.gather(*(worker(client) for _ in range(total)))
        wall = time.monotonic() - t0

    report.summarize(f"convert /{tool}  (concurrency={concurrency}, n={total})", wall)


async def run_convert_all(base_url: str, concurrency: int, total: int) -> None:
    for tool in CONVERT_TOOLS:
        await run_convert(
            base_url, tool, concurrency, max(1, total // len(CONVERT_TOOLS))
        )


async def _one_get(client: httpx.AsyncClient, path: str) -> Result:
    t0 = time.monotonic()
    try:
        resp = await client.get(path, timeout=30.0)
        return Result(status=resp.status_code, elapsed=time.monotonic() - t0)
    except Exception as e:  # noqa: BLE001
        return Result(
            status=None, elapsed=time.monotonic() - t0, error=f"{type(e).__name__}: {e}"
        )


async def _one_post_json(
    client: httpx.AsyncClient, path: str, json_body: dict
) -> Result:
    t0 = time.monotonic()
    try:
        resp = await client.post(path, json=json_body, timeout=30.0)
        return Result(status=resp.status_code, elapsed=time.monotonic() - t0)
    except Exception as e:  # noqa: BLE001
        return Result(
            status=None, elapsed=time.monotonic() - t0, error=f"{type(e).__name__}: {e}"
        )


async def run_data(base_url: str, concurrency: int, total: int) -> None:
    """Mixed read/write burst against the DB-backed data layer.

    Exercises the SQLAlchemy async connection pool + the per-worker
    in-memory rate limiter, not Gotenberg/Ghostscript.
    """
    report = Report()
    sem = asyncio.Semaphore(concurrency)

    async def worker(client: httpx.AsyncClient, i: int) -> None:
        async with sem:
            if i % 4 == 0:
                report.add(await _one_get(client, "/api/v1/ratings/stress-test-tool"))
            elif i % 4 == 1:
                report.add(await _one_get(client, "/api/v1/announcements/active"))
            elif i % 4 == 2:
                report.add(
                    await _one_post_json(
                        client,
                        "/api/v1/conversions",
                        {
                            "tool_id": "stress-test-tool",
                            "input_format": "txt",
                            "output_format": "txt",
                            "status": "success",
                        },
                    )
                )
            else:
                report.add(
                    await _one_post_json(
                        client,
                        "/api/v1/ratings",
                        {"tool_id": "stress-test-tool", "vote": "yes"},
                    )
                )

    async with httpx.AsyncClient(base_url=base_url) as client:
        t0 = time.monotonic()
        await asyncio.gather(*(worker(client, i) for i in range(total)))
        wall = time.monotonic() - t0

    report.summarize(
        f"data-layer mixed GET/POST  (concurrency={concurrency}, n={total})", wall
    )


async def run_ratelimit_probe(base_url: str, tool: str) -> None:
    """Fire 100 sequential requests at one endpoint, one fresh TCP connection
    per request (``Connection: close``), to see exactly where 429s kick in —
    checks whether the documented per-worker gap (middleware.py: 4 workers x
    5/hr = up to ~20/hr) is real in practice. A single kept-alive connection
    would pin every request to one worker and hide the gap entirely, so this
    deliberately avoids httpx's connection reuse."""
    filename, mime = CONVERT_TOOLS[tool]
    content = (TEST_FILES_DIR / filename).read_bytes()
    statuses: list[int] = []
    for i in range(100):
        async with httpx.AsyncClient(
            base_url=base_url, headers={"Connection": "close"}
        ) as client:
            r = await _one_convert(client, tool, filename, content, mime)
        statuses.append(r.status or 0)
        if i > 0 and i % 10 == 9:
            ok = statuses.count(200)
            limited = statuses.count(429)
            print(f"  after {i + 1:>3} requests: 200={ok:>3} 429={limited:>3}")
    first_429 = next((i for i, s in enumerate(statuses) if s == 429), None)
    print(f"\n=== ratelimit probe /{tool} ===")
    print("configured limit : 5/hr (single worker) — see middleware.py PATH_LIMITS")
    print(f"first 429 at req#: {first_429}")
    print(f"total 200s       : {statuses.count(200)}")
    print(f"total 429s       : {statuses.count(429)}")
    print(f"other statuses   : {[s for s in statuses if s not in (200, 429)][:10]}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--base-url",
        default="http://localhost:8090",
        help="Never point this at production.",
    )
    sub = parser.add_subparsers(dest="mode", required=True)

    p_conv = sub.add_parser(
        "convert",
        help="Load-test server-side conversion endpoints (Gotenberg/Ghostscript).",
    )
    p_conv.add_argument("--tool", choices=[*CONVERT_TOOLS, "all"], default="all")
    p_conv.add_argument("--concurrency", type=int, default=10)
    p_conv.add_argument("--requests", type=int, default=100)
    p_conv.add_argument(
        "--file",
        default=None,
        help=(
            "Override the bundled fixture with a real file on disk (single "
            "--tool only, not 'all') — needed for tools like pdf-compress "
            "where the bundled fixture is too small to put real load on the "
            "underlying engine. NOTE: /api/v1/convert is rate-limited to "
            "5/hr per client IP (middleware.py PATH_LIMITS) — testing "
            "--concurrency above that will just 429 past the 5th request "
            "unless you restart the api container between runs to reset "
            "the (in-memory, per-worker) counter first."
        ),
    )

    p_data = sub.add_parser(
        "data", help="Load-test data-layer endpoints (DB pool, rate limiter)."
    )
    p_data.add_argument("--concurrency", type=int, default=50)
    p_data.add_argument("--requests", type=int, default=500)

    p_rl = sub.add_parser(
        "ratelimit", help="Sequential probe of one endpoint's rate-limit boundary."
    )
    p_rl.add_argument("--tool", choices=list(CONVERT_TOOLS), default="docx-to-pdf")

    args = parser.parse_args()

    if "localhost" not in args.base_url and "127.0.0.1" not in args.base_url:
        print(
            f"Refusing to run against non-local base-url: {args.base_url}",
            file=sys.stderr,
        )
        print("This tool is for the local docker-compose stack only.", file=sys.stderr)
        sys.exit(1)

    if args.mode == "convert":
        if args.file and args.tool == "all":
            print("--file requires a single --tool, not 'all'", file=sys.stderr)
            sys.exit(1)
        if args.tool == "all":
            asyncio.run(run_convert_all(args.base_url, args.concurrency, args.requests))
        else:
            asyncio.run(
                run_convert(
                    args.base_url, args.tool, args.concurrency, args.requests, args.file
                )
            )
    elif args.mode == "data":
        asyncio.run(run_data(args.base_url, args.concurrency, args.requests))
    elif args.mode == "ratelimit":
        asyncio.run(run_ratelimit_probe(args.base_url, args.tool))


if __name__ == "__main__":
    main()
