"""Tests for data/node_ops.py — switch + provisioning orchestration
(NEON_FAILOVER_PLAN.md §7.4/§7.8/§7.13, Phase D, §12).

Runs against the real test Redis instance (conftest.py's autouse fixtures
flush it before/after every test) — same "hit the real dependency, don't
mock" posture test_node_registry.py already uses for the pool-operation
lock, which is exactly what the concurrency tests below need to be
meaningful. ``scripts.node_sync.sync_node`` (the actual pg_dump/pg_restore
machinery — already covered by its own real-binary test in
test_node_sync.py) and ``data.neon_api.verify_project_visible`` are mocked
here: this file is about orchestration correctness (state transitions,
retry-on-failure, lock discipline), not re-proving the sync mechanics.
"""

import asyncio

import pytest
from data import job_worker, neon_api, node_ops
from data import node_registry as nr
from data.node_registry import (
    Node,
    get_active_node,
    get_node,
    get_switch_history,
    get_switch_status,
    is_maintenance,
    record_activity,
    register_node,
    set_active_node,
    set_usage_cache,
)
from data.redis_client import redis_client

import scripts.node_sync as node_sync


@pytest.fixture(autouse=True)
def _reset_in_process_cache(monkeypatch):
    """Same reasoning as test_node_registry.py's own fixture: the active-
    node fallback cache lives outside Redis on purpose (§7.1), so it must
    be reset for every test in this file to start from a clean slate."""
    monkeypatch.setattr(nr, "_cached_active_node_id", None)
    monkeypatch.setattr(nr, "_cached_active_node_at", 0.0)


@pytest.fixture(autouse=True)
def _fake_drain(monkeypatch):
    """execute_switch's cutover phase calls job_worker.drain_in_flight_jobs(),
    which resolves a real per-node DB engine for whatever node is currently
    active (§7.2). These tests register nodes with placeholder connection
    strings that don't point at a real Postgres — draining is already
    covered by its own tests in test_job_worker.py against the real test
    database, so it's stubbed here to let this file test execute_switch's
    own state-machine behavior in isolation. Tests that specifically care
    about the drain outcome override this via monkeypatch themselves."""

    async def _fake(*args, **kwargs):
        return True

    monkeypatch.setattr(job_worker, "drain_in_flight_jobs", _fake)


@pytest.fixture(autouse=True)
def _reset_claim_pause():
    """job_worker._claim_paused (§7.7) is a bare module-level global —
    execute_switch() pauses/resumes it via drain_in_flight_jobs()/
    resume_claiming(), so this must be reset the same way
    test_job_worker.py's own fixture resets it."""
    job_worker.resume_claiming()
    yield
    job_worker.resume_claiming()


def _make_node(
    node_id: str, *, neon_project_id: str | None = None, status="ready"
) -> Node:
    return Node(
        node_id=node_id,
        display_name=f"Node {node_id}",
        connection_string=f"postgresql://user:pw@ep-{node_id}.neon.tech/filecast",
        neon_project_id=neon_project_id or f"proj-{node_id}",
        status=status,
        created_at="2026-01-01T00:00:00+00:00",
    )


async def _lock_is_free() -> bool:
    return await redis_client.get(nr.POOL_OP_LOCK_KEY) is None


async def _noop_connectivity(node):
    """Stub for node_ops._check_connectivity — these tests register nodes
    with placeholder connection strings that don't point at a real
    Postgres, and _check_connectivity is a real bounded connect + SELECT 1.
    Used by both the provisioning tests below and the reactive-switch tests
    (the reactive branch probes the target the same way). Tests that
    specifically care about the probe-failure/fallback behavior override
    this via monkeypatch themselves."""
    return None


# --------------------------------------------------------------------------- #
# Wake-queue wire format (§7.13)
# --------------------------------------------------------------------------- #


def test_build_and_parse_switch_task_round_trip():
    raw = node_ops.build_switch_task(
        run_id="run-1", target_node_id="n2", trigger="manual"
    )
    parsed = node_ops.parse_wake_task(raw)
    assert parsed == (
        node_ops.TASK_TYPE_SWITCH,
        {"run_id": "run-1", "target_node_id": "n2", "trigger": "manual"},
    )


def test_build_and_parse_provision_task_round_trip():
    raw = node_ops.build_provision_task(run_id="run-2", node_id="n3")
    parsed = node_ops.parse_wake_task(raw)
    assert parsed == (
        node_ops.TASK_TYPE_PROVISION,
        {"run_id": "run-2", "node_id": "n3"},
    )


def test_parse_wake_task_returns_none_for_legacy_bare_job_id_string():
    # A real ConversionJob id (converter.py:1391) — not valid JSON at all.
    assert node_ops.parse_wake_task("550e8400-e29b-41d4-a716-446655440000") is None


def test_parse_wake_task_returns_none_for_non_dict_json():
    import json

    assert node_ops.parse_wake_task(json.dumps("just a string")) is None
    assert node_ops.parse_wake_task(json.dumps([1, 2, 3])) is None


def test_parse_wake_task_returns_none_for_unrecognized_task_type():
    import json

    assert node_ops.parse_wake_task(json.dumps({"task-type": "something_else"})) is None
    assert node_ops.parse_wake_task(json.dumps({"no-task-type": True})) is None


