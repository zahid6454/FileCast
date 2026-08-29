"""Tests for data/node_registry.py (NEON_FAILOVER_PLAN.md §7.1/§6, Phase A).

Runs against the real test Redis instance (conftest.py's autouse
``_reset_rate_limiter`` fixture flushes it before/after every test) — same
"hit the real dependency, don't mock" posture the rest of this suite uses
for Redis. Only the Redis-unavailability paths mock anything, and only the
one call they need to fail.

``node_registry`` also keeps a module-level in-process cache
(``_cached_active_node_id``) that Redis flushing doesn't touch, so this
file resets it explicitly before every test — otherwise one test's
successful read could leak into another as a false "last-known-active"
fallback.
"""

import asyncio

import pytest
from data import node_registry
from data.node_registry import (
    DEFAULT_NODE_SETTINGS,
    POOL_OP_LOCK_TTL_SECONDS,
    SETTINGS_KEY,
    BootstrapAlreadyDoneError,
    NoActiveNodeError,
    Node,
    SwitchHistoryEntry,
    SwitchStatus,
    acquire_pool_lock,
    append_switch_history,
    assert_safe_operation_timeout,
    bootstrap,
    find_node_by_neon_project_id,
    get_active_node,
    get_health_fail_count,
    get_last_activity,
    get_node,
    get_settings,
    get_switch_history,
    get_switch_status,
    get_usage_cache,
    increment_health_fail_count,
    is_maintenance,
    list_nodes,
    pool_operation_lock,
    record_activity,
    register_node,
    release_pool_lock,
    reset_health_fail_count,
    set_active_node,
    set_maintenance,
    set_switch_status,
    set_usage_cache,
    update_settings,
)
from data.redis_client import redis_client
from pydantic import ValidationError


@pytest.fixture(autouse=True)
def _reset_in_process_cache(monkeypatch):
    """The active-node fallback cache lives outside Redis on purpose (§7.1)
    — reset it so each test starts as a process that has "never
    successfully read the registry", regardless of what earlier tests did.

    Also gives every test a FRESH refresh lock rather than reusing the
    module's shared instance: pytest-asyncio hands each test function its
    own event loop, and an asyncio.Lock binds to whichever loop first
    contends on it — reusing one instance across tests that genuinely
    contend on it (the coalescing test below) would risk a spurious
    "bound to a different event loop" failure in a later test, not a bug
    in the lock itself.
    """
    monkeypatch.setattr(node_registry, "_cached_active_node_id", None)
    monkeypatch.setattr(node_registry, "_cached_active_node_at", 0.0)
    monkeypatch.setattr(node_registry, "_active_node_refresh_lock", asyncio.Lock())


def _make_node(node_id="n1", neon_project_id="proj-1", status="ready") -> Node:
    return Node(
        node_id=node_id,
        display_name=f"Node {node_id}",
        connection_string=f"postgresql://user:pw@ep-{node_id}.neon.tech/filecast",
        neon_project_id=neon_project_id,
        status=status,
        created_at="2026-01-01T00:00:00+00:00",
    )


# --------------------------------------------------------------------------- #
# Registry CRUD
# --------------------------------------------------------------------------- #


async def test_register_get_list_round_trip():
    node = _make_node()
    await register_node(node)
    assert await get_node("n1") == node
    assert await list_nodes() == [node]


async def test_get_node_returns_none_for_unknown_id():
    assert await get_node("does-not-exist") is None


async def test_find_node_by_neon_project_id():
    node = _make_node(node_id="n1", neon_project_id="proj-x")
    await register_node(node)
    assert await find_node_by_neon_project_id("proj-x") == node
    assert await find_node_by_neon_project_id("proj-missing") is None


async def test_node_public_dict_never_includes_connection_string():
    node = _make_node()
    public = node.public_dict()
    assert "connection_string" not in public
    assert public["node_id"] == node.node_id


async def test_get_node_returns_none_for_corrupt_json():
    # A hand-edited or buggy Redis entry must never crash a reader.
    await redis_client.hset(node_registry.REGISTRY_KEY, "corrupt", "not valid json")
    assert await get_node("corrupt") is None


