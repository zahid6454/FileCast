"""Integration — data/job_worker.py's claim/run/finish logic, startup orphan
recovery, and the periodic GC sweep, all as plain function calls (no real
Redis loop needed — mirrors data/tasks.py's own testing shape, per
STRESS_TEST_PHASE3_PLAN.md's test-impact note).
"""

import asyncio
import time
from datetime import UTC, datetime, timedelta

import converter
import pytest
from data import job_worker, neon_api, node_ops
from data.models import ConversionJob
from data.node_registry import (
    Node,
    get_usage_cache,
    record_activity,
    register_node,
    set_active_node,
    set_usage_cache,
)
from data.redis_client import redis_client
from validation import ALLOWED_EXTENSIONS


@pytest.fixture(autouse=True)
def _reset_claim_pause():
    """job_worker._claim_paused (§7.7, Phase C) is a bare module-level
    global, not reset by anything in conftest.py — without this, one test
    calling pause_claiming() and not cleaning up would silently break every
    later test in the suite that expects claiming to work normally."""
    job_worker.resume_claiming()
    yield
    job_worker.resume_claiming()


async def test_redis_client_does_not_cut_off_a_legitimate_brpop_block():
    # Regression guard for a real bug introduced (and caught by live Docker
    # verification, not by this suite) while fixing the Phase 3 stress
    # test's Finding 4: a blanket socket_timeout=1 on the shared redis_client
    # made data/job_worker.py's loop log "Redis BRPOP failed" continuously,
    # even with Redis perfectly healthy, because BRPOP legitimately blocks
    # waiting for a job for up to BRPOP_TIMEOUT_SECONDS (5s) and a 1s
    # client-side socket_timeout fired on every idle wait. redis_client must
    # only bound the connect phase (socket_connect_timeout) — never pair it
    # with a blanket socket_timeout shorter than a real blocking command's
    # own timeout.
    block_seconds = 2  # > REDIS_CALL_TIMEOUT_SECONDS (1s) — proves no premature cutoff
    key = "test:brpop-timeout-guard"
    await redis_client.delete(key)

    start = time.monotonic()
    result = await redis_client.brpop(key, timeout=block_seconds)
    elapsed = time.monotonic() - start

    assert result is None  # nothing ever pushed — a real, full-length block
    assert elapsed >= block_seconds - 0.5


def _make_job(tool_id="docx-to-pdf", status="queued", **kw):
    return ConversionJob(
        tool_id=tool_id, status=status, original_filename="report.docx", **kw
    )


async def test_run_job_claims_runs_and_marks_done(db, monkeypatch):
    async def fake_libreoffice(content, filename, extra_form=None):
        return b"%PDF-1.4 ok"

    monkeypatch.setattr(converter, "_convert_libreoffice", fake_libreoffice)

    job = _make_job()
    db.add(job)
    await db.flush()
    job_id = job.id
    await db.commit()
    (converter.JOB_RESULTS_DIR / f"{job_id}.input").write_bytes(b"PK\x03\x04fake docx")

    await job_worker.run_job(job_id)

    await db.refresh(job)
    assert job.status == "done"
    assert job.attempts == 1
    assert job.started_at is not None
    assert job.finished_at is not None
    assert job.output_filename == "report.pdf"
    output_path = converter.JOB_RESULTS_DIR / f"{job_id}.output"
    assert output_path.read_bytes() == b"%PDF-1.4 ok"
    output_path.unlink()
    (converter.JOB_RESULTS_DIR / f"{job_id}.input").unlink()