# --------------------------------------------------------------------------- #
# select_switch_target (§7.4)
# --------------------------------------------------------------------------- #


async def test_select_switch_target_returns_none_when_no_reserves():
    assert await node_ops.select_switch_target(exclude_node_ids=set()) is None


async def test_select_switch_target_excludes_non_ready_and_excluded_nodes():
    await register_node(_make_node("ready-1", status="ready"))
    await register_node(_make_node("retired-1", status="retired"))
    await register_node(_make_node("error-1", status="error"))
    await register_node(_make_node("provisioning-1", status="provisioning"))
    await register_node(_make_node("excluded-ready", status="ready"))

    target = await node_ops.select_switch_target(exclude_node_ids={"excluded-ready"})
    assert target == "ready-1"


async def test_select_switch_target_picks_lowest_usage_ratio():
    await register_node(_make_node("low-usage"))
    await register_node(_make_node("high-usage"))
    await set_usage_cache("low-usage", 0.1)
    await set_usage_cache("high-usage", 0.9)

    assert await node_ops.select_switch_target(exclude_node_ids=set()) == "low-usage"


async def test_select_switch_target_treats_missing_usage_cache_as_zero():
    await register_node(_make_node("no-cache"))
    await register_node(_make_node("has-cache"))
    await set_usage_cache("has-cache", 0.01)

    # no-cache defaults to ratio 0.0, strictly lower than has-cache's 0.01.
    assert await node_ops.select_switch_target(exclude_node_ids=set()) == "no-cache"


async def test_select_switch_target_tie_breaks_on_longest_since_active():
    from datetime import UTC, datetime, timedelta

    await register_node(_make_node("recently-active"))
    await register_node(_make_node("long-idle"))
    now = datetime.now(UTC)
    await record_activity("recently-active", when=now)
    await record_activity("long-idle", when=now - timedelta(days=30))

    assert await node_ops.select_switch_target(exclude_node_ids=set()) == "long-idle"


# --------------------------------------------------------------------------- #
# execute_switch — success and failure modes (§7.4/§7.7)
# --------------------------------------------------------------------------- #


async def test_execute_switch_success(monkeypatch):
    await register_node(_make_node("source"))
    await register_node(_make_node("target"))
    await set_active_node("source")

    sync_calls = []

    async def fake_sync(source, target):
        sync_calls.append((source, target))

    monkeypatch.setattr(node_ops.node_sync, "sync_node", fake_sync)

    await node_ops.execute_switch(
        run_id="run-ok", target_node_id="target", trigger="manual"
    )

    assert await get_active_node() == "target"
    status = await get_switch_status("run-ok")
    assert status.status == "done"
    assert status.source_node_id == "source"
    assert status.target_node_id == "target"
    history = await get_switch_history()
    assert history[0].outcome == "success"
    assert history[0].source_node_id == "source"
    assert history[0].target_node_id == "target"
    assert await is_maintenance() is False
    assert job_worker._claim_paused is False
    assert await _lock_is_free()
    # warm-up + final top-up, both against the same (only) target.
    assert sync_calls == [("source", "target"), ("source", "target")]


async def test_execute_switch_proceeds_past_a_drain_timeout(monkeypatch):
    # §7.7: a drain that hits its cap with jobs still converting must not
    # block the switch indefinitely — each job is bounded by its own queue
    # timeout regardless, so the cutover proceeds anyway.
    async def _drain_times_out(*args, **kwargs):
        return False

    monkeypatch.setattr(job_worker, "drain_in_flight_jobs", _drain_times_out)

    await register_node(_make_node("source"))
    await register_node(_make_node("target"))
    await set_active_node("source")

    async def fake_sync(source, target):
        pass

    monkeypatch.setattr(node_ops.node_sync, "sync_node", fake_sync)

    await node_ops.execute_switch(
        run_id="run-drain-to", target_node_id="target", trigger="manual"
    )

    status = await get_switch_status("run-drain-to")
    assert status.status == "done"
    assert await get_active_node() == "target"
    assert await _lock_is_free()


async def test_execute_switch_target_already_active_is_rejected():
    await register_node(_make_node("n1"))
    await set_active_node("n1")

    await node_ops.execute_switch(
        run_id="run-self", target_node_id="n1", trigger="manual"
    )

    status = await get_switch_status("run-self")
    assert status.status == "error"
    assert "already" in status.detail.lower()
    assert await get_active_node() == "n1"
    assert await _lock_is_free()


async def test_execute_switch_warmup_failure_retries_next_best_target(monkeypatch):
    await register_node(_make_node("source"))
    await register_node(_make_node("bad-target"))
    await register_node(_make_node("good-target"))
    await set_active_node("source")

    calls = []

    async def fake_sync(source, target):
        calls.append((source, target))
        if target == "bad-target":
            raise node_sync.NodeSyncError("connection refused")

    monkeypatch.setattr(node_ops.node_sync, "sync_node", fake_sync)

    await node_ops.execute_switch(
        run_id="run-retry", target_node_id="bad-target", trigger="manual"
    )

    status = await get_switch_status("run-retry")
    assert status.status == "done"
    assert status.target_node_id == "good-target"
    assert await get_active_node() == "good-target"
    assert calls.count(("source", "bad-target")) == 1
    assert calls.count(("source", "good-target")) == 2
    # node_sync.sync_node() truncates before restoring (§7.5) — a failed
    # warm-up sync can leave the target's data truncated/partially
    # restored, not just "still whatever it had before." Demoted to
    # "error" so a LATER, unrelated switch can't silently pick this same
    # node while its data is suspect.
    bad_target = await get_node("bad-target")
    assert bad_target.status == "error"
    assert await _lock_is_free()


