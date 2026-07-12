"""Rating routes — server-side dedup (§9, Phase 6 §7 contract).

``vote`` is the literal string ``'yes'``/``'no'`` (``yes`` = "found this
helpful"). Dedup via ``UNIQUE(tool_id, fingerprint)`` upsert — a second vote from
the same (daily, per-tool) fingerprint updates the existing row rather than
adding a new one, so totals don't inflate. Threshold display is client-side
(Phase 6); the API returns raw totals.

Pinned shapes: ``POST /ratings`` body ``{tool_id, vote}``;
``GET /ratings/{tool_id}`` → ``{tool_id, yes, no}``;
``GET /ratings`` (admin) → ``[{tool_id, yes, no}, …]``.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from data.db import get_session
from data.fingerprint import compute_fingerprint
from data.models import Rating
from data.security import current_user, require_admin

router = APIRouter(prefix="/api/v1/ratings", tags=["ratings"])


class RatingBody(BaseModel):
    tool_id: str
    vote: str  # 'yes' | 'no'


@router.post("")
async def submit_rating(
    body: RatingBody,
    request: Request,
    db: AsyncSession = Depends(get_session),
    user=Depends(current_user),
):
    if body.vote not in ("yes", "no"):
        raise HTTPException(status_code=400, detail="vote must be 'yes' or 'no'")

    fingerprint = compute_fingerprint(request, body.tool_id)
    stmt = pg_insert(Rating).values(
        tool_id=body.tool_id,
        vote=body.vote,
        fingerprint=fingerprint,
        user_id=(user.id if user is not None else None),
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_ratings_tool_fingerprint",
        set_={"vote": body.vote},
    )
    await db.execute(stmt)
    await db.commit()
    return {"ok": True}


@router.get("")
async def all_ratings(
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    rows = (
        await db.execute(
            select(Rating.tool_id, Rating.vote, func.count().label("n")).group_by(
                Rating.tool_id, Rating.vote
            )
        )
    ).all()
    agg: dict[str, dict[str, int]] = {}
    for tool_id, vote, n in rows:
        bucket = agg.setdefault(tool_id, {"yes": 0, "no": 0})
        if vote in ("yes", "no"):
            bucket[vote] += n
    return [{"tool_id": tid, "yes": v["yes"], "no": v["no"]} for tid, v in agg.items()]


@router.get("/{tool_id}")
async def tool_ratings(
    tool_id: str,
    db: AsyncSession = Depends(get_session),
):
    rows = (
        await db.execute(
            select(Rating.vote, func.count().label("n"))
            .where(Rating.tool_id == tool_id)
            .group_by(Rating.vote)
        )
    ).all()
    counts = {"yes": 0, "no": 0}
    for vote, n in rows:
        if vote in ("yes", "no"):
            counts[vote] += n
    return {"tool_id": tool_id, "yes": counts["yes"], "no": counts["no"]}