async def test_run_job_resolves_sessions_through_the_dynamic_accessor(db, monkeypatch):
    """NEON_FAILOVER_PLAN.md §7.2: job_worker.py is called out as "the
    largest and easiest-to-miss gap" in the whole plan — a miss here means
    conversions silently keep writing to an abandoned node after every
    switch, forever, with no visible error. A passing functional test alone
    wouldn't catch a regression back to importing `async_session_factory`
    directly (this test environment has only one real Postgres, so the
    wrong code path would still happen to reach it) — so this spies on
    get_active_session_factory() to confirm run_job()'s full claim-execute
    flow actually goes through it, touching three of the six call sites
    (run_job's own claim, _execute_job's read session, _execute_job's write
    session) in one pass.
    """

    async def fake_libreoffice(content, filename, extra_form=None):
        return b"%PDF-1.4 ok"

    monkeypatch.setattr(converter, "_convert_libreoffice", fake_libreoffice)

    call_count = 0
    original_accessor = job_worker.get_active_session_factory

    async def _counting_accessor():
        nonlocal call_count
        call_count += 1
        return await original_accessor()

    # Regression guard: a revert to importing `async_session_factory`
    # directly would make this attribute not exist on `job_worker` at all,
    # failing this monkeypatch.setattr call outright.
    monkeypatch.setattr(job_worker, "get_active_session_factory", _counting_accessor)

    job = _make_job()
    db.add(job)
    await db.flush()
    job_id = job.id
    await db.commit()
    (converter.JOB_RESULTS_DIR / f"{job_id}.input").write_bytes(b"PK\x03\x04fake docx")

    await job_worker.run_job(job_id)

    await db.refresh(job)
    assert job.status == "done"
    assert call_count == 3
    output_path = converter.JOB_RESULTS_DIR / f"{job_id}.output"
    output_path.unlink()
    (converter.JOB_RESULTS_DIR / f"{job_id}.input").unlink()


async def test_run_job_marks_failed_on_conversion_exception(db, monkeypatch):
    async def boom(content, filename, extra_form=None):
        raise RuntimeError("boom")

    monkeypatch.setattr(converter, "_convert_libreoffice", boom)

    job = _make_job()
    db.add(job)
    await db.flush()
    job_id = job.id
    await db.commit()
    (converter.JOB_RESULTS_DIR / f"{job_id}.input").write_bytes(b"PK\x03\x04fake docx")

    await job_worker.run_job(job_id)

    await db.refresh(job)
    assert job.status == "failed"
    assert job.error_type == "conversion_error"
    assert job.finished_at is not None
    (converter.JOB_RESULTS_DIR / f"{job_id}.input").unlink()


async def test_execute_job_does_not_clobber_a_row_gc_swept_out_from_under_it(
    db, monkeypatch
):
    # _execute_job reads its job's inputs in one short session, runs the
    # conversion with no session held, then writes the terminal state in a
    # second session — guarded on the row still being 'converting'. If the
    # periodic GC sweep already force-failed this row as stuck (because the
    # conversion ran long), a late-arriving success must not silently
    # overwrite that resolution.
    async def fake_libreoffice(content, filename, extra_form=None):
        return b"%PDF-1.4 ok"

    monkeypatch.setattr(converter, "_convert_libreoffice", fake_libreoffice)

    job = _make_job(status="converting", started_at=datetime.now(UTC))
    db.add(job)
    await db.flush()
    job_id = job.id
    await db.commit()
    (converter.JOB_RESULTS_DIR / f"{job_id}.input").write_bytes(b"PK\x03\x04fake docx")

    # Simulate gc_sweep resolving this row as stuck while the (mocked, but
    # otherwise unbounded) conversion is still "running".
    job.status = "failed"
    job.error_type = "queue_timeout"
    job.error_message = (
        "The conversion service is busy right now. Please try again in a moment."
    )
    await db.commit()

    await job_worker._execute_job(job_id)

    await db.refresh(job)
    assert job.status == "failed"
    assert job.error_type == "queue_timeout"
    assert job.output_filename is None
    (converter.JOB_RESULTS_DIR / f"{job_id}.input").unlink()


async def test_run_job_is_a_noop_for_an_already_claimed_job(db):
    # A job already `converting` (claimed by a prior/concurrent call) must
    # not be re-run — the atomic claim UPDATE's WHERE status='queued' guards
    # exactly this.
    job = _make_job(status="converting")
    db.add(job)
    await db.flush()
    job_id = job.id
    await db.commit()

    await job_worker.run_job(job_id)  # should return early, no crash

    await db.refresh(job)
    assert job.status == "converting"  # untouched


