"""Tests for data/db.py's N-way dynamic engine resolution
(NEON_FAILOVER_PLAN.md §7.2).

Focused on two things the existing suite didn't otherwise exercise directly:
resilience when the registry *lookup itself* (not just the active-pointer
read, which already has its own fallback in node_registry.py) fails, and the
per-node engine cache actually avoiding a repeated registry read once warm.

Also covers ``_register_search_path_fix`` (PR #153, extended 2026-09 to also
hook pool "checkout" — see NEON_FAILOVER_PLAN.md's Phase D write-up, §11)
against a real server — see the "search_path connect/checkout hooks"
section below.
"""

import pytest
from data import db, node_registry
from data.node_registry import Node, register_node, set_active_node
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from test_node_sync import _node_sync_postgres_url, two_real_databases  # noqa: F401


def _make_node(node_id: str, connection_string: str) -> Node:
    return Node(
        node_id=node_id,
        display_name=f"Node {node_id}",
        connection_string=connection_string,
        neon_project_id=f"proj-{node_id}",
        status="ready",
        created_at="2026-01-01T00:00:00+00:00",
    )


async def _reset_active_node_cache(monkeypatch):
    """Same reasoning as test_security.py/test_resolve_active_db_url.py: the
    in-process active-node cache (§7.1) isn't reset by conftest.py's global
    fixture (deliberately, to avoid forcing every test through a real Redis
    round trip — see that fixture's docstring), so a value left warm by an
    unrelated earlier test could otherwise mask this test's own
    set_active_node() call."""
    monkeypatch.setattr(node_registry, "_cached_active_node_id", None)
    monkeypatch.setattr(node_registry, "_cached_active_node_at", 0.0)


async def test_get_active_engine_falls_back_when_registry_lookup_raises(monkeypatch):
    """§7.2: get_node() (node_registry.py) propagates a Redis error loudly by
    design for its other (admin/provisioning) callers — but db.py's dynamic
    accessors must degrade to the static engine on ANY resolution failure,
    the same as when get_active_node() itself can't resolve. Left unguarded,
    a transient Redis hiccup on this one call would 500 every request
    through get_session() and, worse, crash job_worker.py outright at
    startup (recover_orphaned_jobs() has no try/except around this call
    chain)."""
    await _reset_active_node_cache(monkeypatch)
    node = _make_node(
        "boom-node", "postgresql+psycopg://user:pw@ep-boom.neon.tech/filecast"
    )
    await register_node(node)
    await set_active_node(node.node_id)

    async def _boom(node_id):
        raise ConnectionError("redis down")

    monkeypatch.setattr(db, "get_node", _boom)

    engine = await db.get_active_engine()
    factory = await db.get_active_session_factory()

    assert engine is db.async_engine
    assert factory is db.async_session_factory


async def test_get_active_engine_falls_back_when_active_node_record_missing(
    monkeypatch,
):
    """A dangling active pointer (record absent from the registry hash) is a
    distinct failure from a lookup error — confirm it degrades the same
    way."""
    await _reset_active_node_cache(monkeypatch)
    await set_active_node("ghost-node-id")

    engine = await db.get_active_engine()

    assert engine is db.async_engine


async def test_get_active_session_factory_caches_engine_without_re_reading_registry(
    monkeypatch,
):
    """Once an engine is cached for a node_id, resolving it again must not
    re-fetch its Node record — the per-node cache (§7.2) exists specifically
    so repeated calls against the same active node don't turn every request
    into two Redis round trips instead of the one get_active_node() itself
    already needs."""
    await _reset_active_node_cache(monkeypatch)
    node = _make_node(
        "cache-test", "postgresql+psycopg://user:pw@ep-cache.neon.tech/filecast"
    )
    await register_node(node)
    await set_active_node(node.node_id)

    call_count = 0
    original_get_node = db.get_node

    async def _counting_get_node(node_id):
        nonlocal call_count
        call_count += 1
        return await original_get_node(node_id)

    monkeypatch.setattr(db, "get_node", _counting_get_node)

    first = await db.get_active_session_factory()
    second = await db.get_active_session_factory()

    assert call_count == 1  # only the first resolution touched the registry
    assert first is second  # same cached engine/session-factory pair

    del db._async_node_engines[node.node_id]  # avoid leaking a fake engine


