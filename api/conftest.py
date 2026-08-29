"""Test harness for the FileCast API.

Runs the whole suite against a **separate** ``filecast_test`` database (never the
dev ``filecast`` DB). Schema is built from the models once per session; each test
is isolated by truncating all tables afterward (fast, and the app's routes call
``commit()`` so a transaction-rollback approach would need savepoint juggling —
truncation is simpler and robust here).

IMPORTANT: ``DATABASE_URL`` is set **before** any ``data.*`` import so both the
async engine (app) and sync engine (purge/seed) bind to the test DB.
"""

import asyncio
import os
import sys

# psycopg async cannot use Windows' default ProactorEventLoop; force the
# SelectorEventLoop policy before pytest-asyncio creates any loop. (Host-only
# concern — the app runs on Linux in the container, which is unaffected.)
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

os.environ.setdefault("ENVIRONMENT", "development")
os.environ["DATABASE_URL"] = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://filecast:filecast_dev@localhost:5432/filecast_test",
)
# Isolated logical DB index — mirrors TEST_DATABASE_URL's pattern — so the
# rate limiter / job-worker wake-up tests never collide with a dev instance's
# real Redis counters.
os.environ["REDIS_URL"] = os.getenv("TEST_REDIS_URL", "redis://localhost:6379/1")
# Deterministic salt so fingerprint tests are stable.
os.environ.setdefault("FINGERPRINT_SALT", "test-salt")

import main  # noqa: E402  (imports the app; binds engines to the test DB)
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from data import node_registry  # noqa: E402
from data.db import Base, async_session_factory, sync_engine  # noqa: E402
from data.models import Tool  # noqa: E402
from data.redis_client import redis_client  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _schema():
    """Create the schema on the test DB once; drop at the end."""
    Base.metadata.drop_all(sync_engine)
    Base.metadata.create_all(sync_engine)
    yield
    Base.metadata.drop_all(sync_engine)


@pytest.fixture(autouse=True)
def _clean_tables():
    """Truncate every table after each test for isolation."""
    yield
    tables = ", ".join(t.name for t in reversed(Base.metadata.sorted_tables))
    with sync_engine.begin() as conn:
        conn.exec_driver_sql(f"TRUNCATE {tables} RESTART IDENTITY CASCADE")


@pytest_asyncio.fixture(autouse=True)
async def _reset_rate_limiter():
    """Flush the isolated test Redis logical DB before each test.

    The rate limiter (Redis-backed, Phase 3) and the job-worker wake-up queue
    both live in this same logical DB — the per-test dev-login calls alone
    would blow the 20/hr dev-login budget without this, and a stale wake-up
    entry from a prior test could otherwise leak into another.

    Teardown disconnects the pool's connections while THIS test's event loop
    is still the running one — pytest-asyncio gives every test function its
    own fresh loop, and redis.asyncio's pooled connections are bound to
    whichever loop was running when they opened. Leaving them for the next
    test to reuse fails with "Future attached to a different loop" the
    moment that new loop tries to read from a socket opened on the old one;
    disconnecting here (not at setup) means the pool is empty by the time
    the next test's `flushdb()` runs, so it always opens a fresh connection
    on ITS OWN loop instead.

    NEON_FAILOVER_PLAN.md §7.2 surfaced a second, distinct instance of this
    same class of bug: ``connection_pool.disconnect()`` only closes actual
    socket connections — it never touches the pool's own internal
    ``asyncio.Lock`` (``redis/asyncio/connection.py``'s ``ConnectionPool``),
    acquired on every single ``get_connection()`` call. ``asyncio.Lock``
    only actually binds to an event loop the first time it's genuinely
    *contended* (two callers needing it at the same instant) — its fast,
    uncontended path never touches the loop at all — so this had never
    surfaced before. `/health`'s three checks now run three concurrent
    Redis-touching coroutines instead of two (``_check_db()`` also resolves
    the active node via Redis, §7.2), which is just enough added concurrency
    to trigger genuine contention reliably. Once that binds the lock to a
    test's now-dead loop, every later test whose own concurrent Redis calls
    contend on it crashes with "bound to a different event loop" — a
    pytest-asyncio-only artifact (a real deployment has exactly one
    long-lived loop for the process's whole life), but real here. Replacing
    the lock, not just disconnecting sockets, closes this for good.
    """
    await redis_client.flushdb()
    yield
    await redis_client.connection_pool.disconnect()
    redis_client.connection_pool._lock = asyncio.Lock()


@pytest.fixture(autouse=True)
def _reset_node_registry_lock(monkeypatch):
    """NEON_FAILOVER_PLAN.md §7.2 made ``node_registry.get_active_node()``
    reachable from nearly every DB-touching test (``data.db``'s dynamic
    ``get_session()``/``sync_session()`` call it on every use), not just
    ``test_node_registry.py``'s own tests, which already reset this locally.

    Its module-level ``_active_node_refresh_lock`` (a bare ``asyncio.Lock()``
    built at import time) binds to whichever event loop first acquires it —
    reusing that same instance across tests, each with pytest-asyncio's own
    fresh event loop (same reasoning as ``_reset_rate_limiter`` above, for
    Redis's connection pool), crashes with "bound to a different event loop"
    the moment a second test's cache miss reaches the lock. A fresh, never-
    yet-acquired Lock is behaviorally identical to an already-released one,
    so this is free to do unconditionally.

    Deliberately does NOT also reset the cached active-node id/timestamp:
    doing so forces every single test's first DB touch through a real Redis
    round trip (via the lock above) instead of letting the cache's own
    3-second TTL carry it across nearby tests the way it does in production
    — multiplied across the whole suite, that measurably added Redis load
    and was the actual cause of intermittent Redis-timeout failures in
    unrelated tests (rate limiter, health checks) when this fixture reset
    the cache too. Tests that specifically need a guaranteed-blank cache
    (test_node_registry.py, test_resolve_active_db_url.py) reset it
    themselves.
    """
    monkeypatch.setattr(node_registry, "_active_node_refresh_lock", asyncio.Lock())


async def _new_client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=main.app), base_url="http://test")


@pytest_asyncio.fixture
async def client():
    """Anonymous client (its own cookie jar)."""
    c = await _new_client()
    try:
        yield c
    finally:
        await c.aclose()


@pytest_asyncio.fixture
async def admin_client():
    """Client logged in as the seeded dev admin (independent cookie jar)."""
    c = await _new_client()
    r = await c.post("/api/v1/auth/dev-login", json={"role": "admin"})
    assert r.status_code == 200, r.text
    try:
        yield c
    finally:
        await c.aclose()


@pytest_asyncio.fixture
async def user_client():
    """Client logged in as the seeded dev (non-admin) user."""
    c = await _new_client()
    r = await c.post("/api/v1/auth/dev-login", json={"role": "user"})
    assert r.status_code == 200, r.text
    try:
        yield c
    finally:
        await c.aclose()


@pytest_asyncio.fixture
async def db():
    """Direct async session for arrange/assert."""
    async with async_session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def seeded_tools(db):
    """A couple of Tool rows for tools/admin tests."""
    db.add_all(
        [
            Tool(
                id="jpg-to-png",
                enabled=True,
                sort_order=1,
                category="image-conversion",
                name="JPG to PNG",
                input_format="JPG",
                output_format="PNG",
            ),
            Tool(
                id="docx-to-pdf",
                enabled=True,
                sort_order=2,
                category="document-conversion",
                name="DOCX to PDF",
                input_format="DOCX",
                output_format="PDF",
            ),
        ]
    )
    await db.commit()
    return ["jpg-to-png", "docx-to-pdf"]