async def test_claim_all_queued_claims_every_queued_row_atomically(db):
    # The worker's discovery loop claims ALL queued rows on every wake (not
    # one), relying on the existing Gotenberg/Ghostscript semaphores to bound
    # real concurrency — this proves the bulk claim itself: every queued row
    # gets marked `converting` (attempts incremented) in one round trip, not
    # just the first one found.
    from data.db import async_session_factory

    jobs = [_make_job() for _ in range(3)]
    db.add_all(jobs)
    await db.flush()
    job_ids = {j.id for j in jobs}
    await db.commit()

    async with async_session_factory() as claim_db:
        claimed_ids = set(await job_worker._claim_all_queued(claim_db))

    assert claimed_ids == job_ids
    for job_id in job_ids:
        job = await db.get(ConversionJob, job_id)
        await db.refresh(job)
        assert job.status == "converting"
        assert job.attempts == 1


# --------------------------------------------------------------------------- #
# In-flight job draining (NEON_FAILOVER_PLAN.md §7.7, Phase C) — inert:
# nothing calls any of this yet, but it must behave correctly in isolation
# for a later phase's cutover orchestration to build on.
# --------------------------------------------------------------------------- #


async def test_pause_claiming_stops_claim_all_queued(db):
    job_worker.pause_claiming()

    job = _make_job()
    db.add(job)
    await db.flush()
    await db.commit()

    from data.db import async_session_factory

    async with async_session_factory() as claim_db:
        claimed = await job_worker._claim_all_queued(claim_db)
    assert claimed == []

    await db.refresh(job)
    assert job.status == "queued"  # untouched — never claimed


async def test_pause_claiming_stops_claim_one():
    job_worker.pause_claiming()
    assert await job_worker._claim_one(object(), "irrelevant-job-id") is False


async def test_resume_claiming_lets_claim_all_queued_proceed_again(db):
    job_worker.pause_claiming()
    job_worker.resume_claiming()

    job = _make_job()
    db.add(job)
    await db.flush()
    job_id = job.id
    await db.commit()

    from data.db import async_session_factory

    async with async_session_factory() as claim_db:
        claimed = await job_worker._claim_all_queued(claim_db)
    assert claimed == [job_id]


async def test_resume_claiming_lets_claim_one_proceed_again(db):
    job_worker.pause_claiming()
    job_worker.resume_claiming()

    job = _make_job()
    db.add(job)
    await db.flush()
    job_id = job.id
    await db.commit()

    from data.db import async_session_factory

    async with async_session_factory() as claim_db:
        claimed = await job_worker._claim_one(claim_db, job_id)
    assert claimed is True

    await db.refresh(job)
    assert job.status == "converting"


async def test_drain_in_flight_jobs_pauses_claiming():
    assert job_worker._claim_paused is False
    await job_worker.drain_in_flight_jobs(timeout_seconds=5)
    assert job_worker._claim_paused is True


async def test_drain_in_flight_jobs_returns_true_immediately_when_nothing_converting():
    result = await job_worker.drain_in_flight_jobs(timeout_seconds=5)
    assert result is True


async def test_drain_in_flight_jobs_waits_for_converting_rows_to_clear(db):
    job = _make_job(status="converting", started_at=datetime.now(UTC))
    db.add(job)
    await db.flush()
    job_id = job.id
    await db.commit()

    async def _finish_soon():
        await asyncio.sleep(0.2)
        from data.db import async_session_factory

        async with async_session_factory() as finish_db:
            finish_job = await finish_db.get(ConversionJob, job_id)
            finish_job.status = "done"
            finish_job.finished_at = datetime.now(UTC)
            await finish_db.commit()

    finisher = asyncio.create_task(_finish_soon())
    try:
        result = await job_worker.drain_in_flight_jobs(
            timeout_seconds=5, poll_interval_seconds=0.05
        )
        assert result is True
    finally:
        await finisher


