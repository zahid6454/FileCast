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
# Deterministic salt so fingerprint tests are stable.
os.environ.setdefault("FINGERPRINT_SALT", "test-salt")

import main  # noqa: E402  (imports the app; binds engines to the test DB)
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from data.db import Base, async_session_factory, sync_engine  # noqa: E402
from data.models import Tool  # noqa: E402
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


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """Clear the in-memory rate limiter before each test.

    ``main.app`` is a single instance whose limiter state would otherwise
    accumulate across tests — the per-test dev-login calls alone would blow the
    20/hr dev-login budget and break fixtures. We pin the built middleware stack
    (so the app reuses the same instance we clear) and empty the limiter.
    """
    from middleware import RateLimitMiddleware

    if main.app.middleware_stack is None:
        main.app.middleware_stack = main.app.build_middleware_stack()
    node = main.app.middleware_stack
    while node is not None:
        if isinstance(node, RateLimitMiddleware):
            node.requests.clear()
            break
        node = getattr(node, "app", None)
    yield


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
                category="document-tools",
                name="DOCX to PDF",
                input_format="DOCX",
                output_format="PDF",
            ),
        ]
    )
    await db.commit()
    return ["jpg-to-png", "docx-to-pdf"]