async def test_list_nodes_skips_corrupt_entries_but_keeps_good_ones():
    good = _make_node(node_id="good")
    await register_node(good)
    await redis_client.hset(node_registry.REGISTRY_KEY, "corrupt", "not valid json")
    assert await list_nodes() == [good]


# --------------------------------------------------------------------------- #
# Active pointer + Redis-unavailability fallback (§7.1) — the required §12
# coverage: fallback-to-last-known-active when Redis is made briefly
# unreachable mid-test.
# --------------------------------------------------------------------------- #


async def test_get_active_node_raises_when_never_read_and_registry_empty():
    with pytest.raises(NoActiveNodeError):
        await get_active_node()


async def test_get_active_node_raises_when_never_read_and_redis_unreachable(
    monkeypatch,
):
    async def boom(*_args, **_kwargs):
        raise ConnectionError("redis down")

    monkeypatch.setattr(redis_client, "get", boom)
    with pytest.raises(NoActiveNodeError):
        await get_active_node()


async def test_get_active_node_falls_back_and_then_recovers_mid_test(monkeypatch):
    await set_active_node("node-a")
    assert await get_active_node() == "node-a"

    # Force past the short in-process cache TTL so the next call actually
    # hits Redis instead of short-circuiting on the cached value, then make
    # that Redis call fail.
    monkeypatch.setattr(node_registry, "_cached_active_node_at", 0.0)

    original_get = redis_client.get

    async def boom(*_args, **_kwargs):
        raise ConnectionError("redis down")

    monkeypatch.setattr(redis_client, "get", boom)
    # Redis is "down" — must fall back to the last successfully-read value,
    # not raise and not return garbage.
    assert await get_active_node() == "node-a"

    # Redis recovers, and the active node has genuinely changed in the
    # meantime (a real switch happened while this process couldn't see it).
    monkeypatch.setattr(redis_client, "get", original_get)
    monkeypatch.setattr(node_registry, "_cached_active_node_at", 0.0)
    await set_active_node("node-b")
    assert await get_active_node() == "node-b"


async def test_get_active_node_serves_from_cache_within_ttl_without_hitting_redis(
    monkeypatch,
):
    await set_active_node("node-a")
    assert await get_active_node() == "node-a"

    async def boom(*_args, **_kwargs):
        raise AssertionError("should not hit Redis while the in-process cache is fresh")

    monkeypatch.setattr(redis_client, "get", boom)
    # Cache is still fresh (no time has passed) — must not touch Redis at all.
    assert await get_active_node() == "node-a"


async def test_get_active_node_coalesces_concurrent_cache_misses(monkeypatch):
    # Regression guard (PR #143 review): two concurrent cache-misses used
    # to each issue their own Redis read, with no ordering guarantee on
    # which completed last — a slower-but-STALE read could silently
    # overwrite a faster-but-fresher one already in the cache. At most one
    # real Redis read should ever happen per refresh cycle, and every
    # concurrent caller should observe that single result.
    #
    # Deterministically orchestrates the interleaving via asyncio.Event
    # gates rather than relying on asyncio.gather's (unspecified)
    # scheduling to happen to race the two calls a particular way.
    await set_active_node("node-a")
    monkeypatch.setattr(node_registry, "_cached_active_node_id", None)
    monkeypatch.setattr(node_registry, "_cached_active_node_at", 0.0)

    redis_call_count = 0
    second_caller_may_start = asyncio.Event()
    first_caller_may_finish = asyncio.Event()
    original_get = redis_client.get

    async def gated_get(*args, **kwargs):
        nonlocal redis_call_count
        redis_call_count += 1
        second_caller_may_start.set()
        await first_caller_may_finish.wait()
        return await original_get(*args, **kwargs)

    monkeypatch.setattr(redis_client, "get", gated_get)

    first_task = asyncio.create_task(get_active_node())
    await second_caller_may_start.wait()
    second_task = asyncio.create_task(get_active_node())
    # Let the second caller run up to the point where it blocks on the
    # refresh lock (it must NOT reach redis_client.get at all while the
    # first caller already holds the lock).
    await asyncio.sleep(0)
    first_caller_may_finish.set()

    assert await first_task == "node-a"
    assert await second_task == "node-a"
    assert redis_call_count == 1