async def test_drain_in_flight_jobs_times_out_with_jobs_still_converting(db):
    job = _make_job(status="converting", started_at=datetime.now(UTC))
    db.add(job)
    await db.flush()
    await db.commit()

    result = await job_worker.drain_in_flight_jobs(
        timeout_seconds=0.2, poll_interval_seconds=0.05
    )
    assert result is False


def test_drain_timeout_uses_the_queue_timeout_trio_not_stuck_job_age():
    # Regression guard for exactly the mixup the plan warns against:
    # DRAIN_TIMEOUT_SECONDS must be built from converter.py's
    # *_QUEUE_TIMEOUT_SECONDS trio, never STUCK_JOB_MAX_AGE_SECONDS (a
    # different, ~9x-larger constant for an unrelated purpose — see both
    # constants' own comments).
    assert job_worker.DRAIN_TIMEOUT_SECONDS == max(
        converter.GOTENBERG_QUEUE_TIMEOUT_SECONDS,
        converter.GHOSTSCRIPT_QUEUE_TIMEOUT_SECONDS,
        converter.CPU_BOUND_QUEUE_TIMEOUT_SECONDS,
    )
    assert job_worker.DRAIN_TIMEOUT_SECONDS != job_worker.STUCK_JOB_MAX_AGE_SECONDS


async def test_recover_orphaned_jobs_requeues_under_the_attempts_cap(db):
    job = _make_job(status="converting", attempts=1, started_at=datetime.now(UTC))
    db.add(job)
    await db.flush()
    job_id = job.id
    await db.commit()

    result = await job_worker.recover_orphaned_jobs()
    assert result == {"requeued": 1, "dead_lettered": 0}

    job = await db.get(ConversionJob, job_id)
    await db.refresh(job)
    assert job.status == "queued"
    assert job.started_at is None


async def test_recover_orphaned_jobs_dead_letters_past_the_attempts_cap(db):
    job = _make_job(
        status="converting",
        attempts=job_worker.MAX_ATTEMPTS,
        started_at=datetime.now(UTC),
    )
    db.add(job)
    await db.flush()
    job_id = job.id
    await db.commit()

    result = await job_worker.recover_orphaned_jobs()
    assert result == {"requeued": 0, "dead_lettered": 1}

    job = await db.get(ConversionJob, job_id)
    await db.refresh(job)
    assert job.status == "failed"
    assert job.error_type == "conversion_error"
    assert job.finished_at is not None


async def test_gc_sweep_force_fails_pathologically_old_queued_and_converting_rows(db):
    too_old = datetime.now(UTC) - timedelta(
        seconds=job_worker.STUCK_JOB_MAX_AGE_SECONDS + 60
    )
    recent = datetime.now(UTC)
    stuck_queued = _make_job(status="queued", created_at=too_old)
    stuck_converting = _make_job(status="converting", created_at=too_old)
    fresh_queued = _make_job(status="queued", created_at=recent)
    db.add_all([stuck_queued, stuck_converting, fresh_queued])
    await db.flush()
    ids = {
        "stuck_queued": stuck_queued.id,
        "stuck_converting": stuck_converting.id,
        "fresh_queued": fresh_queued.id,
    }
    await db.commit()

    result = await job_worker.gc_sweep()
    assert result["stuck_failed"] == 2

    for key in ("stuck_queued", "stuck_converting"):
        job = await db.get(ConversionJob, ids[key])
        await db.refresh(job)
        assert job.status == "failed"
        assert job.error_type == "queue_timeout"

    fresh = await db.get(ConversionJob, ids["fresh_queued"])
    await db.refresh(fresh)
    assert fresh.status == "queued"  # untouched — nowhere near the age ceiling


