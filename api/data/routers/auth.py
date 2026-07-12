"""Auth routes — dev-login (stub), /me, logout (§8).

Google OAuth (``/auth/google``, ``/callback``) lands in Phase 5 via the same
``create_session()`` seam.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from data.config import settings
from data.db import get_session
from data.models import UserFavorite
from data.routers._serialize import user_dict
from data.security import (
    create_session,
    destroy_session,
    get_or_create_dev_user,
    require_user,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class DevLoginBody(BaseModel):
    role: str = "user"


async def _favorites_for(db: AsyncSession, user_id: str) -> list[str]:
    rows = (
        (
            await db.execute(
                select(UserFavorite.tool_id).where(UserFavorite.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


@router.post("/dev-login")
async def dev_login(
    body: DevLoginBody,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_session),
):
    # Gated: 404 unless running in development (§8).
    if settings.environment != "development":
        raise HTTPException(status_code=404, detail="Not found")
    if body.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="role must be 'admin' or 'user'")

    user = await get_or_create_dev_user(db, body.role)
    await create_session(db, user, response, request)
    await db.commit()
    favorites = await _favorites_for(db, user.id)
    return {"user": user_dict(user, favorites)}


@router.get("/me")
async def me(
    user=Depends(require_user),
    db: AsyncSession = Depends(get_session),
):
    favorites = await _favorites_for(db, user.id)
    return {"user": user_dict(user, favorites)}


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_session),
):
    await destroy_session(db, request, response)
    await db.commit()
    return {"ok": True}