async def test_execute_switch_warmup_failure_with_no_reserves_left_marks_error(
    monkeypatch,
):
    await register_node(_make_node("source"))
    await register_node(_make_node("only-target"))
    await set_active_node("source")

    async def fake_sync(source, target):
        raise node_sync.NodeSyncError("unreachable")

    monkeypatch.setattr(node_ops.node_sync, "sync_node", fake_sync)

    await node_ops.execute_switch(
        run_id="run-noreserve", target_node_id="only-target", trigger="manual"
    )

    status = await get_switch_status("run-noreserve")
    assert status.status == "error"
    assert "no reachable reserve" in status.detail.lower()
    assert await get_active_node() == "source"
    history = await get_switch_history()
    assert history[0].outcome == "failure"
    # Same reasoning as the retry case above: its own sync failed, so it
    # must not stay "ready" for a future switch to silently pick.
    only_target = await get_node("only-target")
    assert only_target.status == "error"
    assert await _lock_is_free()


async def test_execute_switch_target_retired_during_cutover_aborts_and_resumes(
    monkeypatch,
):
    # §7.4/§7.8: retiring a node is impossible while it's ACTIVE, but nothing
    # stops an admin from retiring a RESERVE node an in-flight switch has
    # already warmed up and is about to flip to. A stale/retired target's
    # connection string can still connect and sync fine, so a sync-failure
    # catch alone wouldn't catch this — must be an explicit status re-check
    # right before the flip.
    await register_node(_make_node("source"))
    await register_node(_make_node("target"))
    await set_active_node("source")

    call_count = {"n": 0}

    async def fake_sync(source, target):
        call_count["n"] += 1
        if call_count["n"] == 2:  # final top-up sync succeeds...
            # ...but simulate a concurrent admin retiring the target right
            # after, in the window before this switch flips to it.
            node = await get_node("target")
            await register_node(node.model_copy(update={"status": "retired"}))

    monkeypatch.setattr(node_ops.node_sync, "sync_node", fake_sync)

    await node_ops.execute_switch(
        run_id="run-retire-race", target_node_id="target", trigger="manual"
    )

    assert await get_active_node() == "source"
    status = await get_switch_status("run-retire-race")
    assert status.status == "error"
    assert "no longer a ready reserve" in status.detail.lower()
    node = await get_node("target")
    assert node.status == "retired"  # left exactly as the admin set it
    history = await get_switch_history()
    assert history[0].outcome == "failure"
    assert await is_maintenance() is False
    assert job_worker._claim_paused is False
    assert await _lock_is_free()


async def test_execute_switch_cutover_failure_resumes_on_original_node(monkeypatch):
    await register_node(_make_node("source"))
    await register_node(_make_node("target"))
    await set_active_node("source")

    call_count = {"n": 0}

    async def fake_sync(source, target):
        call_count["n"] += 1
        if (
            call_count["n"] == 2
        ):  # first call = warm-up (ok), second = final top-up (fails)
            raise node_sync.NodeSyncError("target vanished mid-cutover")

    monkeypatch.setattr(node_ops.node_sync, "sync_node", fake_sync)

    await node_ops.execute_switch(
        run_id="run-abort", target_node_id="target", trigger="manual"
    )

    assert await get_active_node() == "source"
    status = await get_switch_status("run-abort")
    assert status.status == "error"
    assert "final sync" in status.detail.lower()
    assert await is_maintenance() is False
    assert job_worker._claim_paused is False
    history = await get_switch_history()
    assert history[0].outcome == "failure"
    # The final top-up sync is a truncate-then-restore into "target"
    # (§7.5) — a failure here can leave it with corrupted/incomplete data,
    # so it must not stay "ready" for a future switch to silently pick.
    target = await get_node("target")
    assert target.status == "error"
    assert await _lock_is_free()


async def test_execute_switch_reactive_flips_immediately_without_sync(monkeypatch):
    # §7.4 Trigger 2: the source is unreachable — that's why this fired —
    # so no warm-up/top-up sync must even be attempted. If it were, this
    # test's fake sync would raise and the switch would (wrongly) fail.
    await register_node(_make_node("source"))
    await register_node(_make_node("target"))
    await set_active_node("source")

    async def boom(source, target):
        raise AssertionError("reactive switch must never call sync_node()")

    monkeypatch.setattr(node_ops.node_sync, "sync_node", boom)
    monkeypatch.setattr(node_ops, "_check_connectivity", _noop_connectivity)

    await node_ops.execute_switch(
        run_id="run-reactive-ok", target_node_id="target", trigger="reactive"
    )

    assert await get_active_node() == "target"
    status = await get_switch_status("run-reactive-ok")
    assert status.status == "done"
    assert status.trigger == "reactive"
    history = await get_switch_history()
    assert history[0].outcome == "success"
    assert history[0].trigger == "reactive"
    # §7.7: reactive never drains or enters maintenance — there's nothing a
    # pause-and-wait could rescue against an unreachable source.
    assert await is_maintenance() is False
    assert job_worker._claim_paused is False
    assert await _lock_is_free()
    # Target status is untouched by a reactive switch — no sync ran, only a
    # connectivity probe, so there's nothing to demote it for.
    target = await get_node("target")
    assert target.status == "ready"
    # The abandoned source must not stay "ready" — see the audit-fix comment
    # in node_ops.py's reactive branch: an untouched "ready" source would be
    # eligible again for a LATER switch's target selection with no
    # re-verification that it ever actually recovered.
    source = await get_node("source")
    assert source.status == "error"


