"""Announcement routes — §9.

Only one active at a time (enforced on activate). The literal
``/announcements/active`` route is declared **before** ``/announcements/{id}`` or
the path param shadows it and ``active`` is parsed as an id (admin-panel C3).
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, field_validator
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from data.db import get_session
from data.models import Announcement
from data.security import require_admin

router = APIRouter(prefix="/api/v1/announcements", tags=["announcements"])

# Length cap — this renders into the site-wide announcement bar on every page.
MESSAGE_MAX = 500
# Generous but bounded; this is a URL, not free text.
LINK_MAX = 2048
# Must match the CSS variants in style.css (.announcement-bar--<type>) and the
# TYPES list in static/js/admin/announcements.js — an unrecognized type falls
# back to unstyled on the admin preview but would render unstyled on every
# live page too, so it's rejected server-side rather than left to that fallback.
ANNOUNCEMENT_TYPES = {"info", "new", "maintenance", "warning"}


def _validate_message(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("message must not be empty")
    if len(v) > MESSAGE_MAX:
        raise ValueError(f"message must be ≤ {MESSAGE_MAX} characters")
    return v


def _validate_type(v: str) -> str:
    if v not in ANNOUNCEMENT_TYPES:
        raise ValueError(f"type must be one of {sorted(ANNOUNCEMENT_TYPES)}")
    return v


def _validate_link(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    if not v:
        return None
    if len(v) > LINK_MAX:
        raise ValueError(f"link must be ≤ {LINK_MAX} characters")
    return v


class AnnouncementBody(BaseModel):
    message: str
    link: str | None = None
    type: str = "info"
    active: bool = False
    starts_at: datetime | None = None
    ends_at: datetime | None = None

    @field_validator("message")
    @classmethod
    def _message(cls, v: str) -> str:
        return _validate_message(v)

    @field_validator("type")
    @classmethod
    def _type(cls, v: str) -> str:
        return _validate_type(v)

    @field_validator("link")
    @classmethod
    def _link(cls, v: str | None) -> str | None:
        return _validate_link(v)


class AnnouncementUpdate(BaseModel):
    message: str | None = None
    link: str | None = None
    type: str | None = None
    active: bool | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None

    @field_validator("message")
    @classmethod
    def _message(cls, v: str | None) -> str | None:
        return _validate_message(v) if v is not None else v

    @field_validator("type")
    @classmethod
    def _type(cls, v: str | None) -> str | None:
        return _validate_type(v) if v is not None else v

    @field_validator("link")
    @classmethod
    def _link(cls, v: str | None) -> str | None:
        return _validate_link(v)


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
async def active_announcement(
    response: Response, db: AsyncSession = Depends(get_session)
):
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
    # Public, identical for every visitor, and hit on every single page load
    # (nav.js) — only changes when an admin edits it, so a short public cache
    # eliminates a DB round trip on nearly every page view.
    response.headers["Cache-Control"] = "public, max-age=60"
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
