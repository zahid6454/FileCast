"""User preferences — session-guarded upsert (§9).

Stores the ``{display_name, email_updates, jpeg_quality, pdf_compression,
theme}`` JSON blob; the body is merged over existing prefs. Input is bounded by
a key allowlist + a size cap so an authenticated user can't stash arbitrary
megabyte JSONB blobs (also rate-limited via ``PATH_LIMITS``).
"""

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from data.db import get_session
from data.models import UserPreference
from data.security import require_user

router = APIRouter(prefix="/api/v1/preferences", tags=["preferences"])

# The documented preference shape (§9). Phase 5 extends this allowlist when it
# adds new preference keys; unknown keys are rejected rather than silently stored.
ALLOWED_KEYS = {
    "display_name",
    "email_updates",
    "jpeg_quality",
    "pdf_compression",
    "theme",
}
MAX_PREF_BYTES = 4096


@router.put("")
async def update_preferences(
    body: dict,
    user=Depends(require_user),
    db: AsyncSession = Depends(get_session),
):
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="preferences must be an object")
    unknown = set(body) - ALLOWED_KEYS
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=f"unknown preference keys: {sorted(unknown)}",
        )
    if len(json.dumps(body)) > MAX_PREF_BYTES:
        raise HTTPException(status_code=413, detail="preferences payload too large")

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