async def test_gc_sweep_deletes_files_for_finished_jobs_past_the_grace_period(db):
    too_old_finish = datetime.now(UTC) - timedelta(
        seconds=job_worker.FINISHED_JOB_FILE_GRACE_SECONDS + 30
    )
    old_done = _make_job(status="done", finished_at=too_old_finish)
    recent_done = _make_job(status="done", finished_at=datetime.now(UTC))
    db.add_all([old_done, recent_done])
    await db.flush()
    old_id, recent_id = old_done.id, recent_done.id
    await db.commit()

    for job_id in (old_id, recent_id):
        (converter.JOB_RESULTS_DIR / f"{job_id}.input").write_bytes(b"x")
        (converter.JOB_RESULTS_DIR / f"{job_id}.output").write_bytes(b"y")

    result = await job_worker.gc_sweep()
    assert result["files_cleaned"] == 2  # old_done's .input + .output

    assert not (converter.JOB_RESULTS_DIR / f"{old_id}.input").exists()
    assert not (converter.JOB_RESULTS_DIR / f"{old_id}.output").exists()
    assert (converter.JOB_RESULTS_DIR / f"{recent_id}.input").exists()
    assert (converter.JOB_RESULTS_DIR / f"{recent_id}.output").exists()
    (converter.JOB_RESULTS_DIR / f"{recent_id}.input").unlink()
    (converter.JOB_RESULTS_DIR / f"{recent_id}.output").unlink()


@pytest.mark.parametrize(
    "exc,expected_error_type",
    [
        (converter.ValidationError("bad file", "invalid_file"), "invalid_file"),
        (converter.ConversionQueueTimeout("busy"), "queue_timeout"),
        (RuntimeError("anything else"), "conversion_error"),
    ],
)
def test_classify_conversion_error_maps_known_exception_types(exc, expected_error_type):
    _, error_type = converter._classify_conversion_error(exc)
    assert error_type == expected_error_type


def test_tool_registry_covers_every_tool_validation_knows_about():
    # Every tool_id validation.py's ALLOWED_EXTENSIONS recognizes must have a
    # matching TOOL_REGISTRY entry (Phase 3) — otherwise an enqueued job for
    # that tool would 500 in the worker with "Unknown tool_id" the moment it
    # got claimed, having already told the visitor 202.
    assert set(ALLOWED_EXTENSIONS) == set(converter.TOOL_REGISTRY)


# --------------------------------------------------------------------------- #
# Usage polling + proactive trigger (NEON_FAILOVER_PLAN.md §7.3/§7.4, Phase E)
# --------------------------------------------------------------------------- #


def _make_node(node_id: str, *, status="ready") -> Node:
    return Node(
        node_id=node_id,
        display_name=f"Node {node_id}",
        connection_string=f"postgresql://user:pw@ep-{node_id}.neon.tech/filecast",
        neon_project_id=f"proj-{node_id}",
        status=status,
        created_at="2026-01-01T00:00:00+00:00",
    )


@pytest.fixture(autouse=True)
def _reset_node_state(monkeypatch):
    """Same reasoning as test_node_ops.py's own fixture: the active-node
    fallback cache lives outside Redis on purpose (§7.1), so it must be
    reset for every test in this file that touches it."""
    import data.node_registry as nr

    monkeypatch.setattr(nr, "_cached_active_node_id", None)
    monkeypatch.setattr(nr, "_cached_active_node_at", 0.0)


async def test_poll_all_node_usage_updates_cache_and_survives_a_single_failed_poll(
    monkeypatch,
):
    await register_node(_make_node("healthy"))
    await register_node(_make_node("flaky"))
    await set_usage_cache("flaky", 0.42)  # pre-existing cached value

    async def fake_get_usage(project_id):
        if project_id == "proj-flaky":
            raise neon_api.NeonApiError("Neon API blip")
        return 0.6

    monkeypatch.setattr(neon_api, "get_project_usage", fake_get_usage)

    await job_worker._poll_all_node_usage()

    healthy_usage = await get_usage_cache("healthy")
    assert healthy_usage.ratio == 0.6
    # A single failed poll must NOT clear or otherwise touch the last cached
    # value — §7.3's "never let a usage-API blip masquerade as a
    # database-down event."
    flaky_usage = await get_usage_cache("flaky")
    assert flaky_usage.ratio == 0.42


