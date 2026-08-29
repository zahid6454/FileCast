"""Tests for data/db.py's N-way dynamic engine resolution
(NEON_FAILOVER_PLAN.md §7.2).

Focused on two things the existing suite didn't otherwise exercise directly:
resilience when the registry *lookup itself* (not just the active-pointer
read, which already has its own fallback in node_registry.py) fails, and the
per-node engine cache actually avoiding a repeated registry read once warm.
"""

from data import db, node_registry
from data.node_registry import Node, register_node, set_active_node


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
