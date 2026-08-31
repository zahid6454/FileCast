"""Async conversion job worker (Phase 3 Part A —
STRESS_TEST_PHASE3_PLAN.md).

Discovers ``ConversionJob`` rows queued by ``converter.py``'s enqueue routes
and runs them through the same tool functions those routes used to call
inline before this phase (``TOOL_REGISTRY``, one source of truth shared with
``converter.py``) — decoupling conversion from the request/response cycle.
Own compose service, not a background task inside the 4-worker ``api`` app —
the same "exactly one trigger" reasoning ``data/tasks.py``'s purge loop
already documents: 4 uvicorn workers would mean 4 competing discovery loops
if this lived inside ``main.py`` instead.

    python -m data.job_worker            one-shot: recover orphans, claim +
                                          run whatever's queued right now,
                                          then exit
    python -m data.job_worker --loop     run forever — BRPOP-driven
                                          discovery plus a periodic GC sweep

Three DISTINCT mechanisms below solve three different problems — see
STRESS_TEST_PHASE3_PLAN.md's "Crash recovery vs. a legitimately deep
backlog" section for why these are not collapsed into one "stuck job"
timeout:

1. **Discovery** (``_discovery_wake`` — BRPOP wake, claim-all-queued) —
   normal pickup, as fast as jobs actually arrive.
2. **Startup orphan recovery** (``recover_orphaned_jobs``) — a ``converting``
   row is only ever true while *this worker process instance* holds a live
   asyncio task for it, so a process restart means everything it was doing
   is provably gone — no time-guessing needed. Single-replica scope: correct
   only because exactly one worker instance ever runs (see the plan doc).
3. **Periodic GC sweep** (``gc_sweep``) — coarse, infrequent safety net for
   abandoned work neither of the above resolved (a dropped Redis push *and*
   a crash that somehow outlives restart detection), plus prompt disk
   cleanup for done/failed job files. This is NOT the same bound as
   converter.py's GOTENBERG_QUEUE_TIMEOUT_SECONDS/
   GHOSTSCRIPT_QUEUE_TIMEOUT_SECONDS (a per-attempt backpressure bound on the
   in-flight conversion itself) — this is a much coarser, longer ceiling on
   the row's total age, independent of what the in-flight task is doing.

Job **metadata** rows are cleaned up later by the existing daily
``data/tasks.py`` purge loop (rows older than ~24h) — this file only ever
force-fails or requeues rows, and deletes job **files**, never the row
itself.
"""

import asyncio
import secrets
import sys
import tempfile
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from converter import (
    CPU_BOUND_QUEUE_TIMEOUT_SECONDS,
    GHOSTSCRIPT_QUEUE_TIMEOUT_SECONDS,
    GOTENBERG_HEALTH_KEY,
    GOTENBERG_QUEUE_TIMEOUT_SECONDS,
    JOB_RESULTS_DIR,
    JOB_WAKE_QUEUE_KEY,
    TOOL_REGISTRY,
    WORKER_HEARTBEAT_KEY,
    _classify_conversion_error,
    _probe_gotenberg_live,
    _safe_filename,
)
from log import get_logger
from sqlalchemy import func, select, update

from data import neon_api, node_ops
from data.db import get_active_session_factory
from data.models import ConversionJob
from data.node_registry import (
    DEFAULT_NODE_SETTINGS,
    NoActiveNodeError,
    NodeSettings,
    get_active_node,
    get_last_activity,
    get_settings,
    get_usage_cache,
    list_nodes,
    recover_stale_pool_state,
    set_usage_cache,
)
from data.redis_client import REDIS_CALL_TIMEOUT_SECONDS, redis_client

logger = get_logger("job_worker")

BRPOP_TIMEOUT_SECONDS = 5

# Dead-letter cap — startup orphan recovery force-fails instead of requeuing
# a `converting` row once its own attempts counter exceeds this, so one
# poisoned file can't crash-loop the worker forever.
MAX_ATTEMPTS = 3

# A much coarser, longer ceiling than converter.py's
# GOTENBERG_QUEUE_TIMEOUT_SECONDS/GHOSTSCRIPT_QUEUE_TIMEOUT_SECONDS (the
# per-attempt backpressure bound the in-flight conversion itself is bound
# by) — by the time the GC sweep would ever consider a queued/converting
# row, that row's own in-flight task has almost always already resolved one
# way or another. This is a pure safety net for the rare case that
# resolution somehow never landed, not the normal path.
#
# Raised from 30min to 90min alongside DISCOVERY_FALLBACK_INTERVAL_SECONDS/
# GC_SWEEP_INTERVAL_SECONDS going from 15min to 60min below (same margin,
# just scaled up): with near-zero real traffic, a dropped push or a
# genuinely stuck job is already rare, so trading a longer worst-case
# rescue/failure time for a ~75% cut in idle Neon compute cost is worth it.
STUCK_JOB_MAX_AGE_SECONDS = 90 * 60

# Disk-cost driven, unrelated to the age ceiling above — just long enough
# for one dropped download connection to retry once.
FINISHED_JOB_FILE_GRACE_SECONDS = 5 * 60

