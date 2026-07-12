"""Integration — 30-day purge deletes stale rows, retains anonymous data (D5)."""

from datetime import UTC, datetime, timedelta

from data.models import (
    Conversion,
    Error,
    Rating,
    Session,
    User,
    UserConversion,
)
from data.tasks import purge_expired
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
