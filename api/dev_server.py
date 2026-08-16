"""Local dev/debug entrypoint (Windows host only).

The Docker image runs uvicorn directly (see Dockerfile CMD) on Linux, where this
isn't needed. Running `main:app` straight through `python -m uvicorn` on Windows
breaks psycopg's async driver, which cannot use the default ProactorEventLoop
(same issue conftest.py works around for pytest) — so debugging locally goes
through this script instead, which sets the compatible loop policy first.
"""

import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8090)
