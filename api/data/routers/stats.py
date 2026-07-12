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

    # Top tools by all-time count.
    top_tools = (
        await db.execute(
            select(Conversion.tool_id, func.sum(Conversion.count).label("n"))
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
        "top_tools": [{"tool_id": t, "count": int(n)} for t, n in top_tools],
    }


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
    limit: int = 50,
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    limit = max(1, min(limit, 500))
    rows = (
        (await db.execute(select(Error).order_by(Error.created_at.desc()).limit(limit)))
        .scalars()
        .all()
    )
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
        ]
    }