async def test_dispose_engines_disposes_every_cached_node_engine(monkeypatch):
    """§7.2: shutdown must dispose whichever node's engine is actually
    cached, not assume the static one is the only engine ever connected to
    — confirm dispose_engines() clears a per-node engine from the cache
    (not just the static fallback engine) and actually calls .dispose() on
    it (a fake, unreachable connection_string means a failure to do so
    would surface as this test hanging or raising, not silently no-op'ing).
    """
    await _reset_active_node_cache(monkeypatch)
    node = _make_node(
        "dispose-test", "postgresql+psycopg://user:pw@ep-dispose.neon.tech/filecast"
    )
    await register_node(node)
    await set_active_node(node.node_id)

    await db.get_active_engine()  # populates _async_node_engines[node.node_id]
    assert node.node_id in db._async_node_engines

    await db.dispose_engines()

    assert db._async_node_engines == {}


async def test_get_active_sync_engine_falls_back_when_active_node_record_missing(
    monkeypatch,
):
    """Sync counterpart of the async test above — get_node_sync() already
    fails safe internally (returns None on any Redis error), so this
    confirms the end-to-end fallback still resolves to the static sync
    engine rather than raising."""
    monkeypatch.setattr(node_registry, "_cached_active_node_id_sync", None)
    monkeypatch.setattr(node_registry, "_cached_active_node_at_sync", 0.0)
    await set_active_node("ghost-node-id")

    entry = db._get_active_sync_engine()

    assert entry.engine is db.sync_engine
    assert entry.session_factory is db.sync_session_factory


# --------------------------------------------------------------------------- #
# _register_search_path_fix — the Phase D rehearsal gap (PR #153), plus the
# 2026-09-01 recurrence: PR #153's "connect"-only hook can't detect
# Neon's pooler silently reassigning an already-open connection to a
# different backend session — SQLAlchemy's "connect" event only fires on the
# very first physical open, not on every checkout. A real Postgres container
# (used below) has no pooler in front, so it can't reproduce that specific
# failure mode; the checkout-healing test simulates it directly instead, by
# mutating a pooled connection's session state out from under SQLAlchemy
# between one checkin and the next checkout, the same externally-invisible
# way a pooler backend swap would.
#
# Reuses test_node_sync.py's real-Postgres-18-server harness
# (TEST_NODE_SYNC_POSTGRES_URL / two_real_databases) rather than the main
# TEST_DATABASE_URL: breaking a role's search_path with ALTER ROLE is
# database-scoped but role-scoped too, and the shared test role/database
# backs every other test in this suite via db.sync_engine/async_engine's
# already-open pools — corrupting it (or racing its cleanup against pool
# reuse from unrelated tests) would risk cross-test breakage for no benefit.
# A throwaway database on the dedicated v18 server isolates the blast radius
# to just these two tests, same reasoning as
# test_ensure_search_path_fixes_a_role_with_no_default_schema.
#
# two_real_databases is imported, not redefined, so ruff's static analysis
# can't see the two tests below "use" it via pytest's parameter-name fixture
# injection — hence the F401/F811 noqa's on the import and each test's
# signature.
# --------------------------------------------------------------------------- #


def _break_search_path(dst_url: str) -> None:
    """ALTER ROLE ... SET search_path = '' on dst_url's own role/database —
    the exact state a console-created Neon project can leave its owner role
    in (§7.5/§7.8), and the one this fix must recover from on the very next
    physical connection."""
    admin_url = make_url(db._sync_url(dst_url))
    role = admin_url.username
    database = admin_url.database
    admin_engine = create_engine(db._sync_url(dst_url))
    try:
        with admin_engine.connect() as conn:
            conn.execute(
                text(
                    f'ALTER ROLE "{role}" IN DATABASE "{database}" SET search_path = \'\''
                )
            )
            conn.commit()
    finally:
        admin_engine.dispose()


@pytest.mark.skipif(
    _node_sync_postgres_url() is None,
    reason="TEST_NODE_SYNC_POSTGRES_URL not set — point it at a real "
    "Postgres 18 server (see ci.yml's postgres18 service) to run this test "
    "for real",
)
def test_register_search_path_fix_repairs_a_broken_role_sync(
    two_real_databases,  # noqa: F811 — fixture injection, not a redefinition
):
    """The actual bug: a fresh sync connection from a role with a broken
    search_path can't resolve an unqualified table name. Confirms
    _register_search_path_fix's pool "connect" event forces it back to
    "public" on the very first physical connection this engine ever opens —
    and that a connection handed back to the pool and checked out again
    still carries it too, now via the "checkout" hook re-asserting it on
    every reuse (see test_register_search_path_fix_heals_a_reassigned_pooled_connection_sync
    below for the case this alone doesn't cover: session state changing
    out from under an already-open connection, no new "connect" event)."""
    _, dst_url = two_real_databases
    _break_search_path(dst_url)

    engine = create_engine(db._sync_url(dst_url))
    db._register_search_path_fix(engine)
    try:
        with engine.connect() as conn:
            assert conn.execute(text("SHOW search_path")).scalar_one() == "public"
            conn.execute(text("CREATE TABLE _search_path_probe_sync (id int)"))
            conn.execute(text("DROP TABLE _search_path_probe_sync"))
            conn.commit()
        with engine.connect() as conn:  # a reused, not a newly-connected, DBAPI conn
            assert conn.execute(text("SHOW search_path")).scalar_one() == "public"
    finally:
        engine.dispose()


