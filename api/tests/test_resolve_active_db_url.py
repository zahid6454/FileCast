"""Tests for scripts/resolve_active_db_url.py (NEON_FAILOVER_PLAN.md §7.10,
§12) — the Dockerfile CMD's deploy-time migration-target resolver.

Confirms the two failure modes §7.10 exists to fix: a naive implementation
migrating whichever node was node #1 at Bootstrap forever (even once a
different node is active), and the pre-Bootstrap/Redis-down case not falling
back cleanly to the static DATABASE_URL.
"""

import pytest
from data import node_registry
from data.config import settings
from data.node_registry import Node, register_node, set_active_node

import scripts.resolve_active_db_url as resolve_active_db_url_module
from scripts.resolve_active_db_url import resolve


@pytest.fixture(autouse=True)
def _reset_in_process_cache(monkeypatch):
    """The active-node fallback cache (§7.1) lives outside Redis and outside
    the per-test Redis flush conftest.py already does — reset it explicitly
    so leftover state from an earlier test can't mask this file's own
    empty-registry case (conftest.py's global fixture resets only the
    refresh lock, not this cache — see its docstring)."""
    monkeypatch.setattr(node_registry, "_cached_active_node_id", None)
    monkeypatch.setattr(node_registry, "_cached_active_node_at", 0.0)


def _make_node(node_id: str, connection_string: str) -> Node:
    return Node(
        node_id=node_id,
        display_name=f"Node {node_id}",
        connection_string=connection_string,
        neon_project_id=f"proj-{node_id}",
        status="ready",
        created_at="2026-01-01T00:00:00+00:00",
    )


async def test_resolves_the_real_active_node_not_node_one():
    node_1 = _make_node("node-1", "postgresql://user:pw@ep-node1.neon.tech/filecast")
    node_2 = _make_node("node-2", "postgresql://user:pw@ep-node2.neon.tech/filecast")
    await register_node(node_1)
    await register_node(node_2)
    await set_active_node(node_2.node_id)

    resolved = await resolve()

    assert resolved == node_2.connection_string
    assert resolved != node_1.connection_string


async def test_falls_back_to_static_database_url_when_registry_is_empty():
    # conftest.py's autouse _reset_rate_limiter fixture already flushes the
    # test Redis before every test, and the fixture above resets the
    # in-process fallback cache — so the registry is genuinely empty here,
    # the same shape as the pre-Bootstrap window and a Redis outage.
    resolved = await resolve()
    assert resolved == settings.database_url


async def test_falls_back_to_static_database_url_when_active_node_record_is_missing():
    """A dangling active pointer (the record it points to is gone from the
    registry hash) is a distinct failure from "nothing set at all" — confirm
    it degrades the same way rather than raising."""
    await set_active_node("ghost-node-id")

    resolved = await resolve()

    assert resolved == settings.database_url


async def test_falls_back_to_static_database_url_when_registry_lookup_raises(
    monkeypatch,
):
    """The active pointer resolves fine, but the FOLLOW-UP registry lookup
    (get_node()) hits a transient Redis error — distinct from both "empty
    registry" and "record missing" above. Left unguarded, this crashes the
    script (non-zero exit, empty stdout), which makes the Dockerfile CMD's
    `export DATABASE_URL=$(...) && alembic upgrade head && ...` short-circuit
    before alembic ever runs — the container fails to start outright on a
    transient Redis hiccup, exactly the "blocks every future deploy" failure
    mode §7.10 exists to prevent."""
    node = _make_node("node-1", "postgresql://user:pw@ep-node1.neon.tech/filecast")
    await register_node(node)
    await set_active_node(node.node_id)

    async def _boom(node_id):
        raise ConnectionError("redis down")

    monkeypatch.setattr(resolve_active_db_url_module, "get_node", _boom)

    resolved = await resolve()

    assert resolved == settings.database_url
