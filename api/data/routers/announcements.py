"""Announcement routes — §9.

Only one active at a time (enforced on activate). The literal
``/announcements/active`` route is declared **before** ``/announcements/{id}`` or
the path param shadows it and ``active`` is parsed as an id (admin-panel C3).
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from data.db import get_session
from data.models import Announcement
from data.security import require_admin

router = APIRouter(prefix="/api/v1/announcements", tags=["announcements"])


class AnnouncementBody(BaseModel):
    message: str
    link: str | None = None
    type: str = "info"
    active: bool = False
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class AnnouncementUpdate(BaseModel):
    message: str | None = None
    link: str | None = None
    type: str | None = None
    active: bool | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None


def _dict(a: Announcement) -> dict:
    return {
        "id": a.id,
        "message": a.message,
        "link": a.link,
        "type": a.type,
        "active": a.active,
        "starts_at": a.starts_at.isoformat() if a.starts_at else None,
        "ends_at": a.ends_at.isoformat() if a.ends_at else None,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


async def _deactivate_others(db: AsyncSession, keep_id: int | None) -> None:
    stmt = update(Announcement).values(active=False)
    if keep_id is not None:
        stmt = stmt.where(Announcement.id != keep_id)
    await db.execute(stmt)


@router.get("/active")
async def active_announcement(db: AsyncSession = Depends(get_session)):
    now = datetime.now(UTC)
    rows = (
        (
            await db.execute(
                select(Announcement)
                .where(Announcement.active.is_(True))
                .order_by(Announcement.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    for a in rows:
        if a.starts_at and a.starts_at > now:
            continue
        if a.ends_at and a.ends_at < now:
            continue
        return {"announcement": _dict(a)}
    return {"announcement": None}


@router.get("")
async def list_announcements(
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    rows = (
        (
            await db.execute(
                select(Announcement).order_by(Announcement.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return {"announcements": [_dict(a) for a in rows]}


@router.post("")
async def create_announcement(
    body: AnnouncementBody,
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    a = Announcement(**body.model_dump())
    db.add(a)
    await db.flush()
    if a.active:
        await _deactivate_others(db, keep_id=a.id)
    await db.commit()
    await db.refresh(a)
    return {"announcement": _dict(a)}


@router.put("/{announcement_id}")
async def update_announcement(
    announcement_id: int,
    body: AnnouncementUpdate,
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    a = (
        await db.execute(select(Announcement).where(Announcement.id == announcement_id))
    ).scalar_one_or_none()
    if a is None:
        raise HTTPException(status_code=404, detail="Announcement not found")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(a, key, value)
    if a.active:
        await _deactivate_others(db, keep_id=a.id)
    await db.commit()
    await db.refresh(a)
    return {"announcement": _dict(a)}


@router.delete("/{announcement_id}")
async def delete_announcement(
    announcement_id: int,
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    a = (
        await db.execute(select(Announcement).where(Announcement.id == announcement_id))
    ).scalar_one_or_none()
    if a is None:
        raise HTTPException(status_code=404, detail="Announcement not found")
    await db.delete(a)
    await db.commit()
    return {"ok": True}
