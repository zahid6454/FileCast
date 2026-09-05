"""Admin dashboard stats — §9. All admin-guarded."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from data.db import get_session
from data.models import Conversion, Error, Rating, User
from data.security import require_admin

router = APIRouter(prefix="/api/v1/stats", tags=["stats"])


@router.get("/dashboard")
async def dashboard(
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    total_conversions = (
        await db.execute(select(func.coalesce(func.sum(Conversion.count), 0)))
    ).scalar_one()
    total_failures = (
        await db.execute(select(func.coalesce(func.sum(Conversion.failures), 0)))
    ).scalar_one()
    total_users = (await db.execute(select(func.count(User.id)))).scalar_one()
    total_ratings = (await db.execute(select(func.count(Rating.id)))).scalar_one()
    yes_ratings = (
        await db.execute(select(func.count(Rating.id)).where(Rating.vote == "yes"))
    ).scalar_one()
    # Summed across days, so a returning visitor on two different days counts
    # twice here — a reach estimate, not a lifetime distinct-visitor count.
    total_unique_visitors = (
        await db.execute(select(func.coalesce(func.sum(Conversion.unique_visitors), 0)))
    ).scalar_one()

    # Top tools by all-time count.
    top_tools = (
        await db.execute(
            select(
                Conversion.tool_id,
                func.sum(Conversion.count).label("n"),
                func.sum(Conversion.unique_visitors).label("visitors"),
            )
            .group_by(Conversion.tool_id)
            .order_by(func.sum(Conversion.count).desc())
            .limit(10)
        )
    ).all()

    return {
        "total_conversions": int(total_conversions),
        "total_failures": int(total_failures),
        "total_users": int(total_users),
        "total_ratings": int(total_ratings),
        "yes_ratings": int(yes_ratings),
        "total_unique_visitors": int(total_unique_visitors),
        "top_tools": [
            {"tool_id": t, "count": int(n), "visitors": int(v)} for t, n, v in top_tools
        ],
    }


@router.get("/tools")
async def all_tool_conversions(
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    """All-time per-tool conversion aggregate, every tool (not just top 10) —
    lets the tools-tab slide-out show a single tool's usage without a
    per-tool call (mirrors ratings.py's bulk `GET /ratings`)."""
    rows = (
        await db.execute(
            select(
                Conversion.tool_id,
                func.sum(Conversion.count).label("count"),
                func.sum(Conversion.failures).label("failures"),
                func.sum(Conversion.unique_visitors).label("visitors"),
            ).group_by(Conversion.tool_id)
        )
    ).all()
    return [
        {"tool_id": t, "count": int(c), "failures": int(f), "unique_visitors": int(v)}
        for t, c, f, v in rows
    ]


@router.get("/conversions")
async def conversions_series(
    days: int = 30,
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    days = max(1, min(days, 365))
    since = (datetime.now(UTC) - timedelta(days=days)).date()
    rows = (
        await db.execute(
            select(
                Conversion.date,
                func.sum(Conversion.count).label("count"),
                func.sum(Conversion.failures).label("failures"),
            )
            .where(Conversion.date >= since)
            .group_by(Conversion.date)
            .order_by(Conversion.date)
        )
    ).all()
    return {
        "days": days,
        "series": [
            {"date": d.isoformat(), "count": int(c), "failures": int(f)}
            for d, c, f in rows
        ],
    }


@router.get("/errors")
async def recent_errors(
    limit: int = 25,
    offset: int = 0,
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    # id as a tiebreaker: created_at is a server_default now(), which two
    # errors reported in quick succession can land on the same microsecond,
    # otherwise leaving ties in an arbitrary (and test-flaky) DB-chosen order.
    stmt = (
        select(Error, func.count().over().label("total"))
        .order_by(Error.created_at.desc(), Error.id.desc())
        .offset(offset)
        .limit(limit + 1)
    )
    result = list(await db.execute(stmt))
    total = result[0].total if result else 0
    rows = [r[0] for r in result]
    has_more = len(rows) > limit
    rows = rows[:limit]
    return {
        "errors": [
            {
                "id": e.id,
                "tool_id": e.tool_id,
                "error_type": e.error_type,
                "error_message": e.error_message,
                "browser": e.browser,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in rows
        ],
        "total": total,
        "has_more": has_more,
    }