# NEON_FAILOVER_PLAN.md §7.7 (Phase C) — the in-flight job drain step's own
# cap, used by drain_in_flight_jobs() below. Deliberately built from
# converter.py's *_QUEUE_TIMEOUT_SECONDS trio (currently 600s each), NOT
# STUCK_JOB_MAX_AGE_SECONDS above: those are two distinct, unrelated
# constants that differ by 9x (see this module's own docstring on the three
# distinct mechanisms) — reaching for STUCK_JOB_MAX_AGE_SECONDS here would
# make a routine node switch block for up to 90 minutes instead of ~10. A
# currently-`converting` row is already bounded by whichever of the three
# per-attempt queue-wait timeouts applies to it; the largest of the three is
# what guarantees this covers whichever category actually happens to be
# in flight.
DRAIN_TIMEOUT_SECONDS = max(
    GOTENBERG_QUEUE_TIMEOUT_SECONDS,
    GHOSTSCRIPT_QUEUE_TIMEOUT_SECONDS,
    CPU_BOUND_QUEUE_TIMEOUT_SECONDS,
)

DRAIN_POLL_INTERVAL_SECONDS = 1.0

# _discovery_wake() itself is instant and near-free on a real BRPOP push (a
# job was actually enqueued) — that path is untouched. This bounds the
# OTHER trigger: the BRPOP-timeout branch, which used to run the same DB
# query on every single 5s timeout regardless of whether anything was ever
# queued. On Neon (serverless Postgres, autosuspend after 5min idle), a
# query landing more often than that never lets the idle clock finish
# counting down, so compute stays active around the clock and burns the
# free tier's CU-hrs on pure "just checking" traffic.
#
# Must stay safely BELOW STUCK_JOB_MAX_AGE_SECONDS (90min): if a Redis push
# is dropped, this fallback is the ONLY thing that ever claims that job —
# gc_sweep below only ever fails rows, it never claims/runs one. So this
# has to fire, and win the race, while the row is still well short of
# gc_sweep's stuck-age cutoff, or gc_sweep force-fails a job this fallback
# was about to legitimately rescue (PR #141 review). 60min leaves a wide
# margin under the 90min cutoff — comfortably more than any real
# conversion takes (bounded by GOTENBERG_QUEUE_TIMEOUT_SECONDS/
# GHOSTSCRIPT_QUEUE_TIMEOUT_SECONDS, both well under that).
#
# Raised from 15min after confirming real traffic is near zero: at 15min
# this fallback+sweep pair alone was keeping the Neon free tier's 100
# CU-hr/month budget under sustained pressure from pure "just checking"
# wakes (~2 CU-hr/day) even with nothing to actually discover. 60min cuts
# that by ~75% and, as a bonus, lines up with UptimeRobot's existing hourly
# /health poll (which already wakes Postgres for its own SELECT 1), so this
# mostly rides along on a wake that was happening anyway instead of adding
# a separate one.
DISCOVERY_FALLBACK_INTERVAL_SECONDS = 60 * 60

# Must stay >= DISCOVERY_FALLBACK_INTERVAL_SECONDS above: gc_sweep judges
# "stuck" by created_at age, not by how long a row has actually been
# converting, so if it ran before the discovery fallback ever got a chance
# to rescue a dropped-push job, it would wrongly dead-letter a job that was
# simply late to be claimed, not actually stuck (PR #141 review). Same
# value as the fallback rather than something longer — one interval to
# reason about — which also caps worst-case time-to-visible-failure for a
# genuinely stuck job at STUCK_JOB_MAX_AGE_SECONDS + this (~150min), up
# from the ~45min the previous 15min/30min pair meant — accepted in
# exchange for the compute-cost cut documented above, since the coarse GC
# sweep is a rare-case backstop, not the normal path (a real conversion
# fails via Gotenberg's own much shorter per-attempt timeout first).
GC_SWEEP_INTERVAL_SECONDS = 60 * 60

# Mirrors data/tasks.py's HEARTBEAT_PATH idiom — touched once per loop
# iteration so the container's HEALTHCHECK (docker-compose.yml) can tell
# "alive and cycling" apart from "process up but the event loop is wedged".
HEARTBEAT_PATH = Path(tempfile.gettempdir()) / "worker-heartbeat"

# Same per-iteration touch as HEARTBEAT_PATH above, but into Redis (shared
# with `api`) rather than a local file, so converter.py's /health route can
# actually see it — HEARTBEAT_PATH lives in this container's own /tmp, never
# mounted into `api`. A TTL'd SET rather than a timestamp value: the key's
# mere existence *is* the freshness check on the reading side, no clock-skew
# or parsing concerns. Set a little above the healthcheck's own 120s
# staleness threshold (docker-compose.yml) so a slow-but-still-cycling loop
# iteration doesn't flap /health before the container healthcheck itself
# would consider the worker unhealthy.
WORKER_HEARTBEAT_TTL_SECONDS = 150

# Gated the same way GC_SWEEP_INTERVAL_SECONDS is below — probed on a timer,
# independent of whatever job traffic is or isn't flowing through this
# worker's background tasks, so converter.py's /health route always has a
# signal fresh to within one probe interval instead of going stale during an
# idle spell. TTL is a few probes' worth of slack so one slow-but-fine probe
# doesn't flap /health, while a genuinely wedged Gotenberg (Phase 3 stress
# test, Finding 1) still reads as "down" within well under a minute.
GOTENBERG_HEALTH_PROBE_INTERVAL_SECONDS = 10
GOTENBERG_HEALTH_TTL_SECONDS = 30