# --------------------------------------------------------------------------- #
# Maintenance flag
# --------------------------------------------------------------------------- #


async def test_maintenance_defaults_false_and_toggles():
    assert await is_maintenance() is False
    await set_maintenance(True)
    assert await is_maintenance() is True
    await set_maintenance(False)
    assert await is_maintenance() is False


async def test_maintenance_fails_open_on_redis_error(monkeypatch):
    async def boom(*_args, **_kwargs):
        raise ConnectionError("redis down")

    monkeypatch.setattr(redis_client, "get", boom)
    assert await is_maintenance() is False


# --------------------------------------------------------------------------- #
# Pool-operation lock — atomicity, expiry/recovery, and the TTL/timeout
# tension guard (§7.1, the required §12 coverage).
# --------------------------------------------------------------------------- #


async def test_pool_lock_acquire_is_atomic_under_concurrent_attempts():
    results = await asyncio.gather(
        *(acquire_pool_lock(f"holder-{i}") for i in range(12))
    )
    winners = [token for token in results if token is not None]
    assert len(winners) == 1


async def test_pool_lock_blocks_a_second_holder_until_released():
    token = await acquire_pool_lock("switch:1")
    assert token is not None
    assert await acquire_pool_lock("switch:2") is None

    assert await release_pool_lock(token) is True
    token2 = await acquire_pool_lock("switch:3")
    assert token2 is not None


async def test_pool_lock_release_requires_the_matching_token():
    token = await acquire_pool_lock("switch:1")
    assert await release_pool_lock("some-other-token") is False
    # Still held — the mismatched release must not have deleted it.
    assert await acquire_pool_lock("switch:2") is None
    assert await release_pool_lock(token) is True


async def test_pool_lock_expires_and_recovers_after_simulated_crash():
    crashed_token = await acquire_pool_lock("switch:crashed", ttl_seconds=0.2)
    assert crashed_token is not None
    # A contender while the crashed holder's TTL hasn't lapsed yet.
    assert await acquire_pool_lock("switch:contender") is None

    await asyncio.sleep(0.35)

    # No one ever released crashed_token (simulating the process dying
    # mid-operation) — the TTL alone must be what recovers this.
    recovered_token = await acquire_pool_lock("switch:recovery")
    assert recovered_token is not None


async def test_pool_operation_lock_context_manager_releases_on_exception():
    with pytest.raises(RuntimeError, match="boom"):
        async with pool_operation_lock("switch:ctx") as token:
            assert token is not None
            raise RuntimeError("boom")

    # Released even though the body raised.
    token_after = await acquire_pool_lock("switch:after")
    assert token_after is not None


async def test_force_release_pool_lock_clears_regardless_of_token():
    await acquire_pool_lock("switch:leftover")
    await node_registry.force_release_pool_lock()
    token = await acquire_pool_lock("switch:fresh")
    assert token is not None


async def test_pool_operation_lock_yields_none_when_already_held():
    async with pool_operation_lock("switch:outer") as outer_token:
        assert outer_token is not None
        async with pool_operation_lock("switch:inner") as inner_token:
            assert inner_token is None
        # The inner CM's no-op exit (it never held anything) must not have
        # released the outer lock out from under it.
        assert await acquire_pool_lock("switch:another-contender") is None


def test_assert_safe_operation_timeout_accepts_a_bounded_timeout():
    assert_safe_operation_timeout(60)  # nowhere near POOL_OP_LOCK_TTL_SECONDS


def test_assert_safe_operation_timeout_rejects_a_timeout_at_the_lock_ttl():
    with pytest.raises(ValueError):
        assert_safe_operation_timeout(POOL_OP_LOCK_TTL_SECONDS)


