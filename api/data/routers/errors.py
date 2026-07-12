"""Client error logging — public, rate-limited, message truncated (§9)."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from data.db import get_session
from data.models import Error

router = APIRouter(prefix="/api/v1/errors", tags=["errors"])

_MAX_MESSAGE = 2000


class ErrorBody(BaseModel):
    tool_id: str | None = None
    error_type: str | None = None
    error_message: str | None = None
    browser: str | None = None


@router.post("")
async def log_error(
    body: ErrorBody,
    db: AsyncSession = Depends(get_session),
):
    message = body.error_message
    if message is not None:
        message = message[:_MAX_MESSAGE]
    db.add(
        Error(
            tool_id=body.tool_id,
            error_type=body.error_type,
            error_message=message,
            browser=(body.browser[:512] if body.browser else None),
        )
    )
    await db.commit()
    return {"ok": True}