# --------------------------------------------------------------------------- #
# In-flight job draining (NEON_FAILOVER_PLAN.md §7.7, Phase C) — nothing
# calls any of this yet; a later phase's cutover orchestration is the first
# real caller. Provided now so that phase doesn't need to touch this
# module's core claim path again.
# --------------------------------------------------------------------------- #

# Single-instance, in-process flag — safe because the cutover orchestration
# that will pause/resume claiming (§7.13) runs INSIDE this same
# job_worker.py process, not dispatched from one of the 4 `api` processes
# (contrast with the Redis-backed state in data/node_registry.py, which
# genuinely is shared across multiple processes and needs to be).
_claim_paused = False


def pause_claiming() -> None:
    """Stop the claim loop from picking up new `queued` rows (§7.7 step 1).
    New *submissions* are already blocked at the HTTP layer by the
    maintenance-mode gate (``data/node_registry.require_not_maintenance``)
    — this only needs to stop THIS process from starting anything already
    queued."""
    global _claim_paused
    _claim_paused = True


def resume_claiming() -> None:
    """§7.7 step 5: clear the pause once maintenance mode lifts. Easy to
    omit — without this explicit step, a naive implementation could leave
    the worker permanently paused after the first switch."""
    global _claim_paused
    _claim_paused = False


async def drain_in_flight_jobs(
    *,
    timeout_seconds: float = DRAIN_TIMEOUT_SECONDS,
    poll_interval_seconds: float = DRAIN_POLL_INTERVAL_SECONDS,
) -> bool:
    """Pause claiming, then wait for every currently-`converting` row to
    reach a terminal state (§7.7 steps 1-2), capped at ``timeout_seconds``
    (``DRAIN_TIMEOUT_SECONDS`` by default — see that constant's own comment
    for why this is NOT ``STUCK_JOB_MAX_AGE_SECONDS``).

    Returns ``True`` once the in-flight count reaches zero, ``False`` if the
    cap was hit first with jobs still converting — a later phase's cutover
    orchestration decides what to do with that (§7.4: abort the flip, resume
    normal service on the still-healthy original node).

    Does **not** call ``resume_claiming()`` itself — that is a deliberate,
    separate step (§7.7 step 5) taken only once maintenance mode has
    actually lifted, which is well after this returns (the final top-up
    sync and the flip itself still have to happen in between).
    """
    pause_claiming()
    deadline = time.monotonic() + timeout_seconds
    while True:
        # Re-resolved every iteration, not cached across the whole loop —
        # same reasoning _execute_job() already documents for its own
        # re-resolve between read and write phases: this loop can run for
        # up to timeout_seconds (minutes), and a stale factory would keep
        # querying whichever node was active when the drain STARTED rather
        # than whichever is active now.
        session_factory = await get_active_session_factory()
        async with session_factory() as db:
            in_flight = (
                await db.execute(
                    select(func.count())
                    .select_from(ConversionJob)
                    .where(ConversionJob.status == "converting")
                )
            ).scalar_one()
        if in_flight == 0:
            return True
        if time.monotonic() >= deadline:
            logger.warning(
                "Drain timed out with %d job(s) still converting",
                in_flight,
                extra={
                    "data": {
                        "event": "drain_timeout",
                        "in_flight": in_flight,
                    }
                },
            )
            return False
        await asyncio.sleep(poll_interval_seconds)


async def _claim_one(db, job_id: str) -> bool:
    if _claim_paused:
        return False
    result = await db.execute(
        update(ConversionJob)
        .where(ConversionJob.id == job_id, ConversionJob.status == "queued")
        .values(
            status="converting",
            started_at=datetime.now(UTC),
            attempts=ConversionJob.attempts + 1,
        )
    )
    await db.commit()
    return result.rowcount > 0