@pytest.mark.skipif(
    _node_sync_postgres_url() is None,
    reason="TEST_NODE_SYNC_POSTGRES_URL not set — point it at a real "
    "Postgres 18 server (see ci.yml's postgres18 service) to run this test "
    "for real",
)
async def test_register_search_path_fix_repairs_a_broken_role_async(
    two_real_databases,  # noqa: F811 — fixture injection, not a redefinition
):
    """Async counterpart — current_user() (the auth dependency the Phase D
    rehearsal actually hit, per _register_search_path_fix's own docstring)
    runs through the ASYNC engine, so the hook must work the way db.py
    actually attaches it: via AsyncEngine.sync_engine, not a plain sync
    Engine."""
    _, dst_url = two_real_databases
    _break_search_path(dst_url)

    async_engine = create_async_engine(dst_url)
    db._register_search_path_fix(async_engine.sync_engine)
    try:
        async with async_engine.connect() as conn:
            result = await conn.execute(text("SHOW search_path"))
            assert result.scalar_one() == "public"
            await conn.execute(text("CREATE TABLE _search_path_probe_async (id int)"))
            await conn.execute(text("DROP TABLE _search_path_probe_async"))
            await conn.commit()
    finally:
        await async_engine.dispose()


@pytest.mark.skipif(
    _node_sync_postgres_url() is None,
    reason="TEST_NODE_SYNC_POSTGRES_URL not set — point it at a real "
    "Postgres 18 server (see ci.yml's postgres18 service) to run this test "
    "for real",
)
def test_register_search_path_fix_heals_a_reassigned_pooled_connection_sync(
    two_real_databases,  # noqa: F811 — fixture injection, not a redefinition
):
    """The 2026-09-01 recurrence, reproduced directly: Neon's pooled
    connection string can silently reassign an already-open, already-fixed
    connection to a different backend session mid-lifetime (transaction-mode
    pooling — confirmed in Neon's own docs and empirically in
    _ensure_search_path()'s docstring). From SQLAlchemy's point of view the
    DBAPI connection object never closed, so "connect" never fires again —
    only "checkout" gets a chance to notice and re-fix it.

    A local Postgres container has no pooler in front to actually do this
    reassignment, so this test fakes the *externally observable effect* of
    one directly: reach past SQLAlchemy's pool and corrupt a connection's
    session-level search_path while it's sitting idle in the pool (exactly
    what a backend swap would leave behind), then check it back out through
    the engine as ordinary application code would and confirm the checkout
    hook silently repairs it before any query runs. Without the "checkout"
    hook (i.e. on PR #153's original connect-only fix) this assertion would
    fail, since the pool has no reason to open a new physical connection or
    fire "connect" again for a connection it believes is still healthy."""
    _, dst_url = two_real_databases

    engine = create_engine(db._sync_url(dst_url), pool_size=1, max_overflow=0)
    db._register_search_path_fix(engine)
    try:
        with engine.connect() as conn:
            assert conn.execute(text("SHOW search_path")).scalar_one() == "public"
            dbapi_connection = conn.connection.dbapi_connection

        # Connection is now checked back into the pool (pool_size=1 means the
        # *same* DBAPI connection object will be handed out next time) but
        # still open — simulating the pooler having reassigned its backend
        # session out from under it while idle, the same way an ALTER ROLE
        # or a prior SET can go stale per _ensure_search_path()'s docstring.
        existing_autocommit = dbapi_connection.autocommit
        dbapi_connection.autocommit = True
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("SET search_path = ''")
        finally:
            cursor.close()
        dbapi_connection.autocommit = existing_autocommit

        with engine.connect() as conn:
            reused = conn.connection.dbapi_connection
            assert reused is dbapi_connection, (
                "test invalid — pool handed out a different physical "
                "connection, so this isn't exercising the checkout hook"
            )
            assert conn.execute(text("SHOW search_path")).scalar_one() == "public"
    finally:
        engine.dispose()
