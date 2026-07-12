"""User preferences — session-guarded upsert (§9).

Stores the ``{display_name, email_updates, jpeg_quality, pdf_compression,
theme}`` JSON blob; the body is merged over existing prefs.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from data.db import get_session
from data.models import UserPreference
from data.security import require_user

router = APIRouter(prefix="/api/v1/preferences", tags=["preferences"])


@router.put("")
async def update_preferences(
    body: dict,
    user=Depends(require_user),
    db: AsyncSession = Depends(get_session),
):
    row = (
        await db.execute(
            select(UserPreference).where(UserPreference.user_id == user.id)
        )
    ).scalar_one_or_none()
    if row is None:
        row = UserPreference(user_id=user.id, preferences=dict(body))
        db.add(row)
    else:
        merged = dict(row.preferences or {})
        merged.update(body)
        row.preferences = merged
    await db.commit()
    await db.refresh(row)
    return {"preferences": row.preferences}