async def _execute_job(job_id: str) -> None:
    """Run one already-``converting`` job to a terminal state. Assumes the
    row was already claimed (status flipped to ``converting``) by the
    caller — either ``run_job`` below or the discovery loop's bulk claim.

    Deliberately does NOT hold one DB session open for the whole call.
    ``spec.convert`` can wait behind the Gotenberg/Ghostscript/CPU-bound
    semaphore for up to that tool's own queue-timeout bound — holding a
    session, and the pool connection it checks out, across that whole span
    would let any backlog bigger than the pool's own size (``data/db.py``
    sets no explicit ``pool_size`` — SQLAlchemy defaults to 5 + 10 overflow
    = 15 connections) wedge this worker's own ability to claim further work
    or run its GC sweep, exactly the "Postgres touched per-job, not held
    open" shape the plan calls for. Two short-lived sessions instead: one to
    read the job's inputs, one to write its terminal state.
    """
    session_factory = await get_active_session_factory()
    async with session_factory() as db:
        job = await db.get(ConversionJob, job_id)
        if job is None:
            return
        tool_id = job.tool_id
        original_filename = job.original_filename
        options = job.options

    spec = TOOL_REGISTRY.get(tool_id)
    input_path = JOB_RESULTS_DIR / f"{job_id}.input"
    try:
        if spec is None:
            raise RuntimeError(f"Unknown tool_id: {tool_id}")
        content = input_path.read_bytes()
        result = await spec.convert(content, original_filename, options)
        output_path = JOB_RESULTS_DIR / f"{job_id}.output"
        # Truncate-mode write (the default for write_bytes), not
        # exclusive-create: a retried job (startup orphan recovery) may
        # leave a partial file from a prior crashed attempt — overwriting
        # it is harmless, since the download route gates on the DB row's
        # status, never on file existence alone.
        output_path.write_bytes(result)
        values = {
            "status": "done",
            "finished_at": datetime.now(UTC),
            "output_filename": _safe_filename(original_filename, spec.output_ext),
        }
        logger.info(
            "Conversion job done: %s",
            tool_id,
            extra={
                "data": {
                    "event": "job_done",
                    "tool_id": tool_id,
                    "job_id": job_id,
                    "output_bytes": len(result),
                }
            },
        )
    except Exception as exc:
        message, error_type = _classify_conversion_error(exc)
        values = {
            "status": "failed",
            "finished_at": datetime.now(UTC),
            "error_message": message,
            "error_type": error_type,
        }
        log_fn = logger.warning if error_type == "queue_timeout" else logger.error
        log_fn(
            "Conversion job failed: %s — %s",
            tool_id,
            error_type,
            exc_info=error_type not in ("queue_timeout", "validation_error"),
            extra={
                "data": {
                    "event": "job_failed",
                    "tool_id": tool_id,
                    "job_id": job_id,
                    "error_type": error_type,
                }
            },
        )

    # Re-resolved rather than reusing the factory above: a switch (§7.4) may
    # have happened while spec.convert() was running, and this write must
    # target whichever node is active NOW, not whichever was active when the
    # job started reading its input.
    session_factory = await get_active_session_factory()
    async with session_factory() as db:
        # Guard on status='converting': the periodic GC sweep may have
        # already force-failed this row (STUCK_JOB_MAX_AGE_SECONDS) while
        # this conversion was still running unbounded in the background —
        # an unconditional write here would silently clobber that
        # resolution with a stale result arriving after the fact.
        outcome = await db.execute(
            update(ConversionJob)
            .where(ConversionJob.id == job_id, ConversionJob.status == "converting")
            .values(**values)
        )
        await db.commit()
        if outcome.rowcount == 0:
            logger.warning(
                "Conversion job resolved after its row left 'converting' "
                "(likely GC-swept as stuck) — discarding late result: %s",
                tool_id,
                extra={
                    "data": {
                        "event": "job_late_result_discarded",
                        "tool_id": tool_id,
                        "job_id": job_id,
                    }
                },
            )


async def run_job(job_id: str) -> None:
    """Claim (queued -> converting) and run one job end-to-end. No Redis, no
    loop required — this is what tests call directly for one job, and what
    the one-shot CLI invocation uses too."""
    session_factory = await get_active_session_factory()
    async with session_factory() as db:
        claimed = await _claim_one(db, job_id)
    if not claimed:
        return
    await _execute_job(job_id)


async def _claim_all_queued(db) -> list[str]:
    """Atomically claim every currently-queued row in one round trip —
    ``FOR UPDATE SKIP LOCKED`` is cheap insurance for a future second worker
    replica, not needed for correctness with today's single instance."""
    if _claim_paused:
        return []
    subq = (
        select(ConversionJob.id)
        .where(ConversionJob.status == "queued")
        .order_by(ConversionJob.created_at)
        .with_for_update(skip_locked=True)
    )
    result = await db.execute(
        update(ConversionJob)
        .where(ConversionJob.id.in_(subq))
        .values(
            status="converting",
            started_at=datetime.now(UTC),
            attempts=ConversionJob.attempts + 1,
        )
        .returning(ConversionJob.id)
    )
    ids = [row[0] for row in result.all()]
    await db.commit()
    return ids


# asyncio only holds a WEAK reference to a task — with nothing else
# referencing it, a fire-and-forget task can be garbage-collected
# mid-execution (a real, documented asyncio footgun, not theoretical).
# Keeping a strong reference here until it finishes is what actually
# guarantees a claimed job runs to completion.
_background_tasks: set[asyncio.Task] = set()


async def _discovery_wake() -> None:
    session_factory = await get_active_session_factory()
    async with session_factory() as db:
        job_ids = await _claim_all_queued(db)
    if job_ids:
        logger.info(
            "Claimed %d queued job(s)",
            len(job_ids),
            extra={"data": {"event": "jobs_claimed", "count": len(job_ids)}},
        )
    for job_id in job_ids:
        task = asyncio.create_task(_execute_job(job_id))
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)


