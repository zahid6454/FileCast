"""Tests for data/security.py's current_user_for_convert() dynamic-node
resolution (NEON_FAILOVER_PLAN.md §7.2/§12).

This call site is the one Phase B's plan calls out as easy to miss: it opens
its own session outside Depends(get_session), and its own
`except Exception: return None` means a stale/abandoned-node session hiccup
degrades a logged-in user to anonymous SILENTLY — no error, no log, no
health-check signal. A "no error" test wouldn't catch a regression back to
the old hardcoded `async_session_factory` import (this test environment has
only one real Postgres, so the wrong code path would still happen to reach
it) — so this asserts BOTH that the real user is resolved after a switch
(the positive assertion the plan calls for) AND that the call actually went
through data.db's dynamic accessor, not a fixed reference.
"""

from data import node_registry, security
from data.config import settings
from data.node_registry import Node, register_node, set_active_node


class _FakeRequest:
    """current_user_for_convert only ever reads .cookies — no real Request
    plumbing needed to exercise it directly."""

    def __init__(self, cookies: dict[str, str]):
        self.cookies = cookies


def _make_node(node_id: str, connection_string: str) -> Node:
    return Node(
        node_id=node_id,
        display_name=f"Node {node_id}",
        connection_string=connection_string,
        neon_project_id=f"proj-{node_id}",
        status="ready",
        created_at="2026-01-01T00:00:00+00:00",
    )


async def test_current_user_for_convert_resolves_real_user_after_a_switch(
    user_client, monkeypatch
):
    raw_token = user_client.cookies.get(settings.session_cookie_name)
    assert raw_token  # dev-login actually set the cookie

    # conftest.py's global fixture deliberately does NOT reset the cached
    # active-node id between tests (see its docstring) — reset it here so a
    # value left warm by an unrelated earlier test can't mask this test's
    # own set_active_node() call below.
    monkeypatch.setattr(node_registry, "_cached_active_node_id", None)
    monkeypatch.setattr(node_registry, "_cached_active_node_at", 0.0)

    # Both nodes point at this test's own real database — the only Postgres
    # this test environment has. What's under test is that current_user_for_
    # convert() re-resolves against WHICHEVER node is active right now (and
    # goes through the real dynamic accessor to do it), not whether the two
    # registered nodes are physically different databases.
    node_a = _make_node("switch-test-a", settings.database_url)
    node_b = _make_node("switch-test-b", settings.database_url)
    await register_node(node_a)
    await register_node(node_b)
    await set_active_node(node_a.node_id)

    call_count = 0
    original_accessor = security.get_active_session_factory

    async def _counting_accessor():
        nonlocal call_count
        call_count += 1
        return await original_accessor()

    monkeypatch.setattr(security, "get_active_session_factory", _counting_accessor)

    fake_request = _FakeRequest({settings.session_cookie_name: raw_token})
    user = await security.current_user_for_convert(fake_request)
    assert user is not None
    assert user.email == "user@dev.local"
    # Proves this path actually goes through the dynamic accessor rather
    # than a symbol bound once at import — a regression back to importing
    # `async_session_factory` directly would make this attribute not exist
    # on `security` at all, failing the monkeypatch.setattr call above.
    assert call_count == 1

    # The in-process active-node cache (data/node_registry.py) has a short
    # TTL but is still real state — reset it explicitly so this switch is
    # actually observed on the next call, not timing-dependent.
    monkeypatch.setattr(node_registry, "_cached_active_node_id", None)
    monkeypatch.setattr(node_registry, "_cached_active_node_at", 0.0)
    await set_active_node(node_b.node_id)

    user_after_switch = await security.current_user_for_convert(fake_request)
    assert user_after_switch is not None
    assert user_after_switch.email == "user@dev.local"
    assert call_count == 2