def test_assert_safe_operation_timeout_boundary_is_the_margin_below_ttl():
    # Exactly at TTL-minus-margin still leaves the full margin — allowed.
    assert_safe_operation_timeout(POOL_OP_LOCK_TTL_SECONDS - 30)
    # One second closer to the TTL than the margin allows — rejected.
    with pytest.raises(ValueError):
        assert_safe_operation_timeout(POOL_OP_LOCK_TTL_SECONDS - 30 + 1)


# --------------------------------------------------------------------------- #
# Shared health-failure counter
# --------------------------------------------------------------------------- #


async def test_health_fail_count_increments_and_resets():
    assert await get_health_fail_count() == 0
    assert await increment_health_fail_count() == 1
    assert await increment_health_fail_count() == 2
    assert await get_health_fail_count() == 2
    await reset_health_fail_count()
    assert await get_health_fail_count() == 0


# --------------------------------------------------------------------------- #
# Usage cache / last activity / switch status+history — plain round trips.
# --------------------------------------------------------------------------- #


async def test_usage_cache_round_trip():
    assert await get_usage_cache("n1") is None
    await set_usage_cache("n1", 0.42)
    cached = await get_usage_cache("n1")
    assert cached is not None
    assert cached.ratio == 0.42


async def test_get_usage_cache_returns_none_for_corrupt_json():
    await redis_client.set(node_registry._usage_key("n1"), "not valid json")
    assert await get_usage_cache("n1") is None


async def test_last_activity_round_trip():
    assert await get_last_activity("n1") is None
    await record_activity("n1")
    assert await get_last_activity("n1") is not None


async def test_switch_status_round_trip():
    assert await get_switch_status("run-1") is None
    await set_switch_status("run-1", SwitchStatus(status="pending"))
    status = await get_switch_status("run-1")
    assert status is not None
    assert status.status == "pending"


async def test_get_switch_status_returns_none_for_corrupt_json():
    await redis_client.set(node_registry._switch_status_key("run-1"), "not valid json")
    assert await get_switch_status("run-1") is None


async def test_switch_history_is_capped(monkeypatch):
    monkeypatch.setattr(node_registry, "SWITCH_HISTORY_MAX_LEN", 3)
    for i in range(5):
        await append_switch_history(
            SwitchHistoryEntry(
                trigger="manual",
                source_node_id=f"s{i}",
                target_node_id=f"t{i}",
                outcome="success",
                at="2026-01-01T00:00:00+00:00",
            )
        )
    history = await get_switch_history(limit=10)
    assert len(history) == 3
    # Most recent first (LPUSH) — the last three appended survive the trim.
    assert [entry.source_node_id for entry in history] == ["s4", "s3", "s2"]


async def test_get_switch_history_skips_corrupt_entries():
    await redis_client.lpush(node_registry.SWITCH_HISTORY_KEY, "not valid json")
    await append_switch_history(
        SwitchHistoryEntry(
            trigger="manual",
            source_node_id="s1",
            target_node_id="t1",
            outcome="success",
            at="2026-01-01T00:00:00+00:00",
        )
    )
    history = await get_switch_history(limit=10)
    assert len(history) == 1
    assert history[0].source_node_id == "s1"


# --------------------------------------------------------------------------- #
# Settings (§8) — hardcoded fallback defaults on a Redis read failure.
# --------------------------------------------------------------------------- #


async def test_settings_return_defaults_when_unset():
    assert await get_settings() == DEFAULT_NODE_SETTINGS


async def test_settings_fall_back_to_defaults_on_redis_error(monkeypatch):
    async def boom(*_args, **_kwargs):
        raise ConnectionError("redis down")

    monkeypatch.setattr(redis_client, "hgetall", boom)
    assert await get_settings() == DEFAULT_NODE_SETTINGS


async def test_update_settings_persists_and_merges_with_defaults():
    updated = await update_settings({"warmup_threshold_pct": 65})
    assert updated.warmup_threshold_pct == 65

    fetched = await get_settings()
    assert fetched.warmup_threshold_pct == 65
    assert fetched.cutover_threshold_pct == DEFAULT_NODE_SETTINGS.cutover_threshold_pct