async def test_execute_switch_reactive_rejects_a_non_ready_target(monkeypatch):
    await register_node(_make_node("source"))
    await register_node(_make_node("target", status="error"))
    await set_active_node("source")

    async def boom(source, target):
        raise AssertionError("reactive switch must never call sync_node()")

    monkeypatch.setattr(node_ops.node_sync, "sync_node", boom)
    monkeypatch.setattr(node_ops, "_check_connectivity", _noop_connectivity)

    await node_ops.execute_switch(
        run_id="run-reactive-bad-target", target_node_id="target", trigger="reactive"
    )

    assert await get_active_node() == "source"  # unchanged
    status = await get_switch_status("run-reactive-bad-target")
    assert status.status == "error"
    assert "no reachable reserve" in status.detail.lower()
    history = await get_switch_history()
    assert history[0].outcome == "failure"
    assert await _lock_is_free()
    # The source is presumed unreachable regardless of whether a reserve was
    # found to switch to — it gets demoted either way.
    source = await get_node("source")
    assert source.status == "error"


async def test_execute_switch_reactive_rejects_a_missing_target():
    await register_node(_make_node("source"))
    await set_active_node("source")

    await node_ops.execute_switch(
        run_id="run-reactive-missing-target",
        target_node_id="does-not-exist",
        trigger="reactive",
    )

    assert await get_active_node() == "source"
    status = await get_switch_status("run-reactive-missing-target")
    assert status.status == "error"
    assert "no reachable reserve" in status.detail.lower()
    assert await _lock_is_free()
    source = await get_node("source")
    assert source.status == "error"


async def test_execute_switch_reactive_falls_back_to_next_best_when_target_unreachable(
    monkeypatch,
):
    # The audit-fix regression test: a target that's still registered
    # "ready" isn't proof it's actually reachable right now (its status
    # only reflects its last successful sync, possibly days old, §7.9). If
    # the live probe fails, the reactive branch must demote that target and
    # retry against the next-best reserve — mirroring Phase 1's own
    # warm-up-target-failed retry loop — rather than either flipping onto a
    # dead node or giving up while a good reserve was available.
    await register_node(_make_node("source"))
    await register_node(_make_node("dead-reserve"))
    await register_node(_make_node("good-reserve"))
    await set_active_node("source")
    # dead-reserve sorts first (lower usage) so it's picked as the initial
    # target, forcing the fallback path to actually be exercised.
    await set_usage_cache("dead-reserve", 0.1)
    await set_usage_cache("good-reserve", 0.5)

    async def flaky_connectivity(node):
        if node.node_id == "dead-reserve":
            raise node_sync.NodeSyncError("connection refused")
        return None

    monkeypatch.setattr(node_ops, "_check_connectivity", flaky_connectivity)

    async def boom(source, target):
        raise AssertionError("reactive switch must never call sync_node()")

    monkeypatch.setattr(node_ops.node_sync, "sync_node", boom)

    await node_ops.execute_switch(
        run_id="run-reactive-fallback",
        target_node_id="dead-reserve",
        trigger="reactive",
    )

    assert await get_active_node() == "good-reserve"
    status = await get_switch_status("run-reactive-fallback")
    assert status.status == "done"
    assert status.target_node_id == "good-reserve"
    history = await get_switch_history()
    assert history[0].outcome == "success"
    assert history[0].target_node_id == "good-reserve"
    dead = await get_node("dead-reserve")
    assert dead.status == "error"
    good = await get_node("good-reserve")
    assert good.status == "ready"
    source = await get_node("source")
    assert source.status == "error"


async def test_execute_switch_reactive_respects_the_pool_lock(monkeypatch):
    await register_node(_make_node("source"))
    await register_node(_make_node("target"))
    await set_active_node("source")

    token = await nr.acquire_pool_lock("some-other-operation")
    try:
        await node_ops.execute_switch(
            run_id="run-reactive-locked", target_node_id="target", trigger="reactive"
        )
    finally:
        await nr.release_pool_lock(token)

    assert await get_active_node() == "source"  # never flipped
    status = await get_switch_status("run-reactive-locked")
    assert status.status == "error"
    assert "already in progress" in status.detail.lower()
    # Lock rejection happens before the reactive branch runs at all — the
    # source must be untouched, not demoted for an attempt that never ran.
    source = await get_node("source")
    assert source.status == "ready"


