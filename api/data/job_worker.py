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
    caller — either ``run_job`` below or the discovery loop's bulk claim."""
    async with async_session_factory() as db:
        job = await db.get(ConversionJob, job_id)
        if job is None:
            return

        spec = TOOL_REGISTRY.get(job.tool_id)
        input_path = JOB_RESULTS_DIR / f"{job_id}.input"
        try:
            if spec is None:
                raise RuntimeError(f"Unknown tool_id: {job.tool_id}")
            content = input_path.read_bytes()
            result = await spec.convert(content, job.original_filename, job.options)
            output_path = JOB_RESULTS_DIR / f"{job_id}.output"
            # Truncate-mode write (the default for write_bytes), not
            # exclusive-create: a retried job (startup orphan recovery) may
            # leave a partial file from a prior crashed attempt — overwriting
            # it is harmless, since the download route gates on the DB row's
            # status, never on file existence alone.
            output_path.write_bytes(result)
            job.status = "done"
            job.finished_at = datetime.now(UTC)
            job.output_filename = _safe_filename(job.original_filename, spec.output_ext)
            logger.info(
                "Conversion job done: %s",
                job.tool_id,
                extra={
                    "data": {
                        "event": "job_done",
                        "tool_id": job.tool_id,
                        "job_id": job_id,
                        "output_bytes": len(result),
                    }
                },
            )
        except Exception as exc:
            message, error_type = _classify_conversion_error(exc)
            job.status = "failed"
            job.finished_at = datetime.now(UTC)
            job.error_message = message
            job.error_type = error_type
            log_fn = logger.warning if error_type == "queue_timeout" else logger.error
            log_fn(
                "Conversion job failed: %s — %s",
                job.tool_id,
                error_type,
                exc_info=error_type not in ("queue_timeout", "validation_error"),
                extra={
                    "data": {
                        "event": "job_failed",
                        "tool_id": job.tool_id,
                        "job_id": job_id,
                        "error_type": error_type,
                    }
                },
            )
        await db.commit()


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


def main(argv: list[str]) -> int:
    if "--loop" in argv:
        asyncio.run(_loop())
        return 0
    asyncio.run(_one_shot())
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
