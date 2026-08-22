"""Contact page messages — public submission + admin inbox.

``POST /messages`` is public and optionally-authenticated (mirrors
``ratings.py``'s vote endpoint): a signed-in sender gets ``user_id``
attached, an anonymous one can leave an optional ``email`` instead so
support has a way to reply. Retained, never purged — see the ``Message``
model docstring.

Bot mitigation is deliberately simple, matching this codebase's existing
posture (rate limiting + free-text length ceilings, no CAPTCHA): a honeypot
field (``website``) that real users never see or fill. A tripped honeypot
returns the same ``{"ok": True}`` as a real submission — never reveal to a
bot that it was caught, or it just adjusts and retries.
"""

import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from data.db import get_session
from data.models import Message
from data.security import current_user, require_admin

router = APIRouter(prefix="/api/v1", tags=["messages"])

_MAX_TITLE = 200
_MAX_BODY = 5000
# RFC 5321's own hard ceiling on a full email address — a regex-matching
# string with no length bound would otherwise let title/body's truncation
# discipline get bypassed through this field instead.
_MAX_EMAIL = 320
_VALID_STATUSES = {"new", "read"}

# Same permissive pattern as staff.py's invite email check — reject obvious
# junk, not attempt real deliverability validation.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class MessageBody(BaseModel):
    title: str
    body: str
    email: str | None = None
    # Honeypot — left blank by real users, filled by naive bots that
    # auto-fill every field in a form.
    website: str | None = None


@router.post("/messages")
async def submit_message(
    body: MessageBody,
    request: Request,
    db: AsyncSession = Depends(get_session),
    user=Depends(current_user),
):
    if body.website:
        return {"ok": True}

    title = body.title.strip()
    text = body.body.strip()
    if not title or not text:
        raise HTTPException(status_code=400, detail="title and body must not be empty")

    email = (body.email or "").strip() or None
    if email is not None and (len(email) > _MAX_EMAIL or not _EMAIL_RE.match(email)):
        raise HTTPException(status_code=400, detail="Malformed email")

    db.add(
        Message(
            title=title[:_MAX_TITLE],
            body=text[:_MAX_BODY],
            email=email,
            user_id=(user.id if user is not None else None),
            user_agent=(request.headers.get("user-agent") or "")[:512] or None,
        )
    )
    await db.commit()
    return {"ok": True}


def _message_dict(m: Message) -> dict:
    return {
        "id": m.id,
        "title": m.title,
        "body": m.body,
        "email": m.email,
        "user_id": m.user_id,
        "user_agent": m.user_agent,
        "status": m.status,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


@router.get("/admin/messages")
async def list_messages(
    status: str | None = None,
    limit: int = 25,
    offset: int = 0,
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    # id as a tiebreaker: created_at is a server_default now(), which two
    # requests in quick succession can land on the same microsecond,
    # otherwise leaving ties in an arbitrary (and test-flaky) DB-chosen order.
    stmt = (
        select(Message, func.count().over().label("total"))
        .order_by(Message.created_at.desc(), Message.id.desc())
        .offset(offset)
        .limit(limit + 1)
    )
    if status is not None:
        if status not in _VALID_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        stmt = stmt.where(Message.status == status)
    result = list(await db.execute(stmt))
    if result:
        total = result[0].total
    else:
        count_stmt = select(func.count()).select_from(Message)
        if status is not None:
            count_stmt = count_stmt.where(Message.status == status)
        total = (await db.execute(count_stmt)).scalar_one()
    rows = [r[0] for r in result]
    has_more = len(rows) > limit
    rows = rows[:limit]
    return {
        "messages": [_message_dict(m) for m in rows],
        "total": total,
        "has_more": has_more,
    }


@router.get("/admin/messages/counts")
async def message_counts(
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    # Independent of whatever status filter the inbox view has active — the
    # unread/read totals badge always reflects the whole inbox.
    stmt = select(Message.status, func.count()).group_by(Message.status)
    counts = {"new": 0, "read": 0}
    for status, count in await db.execute(stmt):
        counts[status] = count
    return counts


class StatusBody(BaseModel):
    status: str


@router.put("/admin/messages/{message_id}")
async def update_message_status(
    message_id: int,
    body: StatusBody,
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    if body.status not in _VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    message = await db.get(Message, message_id)
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found")
    message.status = body.status
    await db.commit()
    return _message_dict(message)
