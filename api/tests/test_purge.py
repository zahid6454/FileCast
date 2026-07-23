"""Integration — 30-day purge deletes stale rows, retains anonymous data (D5)."""

from datetime import UTC, datetime, timedelta

import pytest
from data.models import (
    Conversion,
    Error,
    Rating,
    Session,
    User,
    UserConversion,
)
from data.tasks import main, purge_expired, retention_canary
from sqlalchemy import func, select


async def test_purge_deletes_stale_retains_aggregates(db):
    now = datetime.now(UTC)
    old = now - timedelta(days=40)

    user = User(email="p@dev.local", role="user")
    db.add(user)
    await db.flush()

    db.add_all(
        [
            UserConversion(user_id=user.id, tool_id="old", created_at=old),
            UserConversion(user_id=user.id, tool_id="new", created_at=now),
            Error(tool_id="old-e", created_at=old),
            Error(tool_id="new-e", created_at=now),
            Session(
                id="expired",
                user_id=user.id,
                created_at=old,
                expires_at=now - timedelta(days=1),
            ),
            Session(
                id="valid",
                user_id=user.id,
                created_at=now,
                expires_at=now + timedelta(days=1),
            ),
            Conversion(tool_id="jpg-to-png", date=old.date(), count=5, failures=0),
            Rating(tool_id="jpg-to-png", vote="yes", fingerprint="fp", created_at=old),
        ]
    )
    await db.commit()

    counts = purge_expired()  # sync management command, same test DB
    assert counts["user_conversions"] == 1
    assert counts["errors"] == 1
    assert counts["sessions"] == 1

    # stale gone, fresh kept
    async def n(model, **w):
        stmt = select(func.count()).select_from(model)
        return (await db.execute(stmt)).scalar_one()

    uc = (await db.execute(select(UserConversion.tool_id))).scalars().all()
    assert set(uc) == {"new"}
    er = (await db.execute(select(Error.tool_id))).scalars().all()
    assert set(er) == {"new-e"}
    se = (await db.execute(select(Session.id))).scalars().all()
    assert set(se) == {"valid"}
    # anonymous aggregates + ratings retained
    assert (await db.execute(select(func.count(Conversion.tool_id)))).scalar_one() == 1
    assert (await db.execute(select(func.count(Rating.id)))).scalar_one() == 1


async def test_canary_flags_a_purge_that_stopped_running(db):
    """The canary is the only thing that notices a silently-stopped purge.

    A purge that stops failing loudly and simply never runs leaves the privacy
    page promising a deletion that isn't happening. This asserts the canary
    actually fires on that state — a canary that always returns ok is worse
    than none, because it reads as proof.
    """
    user = User(email="canary@dev.local", role="user")
    db.add(user)
    await db.flush()
    # Well past retention + grace: what the table looks like if nothing purged.
    db.add(
        UserConversion(
            user_id=user.id,
            tool_id="stale",
            created_at=datetime.now(UTC) - timedelta(days=90),
        )
    )
    await db.commit()

    result = retention_canary()
    assert result["ok"] is False
    assert result["oldest_age_days"] > result["limit_days"]
    assert main(["data.tasks", "canary"]) == 1

    # Running the purge is what clears it — the canary tracks reality, not a flag.
    purge_expired()
    assert retention_canary()["ok"] is True
    assert main(["data.tasks", "canary"]) == 0


async def test_canary_tolerates_a_row_inside_the_grace_window(db):
    """Daily purge + 30-day window means a row can be ~31 days old legitimately.

    Without grace the canary would alarm every day between the row expiring and
    the next run, and an alarm that cries wolf daily gets muted.
    """
    user = User(email="grace@dev.local", role="user")
    db.add(user)
    await db.flush()
    db.add(
        UserConversion(
            user_id=user.id,
            tool_id="just-expired",
            created_at=datetime.now(UTC) - timedelta(days=31),
        )
    )
    await db.commit()

    assert retention_canary()["ok"] is True


async def test_canary_treats_an_empty_table_as_healthy(db):
    """No rows means nothing failed to be deleted — healthy, not unknown."""
    result = retention_canary()
    assert result["ok"] is True
    assert result["oldest_age_days"] is None


def test_loop_survives_a_failing_run(monkeypatch):
    """The loop must not die on an exception.

    `restart: unless-stopped` would bring the container back, but a purge that
    raises every time would then hot-loop; and if the process exited on the
    *first* transient error (e.g. starting before migrations applied) nothing
    would purge again until someone noticed. Neither is acceptable for a job
    whose failure is invisible, so the loop swallows and retries.
    """
    from data import tasks

    calls = {"runs": 0, "sleeps": []}

    def fake_run():
        calls["runs"] += 1
        if calls["runs"] == 1:
            raise RuntimeError("transient DB blip")

    class Stop(Exception):
        pass

    def fake_sleep(seconds):
        calls["sleeps"].append(seconds)
        if len(calls["sleeps"]) == 2:
            raise Stop  # break out of the infinite loop

    monkeypatch.setattr(tasks, "_run_once", fake_run)
    monkeypatch.setattr(tasks.time, "sleep", fake_sleep)

    with pytest.raises(Stop):
        tasks._run_loop(3600)

    # Ran again after the failure, and backed off briefly rather than waiting
    # a full interval to retry.
    assert calls["runs"] == 2
    assert calls["sleeps"][0] == tasks.FAILURE_RETRY_SECONDS
    assert calls["sleeps"][1] == 3600
