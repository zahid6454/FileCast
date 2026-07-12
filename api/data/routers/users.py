"""User routes — admin list/detail + GDPR self-export/delete (§9).

The literal ``/users/me/...`` routes are declared before ``/users/{user_id}``.
``DELETE /users/me`` wipes all of the caller's data in one transaction.
"""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from data.db import get_session
from data.models import (
    Rating,
    Session,
    User,
    UserConversion,
    UserFavorite,
    UserPreference,
)
from data.routers._serialize import user_dict
from data.security import clear_session_cookies, require_admin, require_user

router = APIRouter(prefix="/api/v1/users", tags=["users"])


async def _history_rows(db: AsyncSession, user_id: str, limit: int = 100) -> list[dict]:
    rows = (
        (
            await db.execute(
                select(UserConversion)
                .where(UserConversion.user_id == user_id)
                .order_by(UserConversion.created_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [
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


@router.get("/me/export")
async def export_my_data(
    user=Depends(require_user),
    db: AsyncSession = Depends(get_session),
):
    favorites = (
        await db.execute(
            select(UserFavorite.tool_id, UserFavorite.created_at).where(
                UserFavorite.user_id == user.id
            )
        )
    ).all()
    prefs = (
        await db.execute(
            select(UserPreference.preferences).where(UserPreference.user_id == user.id)
        )
    ).scalar_one_or_none()
    return {
        "user": user_dict(user),
        "preferences": prefs or {},
        "favorites": [
            {"tool_id": t, "created_at": c.isoformat() if c else None}
            for t, c in favorites
        ],
        "history": await _history_rows(db, user.id, limit=10000),
    }


@router.delete("/me")
async def delete_my_account(
    response: Response,
    user=Depends(require_user),
    db: AsyncSession = Depends(get_session),
):
    uid = user.id
    # Anonymous ratings are retained; just detach the user_id.
    await db.execute(update(Rating).where(Rating.user_id == uid).values(user_id=None))
    await db.execute(delete(UserConversion).where(UserConversion.user_id == uid))
    await db.execute(delete(UserFavorite).where(UserFavorite.user_id == uid))
    await db.execute(delete(UserPreference).where(UserPreference.user_id == uid))
    await db.execute(delete(Session).where(Session.user_id == uid))
    await db.execute(delete(User).where(User.id == uid))
    await db.commit()
    clear_session_cookies(response)
    return {"ok": True}


@router.get("")
async def list_users(
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    rows = (
        (await db.execute(select(User).order_by(User.created_at.desc())))
        .scalars()
        .all()
    )
    return {"users": [user_dict(u) for u in rows]}


@router.get("/{user_id}")
async def user_detail(
    user_id: str,
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    favorites = (
        (
            await db.execute(
                select(UserFavorite.tool_id).where(UserFavorite.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )
    return {
        "user": user_dict(user, list(favorites)),
        "history": await _history_rows(db, user_id),
    }