def _dispatch_wake_task(raw_value: str) -> None:
    """NEON_FAILOVER_PLAN.md §7.13: parse one popped wake-queue value and,
    if it's a recognized switch/provision task, fire the matching
    ``node_ops`` executor as its own background task — same strong-
    reference pattern as ``_discovery_wake()`` above, so a multi-minute
    switch/sync never delays this loop's own responsiveness. A value that
    isn't a recognized task (the legacy bare job-id shape, unchanged) is a
    no-op here; the caller's own discovery re-poll picks it up regardless
    of the popped value's content."""
    task = node_ops.parse_wake_task(raw_value)
    if task is None:
        return
    task_type, task_kwargs = task
    try:
        if task_type == node_ops.TASK_TYPE_SWITCH:
            coro = node_ops.execute_switch(**task_kwargs)
        elif task_type == node_ops.TASK_TYPE_PROVISION:
            coro = node_ops.execute_provision(**task_kwargs)
        else:
            return
    except TypeError:
        # A recognized task-type with a missing/extra field relative to
        # execute_switch()/execute_provision()'s own keyword-only signature
        # — the only thing that can go wrong at this call expression, since
        # constructing a coroutine doesn't run its body yet. Both producers
        # today (data/routers/admin_nodes.py's build_switch_task()/
        # build_provision_task()) always emit a well-formed payload, so this
        # is defense against a future schema drift or a hand-edited Redis
        # entry, not a path real traffic takes. parse_wake_task()'s own
        # contract is "never crash the wake loop" on a malformed push — this
        # extends that same guarantee past parsing into dispatch, so a
        # mismatched payload is dropped (loudly logged) instead of taking
        # down the single process every real conversion also depends on.
        logger.error(
            "Wake-queue task-type %r has a payload that doesn't match its "
            "executor's signature — dropping",
            task_type,
            exc_info=True,
            extra={
                "data": {
                    "event": "worker_dispatch_wake_task_malformed",
                    "task_type": task_type,
                }
            },
        )
        return
    wake_task = asyncio.create_task(coro)
    _background_tasks.add(wake_task)
    wake_task.add_done_callback(_background_tasks.discard)


# --------------------------------------------------------------------------- #
# Usage polling + proactive trigger (NEON_FAILOVER_PLAN.md §7.3/§7.4, Phase E)
# --------------------------------------------------------------------------- #


async def _poll_one_node_usage(node) -> None:
    try:
        ratio = await neon_api.get_project_usage(node.neon_project_id)
    except neon_api.NeonApiError:
        logger.warning(
            "Usage poll failed for node %s — keeping last cached value",
            node.node_id,
            extra={"data": {"event": "usage_poll_failed", "node_id": node.node_id}},
        )
        return
    await set_usage_cache(node.node_id, ratio)


async def _poll_all_node_usage() -> None:
    """§7.3: refresh every node's cached usage_ratio via Neon's
    control-plane API — never the node's own Postgres, so this never wakes
    compute and every node (including reserves) can be polled on the same
    cadence. A single node's failed poll is NOT a failure signal: keep
    whatever's already cached and retry next cycle — never let a Neon-API
    blip masquerade as a database-down event (that's what the reactive
    trigger's own, separate DB health check is for, §7.4).

    Every node is polled CONCURRENTLY, not one at a time — this whole call
    is awaited inline in `_loop()`'s main body (unlike a sync/switch, a
    usage check is cheap enough not to need its own background task), so a
    sequential for-loop here would mean a single slow/hanging Neon API call
    stalls this loop's own responsiveness (claiming newly-queued conversion
    jobs) for up to ``NEON_API_TIMEOUT_SECONDS`` *per node* in a degraded-API
    scenario, instead of once total."""
    await asyncio.gather(*(_poll_one_node_usage(node) for node in await list_nodes()))


def _fire_background(coro) -> None:
    """Same strong-reference pattern as _discovery_wake()/_dispatch_wake_task
    above — a fire-and-forget asyncio.create_task() with nothing else
    referencing it can be garbage-collected mid-run."""
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