async def test_execute_switch_unexpected_error_still_releases_lock_and_resumes(
    monkeypatch,
):
    await register_node(_make_node("source"))
    await register_node(_make_node("target"))
    await set_active_node("source")

    async def boom(source, target):
        raise RuntimeError("something truly unexpected")

    monkeypatch.setattr(node_ops.node_sync, "sync_node", boom)

    await node_ops.execute_switch(
        run_id="run-boom", target_node_id="target", trigger="manual"
    )

    status = await get_switch_status("run-boom")
    assert status.status == "error"
    assert "unexpected" in status.detail.lower()
    history = await get_switch_history()
    assert history[0].outcome == "failure"
    assert await _lock_is_free()
    assert job_worker._claim_paused is False
    # _sync_or_mark_target_unsafe() catches ANY exception escaping
    # sync_node() — not just NodeSyncError — because truncate-then-restore
    # (§7.5) isn't transactional: a RuntimeError mid-sync is exactly as
    # capable of leaving "target" with corrupted data as a NodeSyncError
    # would be, so it must be demoted the same way.
    target = await get_node("target")
    assert target.status == "error"


# --------------------------------------------------------------------------- #
# pool_has_headroom (NEON_FAILOVER_PLAN.md §7.11/§9, Phase E)
# --------------------------------------------------------------------------- #


async def test_pool_has_headroom_true_before_bootstrap():
    # No active node registered at all — nothing to protect yet.
    assert await node_ops.pool_has_headroom() is True


async def test_pool_has_headroom_true_while_active_is_well_under_warmup_threshold():
    await register_node(_make_node("active"))
    await register_node(_make_node("reserve"))
    await set_active_node("active")
    await set_usage_cache("active", 0.05)
    await set_usage_cache(
        "reserve", 0.05
    )  # equally near-zero — must not read "degraded"

    assert await node_ops.pool_has_headroom() is True


async def test_pool_has_headroom_true_when_a_reserve_has_meaningfully_less_usage():
    await register_node(_make_node("active"))
    await register_node(_make_node("reserve"))
    await set_active_node("active")
    await set_usage_cache("active", 0.85)  # past the default 70% warm-up threshold
    await set_usage_cache("reserve", 0.1)

    assert await node_ops.pool_has_headroom() is True


async def test_pool_has_headroom_false_when_best_reserve_is_not_better_than_active():
    await register_node(_make_node("active"))
    await register_node(_make_node("reserve"))
    await set_active_node("active")
    await set_usage_cache("active", 0.85)
    await set_usage_cache("reserve", 0.9)  # even MORE used than the active node

    assert await node_ops.pool_has_headroom() is False


async def test_pool_has_headroom_false_when_no_reserve_exists():
    await register_node(_make_node("active"))
    await set_active_node("active")
    await set_usage_cache("active", 0.85)

    assert await node_ops.pool_has_headroom() is False


async def test_pool_has_headroom_ignores_a_retired_or_provisioning_reserve():
    await register_node(_make_node("active"))
    await register_node(_make_node("retired-reserve", status="retired"))
    await register_node(_make_node("provisioning-reserve", status="provisioning"))
    await set_active_node("active")
    await set_usage_cache("active", 0.85)
    await set_usage_cache("retired-reserve", 0.0)
    await set_usage_cache("provisioning-reserve", 0.0)

    assert await node_ops.pool_has_headroom() is False


async def test_all_nodes_low_pool_degrades_but_target_selection_still_engages():
    # §9/§12 "all-nodes-low": every node's cached usage is forced near the
    # cutover threshold. /pool-health must flip to degraded (no reserve has
    # MEANINGFULLY more headroom) — but select_switch_target(), the exact
    # mechanism both the proactive and reactive triggers dispatch through,
    # must still return the least-bad option rather than giving up. §9:
    # "the reactive trigger still falls back to whichever node has the
    # least-bad amount of room left... strictly better than no fallback."
    await register_node(_make_node("active"))
    await register_node(_make_node("least-bad-reserve"))
    await register_node(_make_node("worst-reserve"))
    await set_active_node("active")
    await set_usage_cache("active", 0.97)
    await set_usage_cache("least-bad-reserve", 0.95)
    await set_usage_cache("worst-reserve", 0.99)

    assert await node_ops.pool_has_headroom() is False
    target = await node_ops.select_switch_target(exclude_node_ids={"active"})
    assert target == "least-bad-reserve"


async def test_pool_has_headroom_reports_degraded_not_raised_on_redis_error(
    monkeypatch,
):
    # Regression guard (PR #158 review): get_usage_cache()/select_switch_target()
    # don't fail open on a Redis error the way get_active_node()/get_settings()
    # do, so pool_has_headroom() must catch it itself — this is what the public,
    # unauthenticated /pool-health route relies on to report {"status":
    # "degraded"} instead of a bare 500 on a transient Redis blip.
    await register_node(_make_node("active"))
    await set_active_node("active")  # fresh in-process cache — no redis.get needed

    async def boom(*_args, **_kwargs):
        raise ConnectionError("redis down")

    monkeypatch.setattr(redis_client, "get", boom)

    assert await node_ops.pool_has_headroom() is False


# --------------------------------------------------------------------------- #
# run_warmup_sync (NEON_FAILOVER_PLAN.md §7.4, Phase E)
# --------------------------------------------------------------------------- #


