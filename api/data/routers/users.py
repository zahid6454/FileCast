"""User routes — admin list/detail + GDPR self-export/delete (§9).

The literal ``/users/me/...`` routes are declared before ``/users/{user_id}``.
``DELETE /users/me`` wipes all of the caller's data in one transaction.
"""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from data.db import get_session
from data.models import (
    Rating,
    Session,
    StaffGrant,
    User,
    UserConversion,
    UserFavorite,
    UserPreference,
)
from data.routers._serialize import user_dict
from data.security import clear_session_cookies, require_admin, require_user

router = APIRouter(prefix="/api/v1/users", tags=["users"])


async def _history_rows(
    db: AsyncSession, user_id: str, limit: int | None = 100, offset: int = 0
) -> list[dict]:
    # limit=None → every row (GDPR export must be complete, not truncated).
    query = (
        select(UserConversion)
        .where(UserConversion.user_id == user_id)
        .order_by(UserConversion.created_at.desc())
        .offset(offset)
    )
    if limit is not None:
        query = query.limit(limit)
    rows = (await db.execute(query)).scalars().all()
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
        "history": await _history_rows(db, user.id, limit=None),
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
    # Phase 5.5: clear any staff grant keyed to this email (clean slate on erase).
    # The FK on staff_grants.granted_by is ON DELETE SET NULL, so grants this user
    # *issued* survive with a null granter.
    await db.execute(
        delete(StaffGrant).where(StaffGrant.email == func.lower(user.email))
    )
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
        "history": await _history_rows(db, user_id, limit=10),
    }


@router.get("/{user_id}/history")
async def user_history(
    user_id: str,
    limit: int = 10,
    offset: int = 0,
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    """Paginated conversion history for an admin viewing a user (10/page)."""
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    # limit+1 to detect a next page without a COUNT(*).
    rows = await _history_rows(db, user_id, limit=limit + 1, offset=offset)
    return {"has_more": len(rows) > limit, "history": rows[:limit]}