async def test_update_settings_rejects_an_invalid_value():
    with pytest.raises(ValidationError):
        await update_settings({"reactive_failure_count": "not-a-number"})


async def test_update_settings_rejects_an_unknown_field_cleanly():
    # Regression guard: an unknown key used to silently vanish during
    # NodeSettings' merge/validate (extra="ignore", kept deliberately for
    # get_settings()'s corrupt-hash resilience) and then blow up with a
    # confusing AttributeError when building the changed-fields mapping,
    # instead of a clean, actionable error.
    with pytest.raises(ValueError, match="typo_field"):
        await update_settings({"typo_field": 1})

    # Must not have partially written anything.
    assert await get_settings() == DEFAULT_NODE_SETTINGS


async def test_update_settings_with_empty_partial_is_a_no_op():
    # Regression guard (PR #143 review): redis-py's hset rejects an empty
    # mapping outright (DataError) — an empty partial must short-circuit
    # to a clean no-op instead of leaking that as an unhandled 500 (the
    # future PUT route could receive an empty body).
    await update_settings({"warmup_threshold_pct": 65})
    result = await update_settings({})
    assert result.warmup_threshold_pct == 65
    assert result == await get_settings()


async def test_update_settings_does_not_clobber_a_field_changed_mid_update(monkeypatch):
    # Regression guard: update_settings() used to read-modify-write the
    # FULL settings snapshot, so a second writer changing a DIFFERENT field
    # between this call's read and its write would have that change
    # silently overwritten by this call's now-stale view of it. §7.12
    # designs each of the five settings as its own independently
    # auto-saving control (no batch submit), so two edits landing close
    # together is a realistic scenario, not a hypothetical one.
    #
    # Deterministically forces the exact interleaving (read, THEN a
    # concurrent write to a different field, THEN this call's own write)
    # rather than relying on asyncio.gather to happen to schedule it that
    # way — gather makes no ordering guarantee, so it could pass without
    # ever actually exercising the race window.
    original_get_settings = node_registry.get_settings

    async def get_settings_then_concurrent_write():
        current = await original_get_settings()
        await redis_client.hset(SETTINGS_KEY, "cutover_threshold_pct", "90")
        return current

    monkeypatch.setattr(
        node_registry, "get_settings", get_settings_then_concurrent_write
    )
    await update_settings({"warmup_threshold_pct": 65})
    monkeypatch.setattr(node_registry, "get_settings", original_get_settings)

    fetched = await get_settings()
    assert fetched.warmup_threshold_pct == 65
    assert fetched.cutover_threshold_pct == 90


# --------------------------------------------------------------------------- #
# Bootstrap (§6) — the required §12 coverage: starting from an empty
# registry, confirm it registers correctly and get_active_node() resolves
# right after.
# --------------------------------------------------------------------------- #


async def test_bootstrap_from_empty_registry_registers_and_resolves():
    node = await bootstrap(
        neon_project_id="proj-original",
        connection_string="postgresql://user:pw@ep-original.neon.tech/filecast",
        display_name="Original Neon Project",
    )

    assert node.status == "ready"
    assert node.neon_project_id == "proj-original"

    active_id = await get_active_node()
    assert active_id == node.node_id

    fetched = await get_node(node.node_id)
    assert fetched == node

    all_nodes = await list_nodes()
    assert all_nodes == [node]


async def test_bootstrap_refuses_to_run_twice():
    await bootstrap(neon_project_id="proj-1", connection_string="postgresql://a/b")
    with pytest.raises(BootstrapAlreadyDoneError):
        await bootstrap(neon_project_id="proj-2", connection_string="postgresql://c/d")

    # The first bootstrap's active pointer must be untouched by the
    # rejected second attempt.
    nodes = await list_nodes()
    assert len(nodes) == 1
    assert nodes[0].neon_project_id == "proj-1"
