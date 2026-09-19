"""Admin dashboard stats — §9. All admin-guarded."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from data.config import settings
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

    return {
        "total_conversions": int(total_conversions),
        "total_failures": int(total_failures),
        "total_users": int(total_users),
        "total_ratings": int(total_ratings),
        "yes_ratings": int(yes_ratings),
        "total_unique_visitors": int(total_unique_visitors),
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
    group_by: str = "day",
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    days = max(1, min(days, 365))
    since = (datetime.now(UTC) - timedelta(days=days)).date()
    # to_char formats straight to the plain YYYY-MM/YYYY-MM-DD string the
    # frontend wants, so there's no midnight-timestamp round-trip to re-parse
    # (a raw date_trunc('month', ...) on a Date column implicit-casts to a
    # timestamp, which isn't what the chart wants either).
    bucket = func.to_char(
        Conversion.date, "YYYY-MM" if group_by == "month" else "YYYY-MM-DD"
    ).label("bucket")
    rows = (
        await db.execute(
            select(
                bucket,
                func.sum(Conversion.count).label("count"),
                func.sum(Conversion.failures).label("failures"),
            )
            .where(Conversion.date >= since)
            .group_by(bucket)
            .order_by(bucket)
        )
    ).all()
    return {
        "days": days,
        "series": [
            {"date": b, "count": int(c), "failures": int(f)} for b, c, f in rows
        ],
    }


@router.get("/top-tools")
async def top_tools(
    days: int = 30,
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    """Top tools ranked within the selected window — replaces the old
    all-time top_tools field on GET /dashboard (§9.1). Not tool-filterable
    by design: it's a cross-tool ranking, so scoping it to one tool would
    just show that tool alone with nothing to rank against."""
    days = max(1, min(days, 365))
    since = (datetime.now(UTC) - timedelta(days=days)).date()
    rows = (
        await db.execute(
            select(
                Conversion.tool_id,
                func.sum(Conversion.count).label("n"),
                func.sum(Conversion.unique_visitors).label("visitors"),
            )
            .where(Conversion.date >= since)
            .group_by(Conversion.tool_id)
            .order_by(func.sum(Conversion.count).desc())
            .limit(10)
        )
    ).all()
    return {
        "days": days,
        "top_tools": [
            {"tool_id": t, "count": int(n), "visitors": int(v)} for t, n, v in rows
        ],
    }


@router.get("/signups")
async def signups_series(
    days: int = 30,
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    """Daily new-signup counts from User.created_at — never purged, so this
    (unlike the Errors card) can honestly support the full 7d-12mo range."""
    days = max(1, min(days, 365))
    since = datetime.now(UTC) - timedelta(days=days)
    bucket = func.to_char(User.created_at, "YYYY-MM-DD").label("bucket")
    rows = (
        await db.execute(
            select(bucket, func.count().label("n"))
            .where(User.created_at >= since)
            .group_by(bucket)
            .order_by(bucket)
        )
    ).all()
    return [{"date": d, "count": int(n)} for d, n in rows]


@router.get("/errors/summary")
async def errors_summary(
    days: int = 30,
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    """Type + by-tool breakdown of client-reported errors (§7.3). Neither
    split renders free text — only counts against error_type/tool_id — so
    the P23 textContent-only rule doesn't come into play here. But
    error_type/tool_id are NOT a server-enforced enum: POST /api/v1/errors
    (errors.py) is public, anonymous, and stores whatever string a caller
    sends for either field — validation_error/conversion_error is only a
    frontend convention. Both queries are therefore capped the same way, so
    an API caller sending many distinct values can't inflate either array
    unboundedly (bounded by rate limit + retention_days purge, but that's
    still a lot of rows over a 90-365 day window).

    retention_days is echoed back so the frontend can caption a selected
    range that exceeds it, rather than the Errors card silently looking
    sparse next to a full Conversions trend for the same nominal window
    (§2.4/§7.3) — Error rows are purged after retention_days, unlike
    Conversion/User rows.
    """
    days = max(1, min(days, 365))
    since = datetime.now(UTC) - timedelta(days=days)

    by_type_query = (
        select(Error.error_type, func.count().label("n"))
        .where(Error.created_at >= since)
        .group_by(Error.error_type)
        .order_by(func.count().desc())
        .limit(10)
    )
    by_tool_query = (
        select(Error.tool_id, func.count().label("n"))
        .where(Error.created_at >= since)
        .group_by(Error.tool_id)
        .order_by(func.count().desc())
        .limit(5)
    )

    by_type = (await db.execute(by_type_query)).all()
    by_tool = (await db.execute(by_tool_query)).all()
    return {
        "by_type": [{"error_type": t, "count": int(n)} for t, n in by_type],
        "by_tool": [{"tool_id": t, "count": int(n)} for t, n in by_tool],
        "retention_days": settings.retention_days,
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
    if result:
        total = result[0].total
    else:
        # offset landed past the end (e.g. the retention sweep in tasks.py
        # aged out rows out from under a page an admin was already viewing) —
        # the window-count query returns nothing, so total needs its own query.
        total = (await db.execute(select(func.count()).select_from(Error))).scalar_one()
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