async def _maybe_trigger_proactive_action(node_settings: NodeSettings) -> None:
    """§7.4 Trigger 1 (proactive) — the two-threshold behavior, evaluated
    against the ACTIVE node's own freshly-polled usage. Runs entirely
    in-process: unlike the manual/reactive triggers (dispatched from an
    `api` request process via the wake queue), this loop already IS
    job_worker.py, so it invokes node_ops directly."""
    try:
        active_node_id = await get_active_node()
    except NoActiveNodeError:
        return  # Bootstrap hasn't run yet — nothing to evaluate.

    usage = await get_usage_cache(active_node_id)
    if usage is None:
        return  # Never successfully polled yet.

    if usage.ratio >= node_settings.cutover_threshold_pct / 100:
        target = await node_ops.select_switch_target(exclude_node_ids={active_node_id})
        if target is None:
            logger.warning(
                "Active node %s past the cutover threshold (%.0f%%) but no "
                "reserve node is available",
                active_node_id,
                usage.ratio * 100,
                extra={
                    "data": {
                        "event": "proactive_cutover_no_reserve",
                        "node_id": active_node_id,
                    }
                },
            )
            return
        run_id = f"proactive-{secrets.token_hex(8)}"
        logger.info(
            "Proactive cutover triggered: %s -> %s (usage=%.1f%%)",
            active_node_id,
            target,
            usage.ratio * 100,
            extra={
                "data": {
                    "event": "proactive_cutover_triggered",
                    "run_id": run_id,
                    "source_node_id": active_node_id,
                    "target_node_id": target,
                }
            },
        )
        # execute_switch() itself acquires the pool-operation lock and is a
        # complete no-op (logged, error status, no history entry) if one is
        # already held — e.g. a still-running proactive switch from a
        # previous cycle, or a concurrent manual/reactive trigger — so no
        # extra guard is needed here (§7.4's concurrency guard).
        _fire_background(
            node_ops.execute_switch(
                run_id=run_id, target_node_id=target, trigger="proactive"
            )
        )
        return

    if usage.ratio >= node_settings.warmup_threshold_pct / 100:
        target = await node_ops.select_switch_target(exclude_node_ids={active_node_id})
        if target is None:
            logger.warning(
                "Active node %s past the warm-up threshold (%.0f%%) but no "
                "reserve node is available",
                active_node_id,
                usage.ratio * 100,
                extra={
                    "data": {
                        "event": "proactive_warmup_no_reserve",
                        "node_id": active_node_id,
                    }
                },
            )
            return
        # Skip a redundant sync if this target was already synced within the
        # current poll interval (a previous warm-up cycle, a weekly
        # keep-alive, or a recent provisioning) — node_sync.sync_node() is
        # always a full dump/restore, not incremental, so re-running it every
        # single poll tick while usage sits in the warm-up band for hours
        # would just repeatedly hold the pool-operation lock for no benefit.
        last_activity = await get_last_activity(target)
        interval_seconds = node_settings.usage_poll_interval_minutes * 60
        if last_activity is not None:
            age_seconds = (datetime.now(UTC) - last_activity).total_seconds()
            if age_seconds < interval_seconds:
                return
        logger.info(
            "Proactive warm-up triggered: %s -> %s (usage=%.1f%%)",
            active_node_id,
            target,
            usage.ratio * 100,
            extra={
                "data": {
                    "event": "proactive_warmup_triggered",
                    "source_node_id": active_node_id,
                    "target_node_id": target,
                }
            },
        )
        # run_warmup_sync() acquires the pool-operation lock itself and is a
        # no-op if one is already held (§7.4's concurrency guard) — same
        # reasoning as the cutover branch above.
        _fire_background(node_ops.run_warmup_sync(active_node_id, target))


async def usage_poll_cycle() -> NodeSettings:
    """One full tick of §7.3/§7.4: refresh every node's cached usage, then
    evaluate the proactive trigger against the (now-fresh) active-node
    reading. Returns the settings snapshot used, so the caller's own poll
    scheduling (§8: `usage_poll_interval_minutes` is admin-editable, no
    redeploy required) can pick up a changed interval starting from the next
    cycle."""
    node_settings = await get_settings()
    await _poll_all_node_usage()
    await _maybe_trigger_proactive_action(node_settings)
    return node_settings


# --------------------------------------------------------------------------- #
# Weekly keep-alive sync (NEON_FAILOVER_PLAN.md §7.9, Phase E)
# --------------------------------------------------------------------------- #

# Neon deletes a free-tier project after 90 days with zero activity, and the
# usage-check (§7.3) doesn't count — it's control-plane only, never touches
# the node's own Postgres. A week is a wide margin under that 90-day cutoff
# while still keeping every reserve's standby data reasonably fresh for a
# reactive (no-sync) failover to a rarely-used node.
KEEPALIVE_INTERVAL_SECONDS = 7 * 24 * 60 * 60

# The sweep only needs to CHECK this often, not sync this often — checking on
# the same cadence as the GC sweep is plenty; a reserve running up to an hour
# past the exact 7-day mark is immaterial against the 90-day deletion window.
KEEPALIVE_CHECK_INTERVAL_SECONDS = GC_SWEEP_INTERVAL_SECONDS


async def weekly_keepalive_sweep() -> None:
    """§7.9: every RESERVE node (``ready``, not the active one) whose
    ``last_activity`` (§7.1 — updated by every real sync, in either
    direction) is missing or older than ``KEEPALIVE_INTERVAL_SECONDS`` gets a
    fresh sync fired as its own background task, regardless of whether a
    switch is expected any time soon. Reuses ``node_ops.run_warmup_sync`` —
    the exact same standalone, pool-lock-guarded sync the proactive trigger's
    70% warm-up uses (§7.4) — since this is the same operation (sync FROM the
    active node INTO a reserve) for a different reason."""
    try:
        active_node_id = await get_active_node()
    except NoActiveNodeError:
        return

    now = datetime.now(UTC)
    for node in await list_nodes():
        if node.node_id == active_node_id or node.status != "ready":
            continue
        last_activity = await get_last_activity(node.node_id)
        if last_activity is not None:
            age_seconds = (now - last_activity).total_seconds()
            if age_seconds < KEEPALIVE_INTERVAL_SECONDS:
                continue
        logger.info(
            "Weekly keep-alive sync: %s -> %s",
            active_node_id,
            node.node_id,
            extra={
                "data": {
                    "event": "keepalive_sync_triggered",
                    "source_node_id": active_node_id,
                    "target_node_id": node.node_id,
                }
            },
        )
        _fire_background(node_ops.run_warmup_sync(active_node_id, node.node_id))