async def test_run_warmup_sync_success(monkeypatch):
    await register_node(_make_node("source"))
    await register_node(_make_node("target"))
    await set_active_node("source")

    calls = []

    async def fake_sync(source, target):
        calls.append((source, target))

    monkeypatch.setattr(node_ops.node_sync, "sync_node", fake_sync)

    result = await node_ops.run_warmup_sync("source", "target")

    assert result is True
    assert calls == [("source", "target")]
    target = await get_node("target")
    assert target.status == "ready"  # unchanged on success
    assert await _lock_is_free()


async def test_run_warmup_sync_failure_marks_target_error_but_does_not_raise(
    monkeypatch,
):
    await register_node(_make_node("source"))
    await register_node(_make_node("target"))
    await set_active_node("source")

    async def fake_sync(source, target):
        raise node_sync.NodeSyncError("connection refused")

    monkeypatch.setattr(node_ops.node_sync, "sync_node", fake_sync)

    result = await node_ops.run_warmup_sync("source", "target")

    assert result is True  # ran to completion, even though the sync itself failed
    target = await get_node("target")
    assert target.status == "error"
    assert await _lock_is_free()


async def test_run_warmup_sync_unexpected_error_also_marks_target_error(monkeypatch):
    # sync_or_mark_target_unsafe() catches ANY exception escaping sync_node()
    # — not just NodeSyncError — since truncate-then-restore (§7.5) isn't
    # transactional. run_warmup_sync()'s own except must be equally broad,
    # not narrowed to NodeSyncError, or a non-NodeSyncError failure would
    # both leave the target wrongly marked "error" from the inner helper AND
    # propagate out of run_warmup_sync() itself, breaking its "never raises"
    # contract (mirrors test_execute_switch_unexpected_error_still_releases_
    # lock_and_resumes's same reasoning for execute_switch).
    await register_node(_make_node("source"))
    await register_node(_make_node("target"))
    await set_active_node("source")

    async def boom(source, target):
        raise RuntimeError("something truly unexpected")

    monkeypatch.setattr(node_ops.node_sync, "sync_node", boom)

    result = await node_ops.run_warmup_sync("source", "target")

    assert result is True
    target = await get_node("target")
    assert target.status == "error"
    assert await _lock_is_free()


async def test_run_warmup_sync_skipped_when_pool_lock_already_held(monkeypatch):
    await register_node(_make_node("source"))
    await register_node(_make_node("target"))
    await set_active_node("source")

    calls = []

    async def fake_sync(source, target):
        calls.append((source, target))

    monkeypatch.setattr(node_ops.node_sync, "sync_node", fake_sync)

    token = await nr.acquire_pool_lock("some-other-operation")
    assert token is not None
    try:
        result = await node_ops.run_warmup_sync("source", "target")
    finally:
        await nr.release_pool_lock(token)

    assert result is False
    assert calls == []  # never even attempted the sync
    target = await get_node("target")
    assert target.status == "ready"  # untouched


# --------------------------------------------------------------------------- #
# execute_provision — success and every documented failure mode (§7.8/§12)
# --------------------------------------------------------------------------- #


async def test_execute_provision_success(monkeypatch):
    await register_node(_make_node("source", status="ready"))
    await set_active_node("source")
    await register_node(
        _make_node("new-node", neon_project_id="proj-new", status="provisioning")
    )

    monkeypatch.setattr(node_ops, "_check_connectivity", _noop_connectivity)
    sync_calls = []

    async def fake_sync(source, target):
        sync_calls.append((source, target))

    monkeypatch.setattr(node_ops.node_sync, "sync_node", fake_sync)
    verify_calls = []

    async def fake_verify(project_id):
        verify_calls.append(project_id)

    monkeypatch.setattr(neon_api, "verify_project_visible", fake_verify)

    await node_ops.execute_provision(run_id="run-p-ok", node_id="new-node")

    node = await get_node("new-node")
    assert node.status == "ready"
    status = await get_switch_status("run-p-ok")
    assert status.status == "done"
    assert sync_calls == [("source", "new-node")]
    assert verify_calls == ["proj-new"]
    assert await _lock_is_free()


async def test_execute_provision_bad_connection_string_marks_error(monkeypatch):
    await register_node(_make_node("source", status="ready"))
    await set_active_node("source")
    await register_node(_make_node("new-node", status="provisioning"))

    async def bad_connectivity(node):
        raise node_sync.NodeSyncError("could not connect to the new node: bad host")

    monkeypatch.setattr(node_ops, "_check_connectivity", bad_connectivity)

    await node_ops.execute_provision(run_id="run-p-conn", node_id="new-node")

    node = await get_node("new-node")
    assert node.status == "error"
    status = await get_switch_status("run-p-conn")
    assert status.status == "error"
    assert "connect" in status.detail.lower()
    assert await _lock_is_free()


async def test_execute_provision_migration_failure_marks_error(monkeypatch):
    await register_node(_make_node("source", status="ready"))
    await set_active_node("source")
    await register_node(_make_node("new-node", status="provisioning"))

    monkeypatch.setattr(node_ops, "_check_connectivity", _noop_connectivity)

    async def failing_sync(source, target):
        raise node_sync.NodeSyncError("migration against target failed (exit 1)")

    monkeypatch.setattr(node_ops.node_sync, "sync_node", failing_sync)

    await node_ops.execute_provision(run_id="run-p-mig", node_id="new-node")

    node = await get_node("new-node")
    assert node.status == "error"
    status = await get_switch_status("run-p-mig")
    assert status.status == "error"
    assert "migration" in status.detail.lower()
    assert await _lock_is_free()


