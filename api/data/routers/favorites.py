"""Favorites — session-guarded add/remove/list (§9)."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from data.db import get_session
from data.models import UserFavorite
from data.security import require_user

router = APIRouter(prefix="/api/v1/favorites", tags=["favorites"])

# The favorites list is user-writable, unbounded, and joined into EVERY /me
# response — so without a cap one account can inflate the payload on every page
# load site-wide. 100 is far above any genuine use (the catalogue is ~34 tools)
# while still bounding the blast radius of a scripted client.
MAX_FAVORITES = 100


class FavoriteBody(BaseModel):
    tool_id: str


@router.get("")
async def list_favorites(
    user=Depends(require_user),
    db: AsyncSession = Depends(get_session),
):
    rows = (
        (
            await db.execute(
                select(UserFavorite.tool_id).where(UserFavorite.user_id == user.id)
            )
        )
        .scalars()
        .all()
    )
    return {"favorites": list(rows)}


@router.post("")
async def add_favorite(
    body: FavoriteBody,
    user=Depends(require_user),
    db: AsyncSession = Depends(get_session),
):
    # Checked before the insert, which is ON CONFLICT DO NOTHING — so re-favoriting
    # something already saved stays a no-op rather than failing at the cap.
    existing = (
        await db.execute(
            select(func.count())
            .select_from(UserFavorite)
            .where(UserFavorite.user_id == user.id)
        )
    ).scalar_one()
    already = (
        await db.execute(
            select(UserFavorite.tool_id).where(
                UserFavorite.user_id == user.id, UserFavorite.tool_id == body.tool_id
            )
        )
    ).scalar_one_or_none()
    if already is None and existing >= MAX_FAVORITES:
        raise HTTPException(
            status_code=409,
            detail=f"Favorites limit reached ({MAX_FAVORITES}). Remove one to add another.",
        )

    stmt = (
        pg_insert(UserFavorite)
        .values(user_id=user.id, tool_id=body.tool_id)
        .on_conflict_do_nothing(
            index_elements=[UserFavorite.user_id, UserFavorite.tool_id]
        )
    )
    await db.execute(stmt)
    await db.commit()
    return {"ok": True}


@router.delete("/{tool_id}")
async def remove_favorite(
    tool_id: str,
    user=Depends(require_user),
    db: AsyncSession = Depends(get_session),
):
    await db.execute(
        delete(UserFavorite).where(
            UserFavorite.user_id == user.id, UserFavorite.tool_id == tool_id
        )
    )
    await db.commit()
    return {"ok": True}
