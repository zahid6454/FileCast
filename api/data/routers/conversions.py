"""Conversion tracking — dual-write (D2/D3), §9.

Always upsert the anonymous ``conversions`` aggregate ``(tool_id, date)``. If a
user session is present, **await** an insert into ``user_conversions`` wrapped so
a history failure never fails the counter, and return a **truthful**
``saved_to_history`` (the "Saved ✓" confirmation must not lie — P5).

``unique_visitors`` on the aggregate is a distinct-fingerprint reach count,
alongside ``count``'s raw volume: an insert into the ``conversion_visitors``
dedup ledger (same daily-rotated fingerprint as ratings) that only succeeds
the first time a given fingerprint is seen for a tool that day gates whether
the aggregate's ``unique_visitors`` increments.

Note ``/conversions`` (this tracking POST) is distinct from ``/convert/…`` (the
heavy server-side conversion in ``converter.py``).
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request
from log import get_logger
from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from data.db import get_session
from data.fingerprint import compute_fingerprint
from data.models import Conversion, ConversionVisitor, UserConversion
from data.security import current_user

logger = get_logger("conversions")

router = APIRouter(prefix="/api/v1/conversions", tags=["conversions"])


class ConversionBody(BaseModel):
    tool_id: str
    input_format: str
    output_format: str
    status: str
    file_count: int = 1
    success_count: int | None = None
    file_size_kb: int | None = None
    duration_ms: int | None = None


def _counts(body: ConversionBody) -> tuple[int, int]:
    """Return (successes, failures) for the aggregate."""
    file_count = max(body.file_count, 1)
    if body.success_count is not None:
        successes = max(0, min(body.success_count, file_count))
    else:
        successes = file_count if body.status in ("success", "ok") else 0
    return successes, file_count - successes


@router.post("")
async def track_conversion(
    body: ConversionBody,
    request: Request,
    db: AsyncSession = Depends(get_session),
    user=Depends(current_user),
):
    successes, failures = _counts(body)
    today = datetime.now(UTC).date()

    # Dedup ledger — an insert only succeeds (and RETURNING yields a row) the
    # first time this (daily, per-tool) fingerprint is seen today, so that
    # gates whether this request counts as a new unique visitor. RETURNING
    # rather than checking rowcount: psycopg reports -1 for a plain
    # ON CONFLICT DO NOTHING insert via SQLAlchemy Core, so rowcount can't
    # distinguish "inserted" from "skipped" here.
    #
    # Isolated in a SAVEPOINT like the history insert below (D3): unique_visitors
    # is a best-effort enhancement metric, not the trust counter — a dedup-ledger
    # failure (lock contention, connection blip) must roll back only itself and
    # count this request as "not a new visitor" rather than poison the shared
    # transaction and lose the count/failures increment that must always land.
    new_visitor = False
    try:
        async with db.begin_nested():
            dedup_stmt = (
                pg_insert(ConversionVisitor)
                .values(
                    tool_id=body.tool_id,
                    date=today,
                    fingerprint=compute_fingerprint(request, body.tool_id),
                )
                .on_conflict_do_nothing(
                    index_elements=[
                        ConversionVisitor.tool_id,
                        ConversionVisitor.date,
                        ConversionVisitor.fingerprint,
                    ]
                )
                .returning(ConversionVisitor.fingerprint)
            )
            dedup_result = await db.execute(dedup_stmt)
            new_visitor = dedup_result.first() is not None
    except Exception:
        logger.warning(
            "visitor dedup insert failed",
            extra={"data": {"event": "visitor_dedup_failed", "tool_id": body.tool_id}},
        )
        new_visitor = False

    # Aggregate upsert — always (the trust counter).
    stmt = pg_insert(Conversion).values(
        tool_id=body.tool_id,
        date=today,
        count=successes,
        failures=failures,
        unique_visitors=1 if new_visitor else 0,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[Conversion.tool_id, Conversion.date],
        set_={
            "count": Conversion.count + successes,
            "failures": Conversion.failures + failures,
            "unique_visitors": Conversion.unique_visitors + (1 if new_visitor else 0),
        },
    )
    await db.execute(stmt)

    saved_to_history = False
    if user is not None:
        # Await the insert so saved_to_history is truthful (D3/P5). Isolate it in
        # a SAVEPOINT: a history failure rolls back ONLY the history row, so the
        # shared transaction stays valid and the always-on counter still commits.
        # Without this, a poisoned transaction would fail the commit and silently
        # drop the aggregate increment — the exact bug D3 warns about.
        try:
            async with db.begin_nested():
                db.add(
                    UserConversion(
                        user_id=user.id,
                        tool_id=body.tool_id,
                        input_format=body.input_format,
                        output_format=body.output_format,
                        file_size_kb=body.file_size_kb,
                        duration_ms=body.duration_ms,
                        status=body.status,
                    )
                )
            saved_to_history = True
        except Exception:
            logger.warning(
                "history insert failed",
                extra={
                    "data": {"event": "history_insert_failed", "tool_id": body.tool_id}
                },
            )
            saved_to_history = False

    await db.commit()
    return {"ok": True, "saved_to_history": saved_to_history}
