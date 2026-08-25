"""Integration — data/job_worker.py's claim/run/finish logic, startup orphan
recovery, and the periodic GC sweep, all as plain function calls (no real
Redis loop needed — mirrors data/tasks.py's own testing shape, per
STRESS_TEST_PHASE3_PLAN.md's test-impact note).
"""

from datetime import UTC, datetime, timedelta

import converter
import pytest
from data import job_worker
from data.models import ConversionJob
from validation import ALLOWED_EXTENSIONS


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
