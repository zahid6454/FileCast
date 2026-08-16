"""Local dev/debug entrypoint (Windows host only).

The Docker image runs `alembic upgrade head && uvicorn ...` directly (see Dockerfile
CMD) on Linux, where the event-loop workaround below isn't needed. Running `main:app`
straight through `python -m uvicorn` on Windows breaks psycopg's async driver, which
cannot use the default ProactorEventLoop (same issue conftest.py works around for
pytest) — so debugging locally goes through this script instead, which sets the
compatible loop policy first and mirrors the Docker entrypoint's migrate-then-serve
order so a fresh local DB doesn't need a separate manual `alembic upgrade head`.
"""

import asyncio
import subprocess
import sys
from pathlib import Path

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn

if __name__ == "__main__":
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=Path(__file__).parent,
        check=True,
    )
    uvicorn.run("main:app", host="0.0.0.0", port=8090)