async def test_maybe_trigger_proactive_action_does_nothing_below_thresholds():
    await register_node(_make_node("active"))
    await register_node(_make_node("reserve"))
    await set_active_node("active")
    await set_usage_cache("active", 0.5)  # below the default 70% warm-up threshold
    node_settings = await job_worker.get_settings()

    await job_worker._maybe_trigger_proactive_action(node_settings)

    await asyncio.sleep(0)
    assert len(job_worker._background_tasks) == 0


async def test_maybe_trigger_proactive_action_does_nothing_without_an_active_node():
    # Bootstrap hasn't run — get_active_node() raises NoActiveNodeError; the
    # poll cycle must degrade quietly rather than crash the worker loop.
    node_settings = await job_worker.get_settings()
    await job_worker._maybe_trigger_proactive_action(node_settings)  # must not raise


async def test_maybe_trigger_proactive_action_fires_warmup_at_threshold(monkeypatch):
    await register_node(_make_node("active"))
    await register_node(_make_node("reserve"))
    await set_active_node("active")
    await set_usage_cache("active", 0.75)  # >= 70% warm-up, < 80% cutover

    calls = []

    async def fake_warmup(source, target):
        calls.append((source, target))

    monkeypatch.setattr(node_ops, "run_warmup_sync", fake_warmup)

    node_settings = await job_worker.get_settings()
    await job_worker._maybe_trigger_proactive_action(node_settings)
    await asyncio.sleep(0)

    assert calls == [("active", "reserve")]


async def test_maybe_trigger_proactive_action_skips_warmup_if_target_recently_synced(
    monkeypatch,
):
    await register_node(_make_node("active"))
    await register_node(_make_node("reserve"))
    await set_active_node("active")
    await set_usage_cache("active", 0.75)
    await record_activity("reserve", when=datetime.now(UTC))  # just synced

    calls = []

    async def fake_warmup(source, target):
        calls.append((source, target))

    monkeypatch.setattr(node_ops, "run_warmup_sync", fake_warmup)

    node_settings = await job_worker.get_settings()
    await job_worker._maybe_trigger_proactive_action(node_settings)
    await asyncio.sleep(0)

    assert calls == []  # redundant warm-up skipped — already fresh