async def recover_orphaned_jobs() -> dict[str, int]:
    """A ``converting`` row is only ever true while THIS worker process
    instance holds a live asyncio task for it — so if the process restarts
    (Docker's ``restart: unless-stopped`` already brings a crashed container
    back up), everything it was doing is provably gone. Requeue it
    automatically; force-fail instead once its own ``attempts`` count is
    already at the dead-letter cap, so one poisoned file can't crash-loop
    the worker forever.

    Single-replica scope: correct only because exactly one worker instance
    is ever running. A second replica would need to scope this to rows its
    own predecessor actually held, not every ``converting`` row.
    """
    requeued = 0
    dead_lettered = 0
    session_factory = await get_active_session_factory()
    async with session_factory() as db:
        rows = (
            (
                await db.execute(
                    select(ConversionJob).where(ConversionJob.status == "converting")
                )
            )
            .scalars()
            .all()
        )
        for job in rows:
            if job.attempts >= MAX_ATTEMPTS:
                job.status = "failed"
                job.finished_at = datetime.now(UTC)
                job.error_message = "Conversion failed after repeated worker restarts."
                job.error_type = "conversion_error"
                dead_lettered += 1
            else:
                job.status = "queued"
                job.started_at = None
                requeued += 1
        await db.commit()
    return {"requeued": requeued, "dead_lettered": dead_lettered}


async def gc_sweep() -> dict[str, int]:
    """Coarse, infrequent safety net — see the module docstring. Force-fails
    pathologically old queued/converting rows, and deletes job files for
    done/failed jobs past a short, disk-cost-driven grace period (unrelated
    to the much longer stuck-job age ceiling)."""
    now = datetime.now(UTC)
    stuck_cutoff = now - timedelta(seconds=STUCK_JOB_MAX_AGE_SECONDS)
    finished_cutoff = now - timedelta(seconds=FINISHED_JOB_FILE_GRACE_SECONDS)

    stuck_failed = 0
    files_cleaned = 0

    session_factory = await get_active_session_factory()
    async with session_factory() as db:
        stuck = (
            (
                await db.execute(
                    select(ConversionJob).where(
                        ConversionJob.status.in_(("queued", "converting")),
                        ConversionJob.created_at < stuck_cutoff,
                    )
                )
            )
            .scalars()
            .all()
        )
        for job in stuck:
            job.status = "failed"
            job.finished_at = now
            job.error_message = (
                "The conversion service is busy right now. Please try again "
                "in a moment."
            )
            job.error_type = "queue_timeout"
            stuck_failed += 1

        finished = (
            (
                await db.execute(
                    select(ConversionJob).where(
                        ConversionJob.status.in_(("done", "failed")),
                        ConversionJob.finished_at.is_not(None),
                        ConversionJob.finished_at < finished_cutoff,
                    )
                )
            )
            .scalars()
            .all()
        )
        for job in finished:
            for suffix in (".input", ".output"):
                path = JOB_RESULTS_DIR / f"{job.id}{suffix}"
                try:
                    path.unlink()
                    files_cleaned += 1
                except FileNotFoundError:
                    pass

        await db.commit()

    return {"stuck_failed": stuck_failed, "files_cleaned": files_cleaned}


async def _one_shot() -> None:
    recovered = await recover_orphaned_jobs()
    if recovered["requeued"] or recovered["dead_lettered"]:
        print(f"orphan recovery: {recovered}", flush=True)
    await _discovery_wake()