async def test_execute_provision_wrong_project_id_marks_error(monkeypatch):
    await register_node(_make_node("source", status="ready"))
    await set_active_node("source")
    await register_node(
        _make_node("new-node", neon_project_id="typo-id", status="provisioning")
    )

    monkeypatch.setattr(node_ops, "_check_connectivity", _noop_connectivity)

    async def fake_sync(source, target):
        pass

    monkeypatch.setattr(node_ops.node_sync, "sync_node", fake_sync)

    async def fake_verify(project_id):
        raise neon_api.NeonApiError(
            f"Neon API returned 404 for project {project_id!r}."
        )

    monkeypatch.setattr(neon_api, "verify_project_visible", fake_verify)

    await node_ops.execute_provision(run_id="run-p-wrongid", node_id="new-node")

    node = await get_node("new-node")
    assert node.status == "error"
    status = await get_switch_status("run-p-wrongid")
    assert status.status == "error"
    assert "404" in status.detail
    assert await _lock_is_free()


async def test_execute_provision_success_does_not_clobber_a_concurrent_retire(
    monkeypatch,
):
    # §7.8 doesn't forbid retiring a still-`provisioning` node (a reasonable
    # way to cancel one) — if an admin does that mid-flight via the retire
    # route (a completely separate code path), this operation's own eventual
    # success must not silently flip it back to `ready`.
    await register_node(_make_node("source", status="ready"))
    await set_active_node("source")
    await register_node(_make_node("new-node", status="provisioning"))

    monkeypatch.setattr(node_ops, "_check_connectivity", _noop_connectivity)

    async def fake_sync(source, target):
        # Simulate the admin's retire happening while this sync is "in
        # flight" — a completely independent write to the same node_id.
        node = await get_node("new-node")
        await register_node(node.model_copy(update={"status": "retired"}))

    monkeypatch.setattr(node_ops.node_sync, "sync_node", fake_sync)

    async def fake_verify(project_id):
        pass

    monkeypatch.setattr(neon_api, "verify_project_visible", fake_verify)

    await node_ops.execute_provision(run_id="run-p-retire-race", node_id="new-node")

    node = await get_node("new-node")
    assert node.status == "retired"  # NOT clobbered back to "ready"
    # The operation's OWN run status still reflects what it actually did —
    # the admin's separate retire decision doesn't retroactively make the
    # connectivity/sync/verify sequence itself a failure.
    status = await get_switch_status("run-p-retire-race")
    assert status.status == "done"
    assert await _lock_is_free()


async def test_execute_provision_lock_rejected_does_not_clobber_a_later_winner(
    monkeypatch,
):
    # A narrower, opposite-direction race: two provisioning attempts for the
    # SAME node_id (e.g. two overlapping "Retry" clicks). The loser's
    # immediate lock-rejection marks the node "error" well before the
    # winner's real work finishes — that must NOT be treated the same as an
    # admin's deliberate retire, or the winner's later legitimate "ready"
    # would be silently discarded.
    await register_node(_make_node("source", status="ready"))
    await set_active_node("source")
    await register_node(_make_node("new-node", status="provisioning"))

    # Simulate the loser having already been rejected (§7.4's concurrency
    # guard) and marked "error" before the winner (this call) even starts.
    await node_ops._mark_node_status("new-node", "error")
    assert (await get_node("new-node")).status == "error"

    monkeypatch.setattr(node_ops, "_check_connectivity", _noop_connectivity)

    async def fake_sync(source, target):
        pass

    monkeypatch.setattr(node_ops.node_sync, "sync_node", fake_sync)

    async def fake_verify(project_id):
        pass

    monkeypatch.setattr(neon_api, "verify_project_visible", fake_verify)

    await node_ops.execute_provision(run_id="run-p-winner", node_id="new-node")

    node = await get_node("new-node")
    assert node.status == "ready"  # the winner's real success is NOT discarded
    status = await get_switch_status("run-p-winner")
    assert status.status == "done"
    assert await _lock_is_free()


# --------------------------------------------------------------------------- #
# Concurrency (§7.4/§12) — real lock contention against the real test Redis
# --------------------------------------------------------------------------- #


async def test_concurrent_switch_attempts_only_one_proceeds(monkeypatch):
    await register_node(_make_node("source"))
    await register_node(_make_node("target-a"))
    await register_node(_make_node("target-b"))
    await set_active_node("source")

    async def fake_sync(source, target):
        pass

    monkeypatch.setattr(node_ops.node_sync, "sync_node", fake_sync)

    await asyncio.gather(
        node_ops.execute_switch(
            run_id="run-conc-a", target_node_id="target-a", trigger="manual"
        ),
        node_ops.execute_switch(
            run_id="run-conc-b", target_node_id="target-b", trigger="manual"
        ),
    )

    status_a = await get_switch_status("run-conc-a")
    status_b = await get_switch_status("run-conc-b")
    outcomes = sorted([status_a.status, status_b.status])
    assert outcomes == ["done", "error"]
    assert await _lock_is_free()


