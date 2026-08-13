"""User conversion history — session-guarded (§9).

Route is ``GET /api/v1/user/history`` (per the ledger API surface), distinct from
the admin ``/users`` prefix.
"""

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from data.db import get_session
from data.models import UserConversion
from data.security import require_user

router = APIRouter(prefix="/api/v1/user", tags=["history"])


@router.get("/history")
async def my_history(
    response: Response,
    limit: int = 100,
    offset: int = 0,
    user=Depends(require_user),
    db: AsyncSession = Depends(get_session),
):
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    # Fetch one extra row to know whether a next page exists, without a separate
    # COUNT(*) round trip — `total` (for "Page 2 of 5" + the account-page stat
    # tile) rides along on every row via a window function instead.
    result = list(
        await db.execute(
            select(UserConversion, func.count().over().label("total"))
            .where(UserConversion.user_id == user.id)
            .order_by(UserConversion.created_at.desc())
            .offset(offset)
            .limit(limit + 1)
        )
    )
    total = result[0].total if result else 0
    rows = [r[0] for r in result]
    has_more = len(rows) > limit
    rows = rows[:limit]
    # Same private, short-TTL, session-partitioned caching as /me (auth.py) —
    # personal data re-fetched on every /account/ load with nothing to
    # invalidate it, so a few seconds of staleness buys back a round trip on
    # rapid re-navigation without meaningfully hiding a fresh conversion.
    response.headers["Cache-Control"] = "private, max-age=5"
    response.headers["Vary"] = "Cookie"
    return {
        "has_more": has_more,
        "total": total,
        "history": [
            {
                "id": r.id,
                "tool_id": r.tool_id,
                "input_format": r.input_format,
                "output_format": r.output_format,
                "file_size_kb": r.file_size_kb,
                "duration_ms": r.duration_ms,
                "status": r.status,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }
