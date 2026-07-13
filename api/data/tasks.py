"""30-day purge — management command only in Phase 1 (§12).

Deletes stale ``user_conversions`` and ``errors`` rows (retention promise D5 —
actually DELETE, not filter-on-read) and expired ``sessions``. Anonymous
aggregates (``conversions``) and anonymous ``ratings`` are retained. Idempotent.

Run one-shot:  ``python -m data.tasks purge``  (from ``api/``, or via
``docker compose exec api python -m data.tasks purge``). Scheduling is deferred
to Phase 7 — Phase 1 deliberately runs no scheduler (§16-R6).
"""

import sys
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete

from data.config import settings
from data.db import sync_session
from data.models import Error, Session, UserConversion


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


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] != "purge":
        print("usage: python -m data.tasks purge")
        return 2
    counts = purge_expired()
    print("purge complete: " + ", ".join(f"{k}={v}" for k, v in counts.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
