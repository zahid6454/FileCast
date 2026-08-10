"""30-day purge (D5/P4) — the management command **and** its scheduler.

Deletes stale ``user_conversions`` and ``errors`` rows (retention promise D5 —
actually DELETE, not filter-on-read) and expired ``sessions``. Anonymous
aggregates (``conversions``) and anonymous ``ratings`` are retained. Idempotent.

    python -m data.tasks purge          one-shot
    python -m data.tasks purge --loop   run forever, once per interval
    python -m data.tasks canary         exit 1 if retention is being violated

**Why the loop lives here rather than in the app.** The API serves with
``--workers 4``; an APScheduler inside it would start four schedulers
(ledger F13). The rule is *exactly one* trigger. Phase 7 specified a host
systemd timer — but that is a manual step on the VPS, it was never installed,
so nothing ever purged and the "auto-deleted after 30 days" promise on the
privacy page was not being kept. Running this loop as its own ``purge`` service
in ``docker-compose.yml`` preserves "exactly one" (one container, not one per
worker) while removing the manual step that already failed once.

**If you install a host cron/systemd timer instead, remove the compose service**
— pick one, not several. Two triggers are harmless in effect (the DELETE is
idempotent), but they leave two places to reason about.

The loop is deliberately crash-resistant: a purge that raises must not kill the
container, or one transient DB blip becomes a silent permanent stop — precisely
the failure mode the canary exists to catch.
"""

import sys
import tempfile
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import delete, func, select

from data.config import settings
from data.db import sync_session
from data.models import Error, Session, UserConversion

# One day. The retention window is 30 days, so the exact hour is irrelevant —
# what matters is that it runs unattended, often enough that the oldest row
# never drifts far past the promise.
DEFAULT_INTERVAL_SECONDS = 24 * 60 * 60

# Retry sooner than a full interval after a failure, so a container that starts
# before the API has applied migrations doesn't sit idle for a whole day.
FAILURE_RETRY_SECONDS = 60

# The purge runs daily, so a row may legitimately outlive the window by up to
# one interval. Two days of slack keeps the canary quiet in normal operation
# while still firing long before the promise is visibly broken.
CANARY_GRACE_DAYS = 2

# Touched once per loop iteration (success or handled failure) so the
# container's HEALTHCHECK (docker-compose.yml) can tell "still cycling" apart
# from "hung inside _run_once() and never coming back" — the two look
# identical from outside (process alive, no crash) without this file's mtime.
# tempfile.gettempdir() rather than a bare "/tmp" — resolves to /tmp inside
# the Linux container (where the healthcheck also looks), but stays portable
# for tests running on any other platform.
HEARTBEAT_PATH = Path(tempfile.gettempdir()) / "purge-heartbeat"


def purge_expired() -> dict[str, int]:
    """Delete stale history/errors and expired sessions. Returns counts."""
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=settings.retention_days)
    counts: dict[str, int] = {}
    with sync_session() as db:
        counts["user_conversions"] = db.execute(
            delete(UserConversion).where(UserConversion.created_at < cutoff)
        ).rowcount
        counts["errors"] = db.execute(
            delete(Error).where(Error.created_at < cutoff)
        ).rowcount
        counts["sessions"] = db.execute(
            delete(Session).where(Session.expires_at < now)
        ).rowcount
    return counts


def retention_canary(grace_days: int = CANARY_GRACE_DAYS) -> dict:
    """Is the retention promise actually being kept? (P19 staleness canary.)

    A failing purge is **silent**: nothing errors, rows simply accumulate while
    the privacy page keeps promising they were deleted. So check the claim from
    the outside — the oldest ``user_conversions`` row must not be older than the
    retention window plus one interval of slack.

    Returns ``ok`` plus enough detail to put in an alert. An empty table is
    healthy, not unknown: there is nothing that failed to be deleted.
    """
    limit_days = settings.retention_days + grace_days
    with sync_session() as db:
        oldest = db.execute(select(func.min(UserConversion.created_at))).scalar()
    if oldest is None:
        return {"ok": True, "oldest_age_days": None, "limit_days": limit_days}
    # Stored as timestamptz, but a naive value would raise on subtraction —
    # normalise rather than let the canary itself crash.
    if oldest.tzinfo is None:
        oldest = oldest.replace(tzinfo=UTC)
    age_days = (datetime.now(UTC) - oldest).total_seconds() / 86400
    return {
        "ok": age_days <= limit_days,
        "oldest_age_days": round(age_days, 2),
        "limit_days": limit_days,
    }


def _run_once() -> None:
    counts = purge_expired()
    print(
        "purge complete: " + ", ".join(f"{k}={v}" for k, v in counts.items()),
        flush=True,
    )


def _run_loop(interval: int) -> int:
    print(f"purge loop started: every {interval}s", flush=True)
    while True:
        try:
            _run_once()
            sleep_for = interval
        except Exception as exc:  # noqa: BLE001 — must survive to the next run
            # Never re-raise: exiting stops all future purges, and the failure
            # would stay invisible until the canary fires days later.
            print(f"purge failed ({exc.__class__.__name__}: {exc})", flush=True)
            sleep_for = min(FAILURE_RETRY_SECONDS, interval)
        HEARTBEAT_PATH.write_text(datetime.now(UTC).isoformat())
        time.sleep(sleep_for)


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else ""

    if cmd == "canary":
        result = retention_canary()
        status = "ok" if result["ok"] else "RETENTION VIOLATED"
        print(
            f"retention canary: {status} "
            f"(oldest={result['oldest_age_days']}d, limit={result['limit_days']}d)"
        )
        return 0 if result["ok"] else 1

    if cmd == "purge":
        if "--loop" in argv:
            interval = DEFAULT_INTERVAL_SECONDS
            if "--interval-seconds" in argv:
                interval = int(argv[argv.index("--interval-seconds") + 1])
            return _run_loop(interval)
        _run_once()
        return 0

    print(
        "usage: python -m data.tasks purge [--loop [--interval-seconds N]]\n"
        "       python -m data.tasks canary"
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