async def test_concurrent_provisioning_and_switch_only_one_proceeds(monkeypatch):
    await register_node(_make_node("source", status="ready"))
    await register_node(_make_node("target", status="ready"))
    await register_node(_make_node("new-node", status="provisioning"))
    await set_active_node("source")

    monkeypatch.setattr(node_ops, "_check_connectivity", _noop_connectivity)

    async def fake_sync(source, target):
        pass

    monkeypatch.setattr(node_ops.node_sync, "sync_node", fake_sync)

    async def fake_verify(project_id):
        pass

    monkeypatch.setattr(neon_api, "verify_project_visible", fake_verify)

    await asyncio.gather(
        node_ops.execute_switch(
            run_id="run-conc-s", target_node_id="target", trigger="manual"
        ),
        node_ops.execute_provision(run_id="run-conc-p", node_id="new-node"),
    )

    status_s = await get_switch_status("run-conc-s")
    status_p = await get_switch_status("run-conc-p")
    outcomes = sorted([status_s.status, status_p.status])
    assert outcomes == ["done", "error"]
    assert await _lock_is_free()


async def test_concurrent_duplicate_project_id_provisioning_never_both_ready(
    monkeypatch,
):
    # admin_nodes.py's duplicate-neon_project_id check (§7.1/§7.8 step 1) has
    # its own TOCTOU window at the router level (two concurrent POSTs could
    # both pass the pre-check before either registers) — this confirms the
    # pool-operation lock is what actually protects the invariant that
    # matters: two node_ids for the SAME underlying Neon project can never
    # BOTH end up "ready" (which would double-count that project's usage,
    # §7.1's stated concern). The router-level race can still leave a
    # harmless extra "error" row for the same project — a cosmetic
    # duplicate, not a data-integrity issue.
    await register_node(_make_node("source", status="ready"))
    await set_active_node("source")
    await register_node(
        _make_node("node-a", neon_project_id="shared-proj", status="provisioning")
    )
    await register_node(
        _make_node("node-b", neon_project_id="shared-proj", status="provisioning")
    )

    monkeypatch.setattr(node_ops, "_check_connectivity", _noop_connectivity)

    async def fake_sync(source, target):
        pass

    monkeypatch.setattr(node_ops.node_sync, "sync_node", fake_sync)

    async def fake_verify(project_id):
        pass

    monkeypatch.setattr(neon_api, "verify_project_visible", fake_verify)

    await asyncio.gather(
        node_ops.execute_provision(run_id="run-dup-a", node_id="node-a"),
        node_ops.execute_provision(run_id="run-dup-b", node_id="node-b"),
    )

    node_a = await get_node("node-a")
    node_b = await get_node("node-b")
    statuses = sorted([node_a.status, node_b.status])
    assert statuses == ["error", "ready"]  # never both "ready"
    assert await _lock_is_free()


# --------------------------------------------------------------------------- #
# job_worker.py wake-loop dispatch (§7.13)
# --------------------------------------------------------------------------- #


async def test_dispatch_wake_task_fires_execute_switch_as_background_task(monkeypatch):
    calls = []

    async def fake_execute_switch(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(node_ops, "execute_switch", fake_execute_switch)

    raw = node_ops.build_switch_task(run_id="r1", target_node_id="t1", trigger="manual")
    job_worker._dispatch_wake_task(raw)

    # Fired as a background task, not awaited inline — give the loop a tick.
    await asyncio.sleep(0)
    assert calls == [{"run_id": "r1", "target_node_id": "t1", "trigger": "manual"}]


async def test_dispatch_wake_task_fires_execute_provision_as_background_task(
    monkeypatch,
):
    calls = []

    async def fake_execute_provision(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(node_ops, "execute_provision", fake_execute_provision)

    raw = node_ops.build_provision_task(run_id="r2", node_id="n1")
    job_worker._dispatch_wake_task(raw)

    await asyncio.sleep(0)
    assert calls == [{"run_id": "r2", "node_id": "n1"}]


def test_dispatch_wake_task_is_a_noop_for_legacy_bare_job_id_string():
    before = len(job_worker._background_tasks)
    job_worker._dispatch_wake_task("550e8400-e29b-41d4-a716-446655440000")
    assert len(job_worker._background_tasks) == before


def test_dispatch_wake_task_drops_a_recognized_task_type_with_malformed_kwargs():
    """A recognized task-type whose payload doesn't match its executor's
    keyword-only signature (a missing field — future schema drift, or a
    hand-edited Redis entry) must be dropped, not crash the wake loop:
    parse_wake_task() is only responsible for shape ("is this JSON with a
    known task-type"), not for validating the fields underneath it, so
    _dispatch_wake_task() itself is where that has to be caught.

    Deliberately does NOT monkeypatch execute_switch: a fake with a
    permissive ``**kwargs`` signature would silently accept the malformed
    payload and defeat the exact thing under test — the REAL
    execute_switch(*, run_id, target_node_id, trigger)'s keyword-only
    signature is what must reject this call.
    """
    import json

    # Well-formed JSON, a recognized task-type, but missing the
    # target_node_id/trigger fields execute_switch(**kwargs) requires.
    raw = json.dumps({"task-type": node_ops.TASK_TYPE_SWITCH, "run_id": "r1"})
    before = len(job_worker._background_tasks)

    job_worker._dispatch_wake_task(raw)  # must not raise

    assert len(job_worker._background_tasks) == before
