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
import sys
import tempfile
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from converter import (
    JOB_RESULTS_DIR,
    JOB_WAKE_QUEUE_KEY,
    TOOL_REGISTRY,
    WORKER_HEARTBEAT_KEY,
    _classify_conversion_error,
    _safe_filename,
)
from log import get_logger
from sqlalchemy import select, update

from data.db import async_session_factory
from data.models import ConversionJob
from data.redis_client import redis_client

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
STUCK_JOB_MAX_AGE_SECONDS = 30 * 60

# Disk-cost driven, unrelated to the age ceiling above — just long enough
# for one dropped download connection to retry once.
FINISHED_JOB_FILE_GRACE_SECONDS = 5 * 60

GC_SWEEP_INTERVAL_SECONDS = 3 * 60

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


async def _claim_one(db, job_id: str) -> bool:
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
    async with async_session_factory() as db:
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

    async with async_session_factory() as db:
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
    async with async_session_factory() as db:
        claimed = await _claim_one(db, job_id)
    if not claimed:
        return
    await _execute_job(job_id)


async def _claim_all_queued(db) -> list[str]:
    """Atomically claim every currently-queued row in one round trip —
    ``FOR UPDATE SKIP LOCKED`` is cheap insurance for a future second worker
    replica, not needed for correctness with today's single instance."""
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
    async with async_session_factory() as db:
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
    async with async_session_factory() as db:
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

    async with async_session_factory() as db:
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

    last_gc = 0.0
    while True:
        try:
            await redis_client.brpop(JOB_WAKE_QUEUE_KEY, timeout=BRPOP_TIMEOUT_SECONDS)
        except Exception:  # noqa: BLE001 — must survive to the next iteration
            logger.warning(
                "Redis BRPOP failed — pausing briefly before retrying",
                extra={"data": {"event": "worker_redis_error"}},
            )
            await asyncio.sleep(BRPOP_TIMEOUT_SECONDS)

        try:
            await _discovery_wake()
        except Exception:  # noqa: BLE001
            logger.error(
                "Discovery wake failed",
                exc_info=True,
                extra={"data": {"event": "worker_discovery_error"}},
            )

        now = time.monotonic()
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

        HEARTBEAT_PATH.write_text(datetime.now(UTC).isoformat())
        try:
            await redis_client.set(
                WORKER_HEARTBEAT_KEY, "1", ex=WORKER_HEARTBEAT_TTL_SECONDS
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