async def test_maybe_trigger_proactive_action_fires_cutover_at_threshold(monkeypatch):
    await register_node(_make_node("active"))
    await register_node(_make_node("reserve"))
    await set_active_node("active")
    await set_usage_cache("active", 0.85)  # >= 80% cutover threshold

    calls = []

    async def fake_execute_switch(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(node_ops, "execute_switch", fake_execute_switch)

    node_settings = await job_worker.get_settings()
    await job_worker._maybe_trigger_proactive_action(node_settings)
    await asyncio.sleep(0)

    assert len(calls) == 1
    assert calls[0]["target_node_id"] == "reserve"
    assert calls[0]["trigger"] == "proactive"
    assert calls[0]["run_id"].startswith("proactive-")


async def test_maybe_trigger_proactive_action_cutover_takes_priority_over_warmup(
    monkeypatch,
):
    # Past both thresholds at once (e.g. a poll interval that missed the
    # warm-up band entirely) — only the cutover fires, not both.
    await register_node(_make_node("active"))
    await register_node(_make_node("reserve"))
    await set_active_node("active")
    await set_usage_cache("active", 0.95)

    switch_calls = []
    warmup_calls = []

    async def fake_execute_switch(**kwargs):
        switch_calls.append(kwargs)

    async def fake_warmup(source, target):
        warmup_calls.append((source, target))

    monkeypatch.setattr(node_ops, "execute_switch", fake_execute_switch)
    monkeypatch.setattr(node_ops, "run_warmup_sync", fake_warmup)

    node_settings = await job_worker.get_settings()
    await job_worker._maybe_trigger_proactive_action(node_settings)
    await asyncio.sleep(0)

    assert len(switch_calls) == 1
    assert warmup_calls == []


async def test_usage_poll_cycle_polls_then_evaluates_the_fresh_reading(monkeypatch):
    # End-to-end wiring: a fresh poll result that crosses the cutover
    # threshold must be visible to the SAME cycle's trigger evaluation, not
    # just the next one.
    await register_node(_make_node("active"))
    await register_node(_make_node("reserve"))
    await set_active_node("active")

    async def fake_get_usage(project_id):
        return 0.9 if project_id == "proj-active" else 0.0

    monkeypatch.setattr(neon_api, "get_project_usage", fake_get_usage)

    calls = []

    async def fake_execute_switch(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(node_ops, "execute_switch", fake_execute_switch)

    returned_settings = await job_worker.usage_poll_cycle()
    await asyncio.sleep(0)

    assert returned_settings.cutover_threshold_pct == 80
    assert len(calls) == 1
    assert calls[0]["target_node_id"] == "reserve"


# --------------------------------------------------------------------------- #
# Weekly keep-alive sync (NEON_FAILOVER_PLAN.md §7.9, Phase E)
# --------------------------------------------------------------------------- #


async def test_weekly_keepalive_sweep_syncs_a_reserve_never_synced_before(monkeypatch):
    await register_node(_make_node("active"))
    await register_node(_make_node("reserve"))
    await set_active_node("active")

    calls = []

    async def fake_warmup(source, target):
        calls.append((source, target))

    monkeypatch.setattr(node_ops, "run_warmup_sync", fake_warmup)

    await job_worker.weekly_keepalive_sweep()
    await asyncio.sleep(0)

    assert calls == [("active", "reserve")]


async def test_weekly_keepalive_sweep_skips_a_recently_synced_reserve(monkeypatch):
    await register_node(_make_node("active"))
    await register_node(_make_node("reserve"))
    await set_active_node("active")
    await record_activity("reserve", when=datetime.now(UTC))

    calls = []

    async def fake_warmup(source, target):
        calls.append((source, target))

    monkeypatch.setattr(node_ops, "run_warmup_sync", fake_warmup)

    await job_worker.weekly_keepalive_sweep()
    await asyncio.sleep(0)

    assert calls == []


async def test_weekly_keepalive_sweep_syncs_a_reserve_overdue_past_the_interval(
    monkeypatch,
):
    await register_node(_make_node("active"))
    await register_node(_make_node("reserve"))
    await set_active_node("active")
    stale = datetime.now(UTC) - timedelta(
        seconds=job_worker.KEEPALIVE_INTERVAL_SECONDS + 3600
    )
    await record_activity("reserve", when=stale)

    calls = []

    async def fake_warmup(source, target):
        calls.append((source, target))

    monkeypatch.setattr(node_ops, "run_warmup_sync", fake_warmup)

    await job_worker.weekly_keepalive_sweep()
    await asyncio.sleep(0)

    assert calls == [("active", "reserve")]


async def test_weekly_keepalive_sweep_never_targets_the_active_node_itself(
    monkeypatch,
):
    await register_node(_make_node("active"))
    await set_active_node("active")

    calls = []

    async def fake_warmup(source, target):
        calls.append((source, target))

    monkeypatch.setattr(node_ops, "run_warmup_sync", fake_warmup)

    await job_worker.weekly_keepalive_sweep()
    await asyncio.sleep(0)

    assert calls == []


async def test_weekly_keepalive_sweep_ignores_non_ready_reserves(monkeypatch):
    await register_node(_make_node("active"))
    await register_node(_make_node("retired-reserve", status="retired"))
    await register_node(_make_node("error-reserve", status="error"))
    await register_node(_make_node("provisioning-reserve", status="provisioning"))
    await set_active_node("active")

    calls = []

    async def fake_warmup(source, target):
        calls.append((source, target))

    monkeypatch.setattr(node_ops, "run_warmup_sync", fake_warmup)

    await job_worker.weekly_keepalive_sweep()
    await asyncio.sleep(0)

    assert calls == []


async def test_weekly_keepalive_sweep_does_nothing_without_an_active_node():
    # Bootstrap hasn't run — must not raise.
    await job_worker.weekly_keepalive_sweep()
