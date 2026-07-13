"""Conversion tracking — dual-write (D2/D3), §9.

Always upsert the anonymous ``conversions`` aggregate ``(tool_id, date)``. If a
user session is present, **await** an insert into ``user_conversions`` wrapped so
a history failure never fails the counter, and return a **truthful**
``saved_to_history`` (the "Saved ✓" confirmation must not lie — P5).

Note ``/conversions`` (this tracking POST) is distinct from ``/convert/…`` (the
heavy server-side conversion in ``converter.py``).
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from log import get_logger
from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from data.db import get_session
from data.models import Conversion, UserConversion
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
    db: AsyncSession = Depends(get_session),
    user=Depends(current_user),
):
    successes, failures = _counts(body)
    today = datetime.now(UTC).date()

    # Aggregate upsert — always (the trust counter).
    stmt = pg_insert(Conversion).values(
        tool_id=body.tool_id, date=today, count=successes, failures=failures
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[Conversion.tool_id, Conversion.date],
        set_={
            "count": Conversion.count + successes,
            "failures": Conversion.failures + failures,
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
