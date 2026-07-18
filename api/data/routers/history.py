"""User conversion history — session-guarded (§9).

Route is ``GET /api/v1/user/history`` (per the ledger API surface), distinct from
the admin ``/users`` prefix.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from data.db import get_session
from data.models import UserConversion
from data.security import require_user

router = APIRouter(prefix="/api/v1/user", tags=["history"])


@router.get("/history")
async def my_history(
    limit: int = 100,
    offset: int = 0,
    user=Depends(require_user),
    db: AsyncSession = Depends(get_session),
):
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    # Fetch one extra row to know whether a next page exists, without a COUNT(*).
    rows = list(
        (
            await db.execute(
                select(UserConversion)
                .where(UserConversion.user_id == user.id)
                .order_by(UserConversion.created_at.desc())
                .offset(offset)
                .limit(limit + 1)
            )
        )
        .scalars()
        .all()
    )
    has_more = len(rows) > limit
    rows = rows[:limit]
    return {
        "has_more": has_more,
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
        ]
    }