async def _loop() -> None:
    print("job worker loop started", flush=True)
    recovered = await recover_orphaned_jobs()
    if recovered["requeued"] or recovered["dead_lettered"]:
        logger.warning(
            "Startup orphan recovery: %s",
            recovered,
            extra={"data": {"event": "orphan_recovery", **recovered}},
        )

    # NEON_FAILOVER_PLAN.md §7.1 — same "a fresh process means anything
    # mid-flight belongs to a dead incarnation" reasoning as the orphaned-job
    # recovery above, applied to the pool-operation lock and the maintenance
    # flag (data/node_ops.py's execute_switch() is their only real writer).
    # Runs before the loop's first BRPOP below, so it can never clear state
    # a legitimately just-dispatched switch/provision task just set.
    pool_recovered = await recover_stale_pool_state()
    if pool_recovered["pool_lock"] or pool_recovered["maintenance"]:
        logger.warning(
            "Startup pool-state recovery: cleared stale state left by a "
            "previous incarnation: %s",
            pool_recovered,
            extra={"data": {"event": "pool_state_recovery", **pool_recovered}},
        )

    last_gc = 0.0
    last_gotenberg_probe = 0.0
    last_discovery_fallback = 0.0
    last_usage_poll = 0.0
    last_keepalive_check = 0.0
    # NEON_FAILOVER_PLAN.md §7.3/§8 — usage_poll_interval_minutes is
    # admin-editable at runtime; re-read on every actual poll below so a
    # changed interval takes effect starting from the next cycle rather than
    # only at process startup. DEFAULT_NODE_SETTINGS' own value seeds the
    # very first wait, matching §7.1's "settings are also the Redis-down
    # fallback" contract.
    usage_poll_interval_seconds = DEFAULT_NODE_SETTINGS.usage_poll_interval_minutes * 60
    while True:
        pushed = None
        try:
            pushed = await redis_client.brpop(
                JOB_WAKE_QUEUE_KEY, timeout=BRPOP_TIMEOUT_SECONDS
            )
        except Exception:  # noqa: BLE001 — must survive to the next iteration
            logger.warning(
                "Redis BRPOP failed — pausing briefly before retrying",
                extra={"data": {"event": "worker_redis_error"}},
            )
            await asyncio.sleep(BRPOP_TIMEOUT_SECONDS)

        # NEON_FAILOVER_PLAN.md §7.13: the wake queue now carries TWO wire
        # shapes on the same Redis list — the legacy bare job-id string
        # (converter.py:1391, unchanged) and a JSON task object for
        # switch/provision dispatch (data/node_ops.py). BRPOP on a single
        # key returns a (key, value) tuple, not the bare value, so the
        # popped value is unpacked here. Anything that isn't a recognized
        # task (non-JSON, or JSON without a recognized task-type) is the
        # legacy shape — falls through to the discovery re-poll below
        # exactly as it does today; per node_ops.py's own docstring, that's
        # harmless even for a switch/provision push, since discovery never
        # inspects the popped value's content anyway.
        if pushed is not None:
            _, raw_wake_value = pushed
            _dispatch_wake_task(raw_wake_value)

        now = time.monotonic()
        # A real push always runs discovery immediately (this is the fast
        # path — a job showing up should be picked up right away). A BRPOP
        # *timeout* means nothing was pushed, so there's normally nothing to
        # discover — only worth the DB round trip on the long fallback
        # cadence below, in case a push was somehow dropped.
        if (
            pushed is not None
            or now - last_discovery_fallback > DISCOVERY_FALLBACK_INTERVAL_SECONDS
        ):
            try:
                await _discovery_wake()
            except Exception:  # noqa: BLE001
                logger.error(
                    "Discovery wake failed",
                    exc_info=True,
                    extra={"data": {"event": "worker_discovery_error"}},
                )
            if pushed is None:
                last_discovery_fallback = now
        if now - last_gc > GC_SWEEP_INTERVAL_SECONDS:
            try:
                result = await gc_sweep()
                if result["stuck_failed"] or result["files_cleaned"]:
                    logger.info(
                        "GC sweep: %s",
                        result,
                        extra={"data": {"event": "gc_sweep", **result}},
                    )
            except Exception:  # noqa: BLE001
                logger.error(
                    "GC sweep failed",
                    exc_info=True,
                    extra={"data": {"event": "worker_gc_error"}},
                )
            last_gc = now

        if now - last_usage_poll > usage_poll_interval_seconds:
            try:
                node_settings = await usage_poll_cycle()
                usage_poll_interval_seconds = (
                    node_settings.usage_poll_interval_minutes * 60
                )
            except Exception:  # noqa: BLE001
                logger.error(
                    "Usage poll cycle failed",
                    exc_info=True,
                    extra={"data": {"event": "worker_usage_poll_error"}},
                )
            last_usage_poll = now

        if now - last_keepalive_check > KEEPALIVE_CHECK_INTERVAL_SECONDS:
            try:
                await weekly_keepalive_sweep()
            except Exception:  # noqa: BLE001
                logger.error(
                    "Weekly keep-alive sweep failed",
                    exc_info=True,
                    extra={"data": {"event": "worker_keepalive_error"}},
                )
            last_keepalive_check = now

        if now - last_gotenberg_probe > GOTENBERG_HEALTH_PROBE_INTERVAL_SECONDS:
            try:
                if await _probe_gotenberg_live():
                    await asyncio.wait_for(
                        redis_client.set(
                            GOTENBERG_HEALTH_KEY, "1", ex=GOTENBERG_HEALTH_TTL_SECONDS
                        ),
                        timeout=REDIS_CALL_TIMEOUT_SECONDS,
                    )
                else:
                    # Don't wait out the TTL for a probe that already knows
                    # Gotenberg is down — delete so /health flips immediately
                    # instead of continuing to report the last-good result.
                    await asyncio.wait_for(
                        redis_client.delete(GOTENBERG_HEALTH_KEY),
                        timeout=REDIS_CALL_TIMEOUT_SECONDS,
                    )
            except Exception:  # noqa: BLE001 — a Redis blip must not stop the loop
                logger.warning(
                    "Gotenberg health probe/write failed — /health may report "
                    "Gotenberg as down until this succeeds again",
                    extra={"data": {"event": "gotenberg_health_probe_failed"}},
                )
            last_gotenberg_probe = now

        HEARTBEAT_PATH.write_text(datetime.now(UTC).isoformat())
        try:
            await asyncio.wait_for(
                redis_client.set(
                    WORKER_HEARTBEAT_KEY, "1", ex=WORKER_HEARTBEAT_TTL_SECONDS
                ),
                timeout=REDIS_CALL_TIMEOUT_SECONDS,
            )
        except Exception:  # noqa: BLE001 — a Redis blip must not stop the loop
            logger.warning(
                "Worker heartbeat write to Redis failed — /health may report "
                "the worker as down until this succeeds again",
                extra={"data": {"event": "worker_heartbeat_write_failed"}},
            )


def main(argv: list[str]) -> int:
    if "--loop" in argv:
        asyncio.run(_loop())
        return 0
    asyncio.run(_one_shot())
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
