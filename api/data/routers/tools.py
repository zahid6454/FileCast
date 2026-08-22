"""Tool overlay routes (admin) — §9.

``GET /tools`` returns full rows incl. the seed-managed
``category``/``name``/formats so the Phase 4 admin panel can group + label tools
(including disabled ones) without reading YAML (C1). ``PUT /tools/reorder``
assigns ``sort_order = array index`` over the full global ordering (C2), so it is
declared **before** ``PUT /tools/{id}`` to avoid the path param shadowing it.

``featured_slot`` (homepage curation, admin-panel redesign) is edited through
the same ``PUT /tools/{id}`` as any other overlay field, but carries two
invariants ``update_tool()`` enforces server-side rather than trusting the
client's optimistic UI: a slot has exactly one owner per category (assigning
it steals it from whoever held it), and a disabled tool can never hold one.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from data.db import get_session
from data.models import Tool
from data.routers._serialize import tool_dict
from data.security import require_admin

router = APIRouter(prefix="/api/v1/tools", tags=["tools"])


class ToolUpdate(BaseModel):
    enabled: bool | None = None
    display_name: str | None = None
    maintenance_message: str | None = None
    custom_max_file_size: str | None = None
    featured_slot: int | None = None


class ReorderBody(BaseModel):
    order: list[str]


@router.get("")
async def list_tools(
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    tools = (await db.execute(select(Tool).order_by(Tool.sort_order))).scalars().all()
    return {"tools": [tool_dict(t) for t in tools]}


@router.put("/reorder")
async def reorder_tools(
    body: ReorderBody,
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    # One transaction; sort_order = index in the submitted global ordering.
    tools = {t.id: t for t in (await db.execute(select(Tool))).scalars().all()}
    for index, tool_id in enumerate(body.order, start=1):
        tool = tools.get(tool_id)
        if tool is not None:
            tool.sort_order = index
    await db.commit()
    return {"ok": True, "count": len(body.order)}


@router.put("/{tool_id}")
async def update_tool(
    tool_id: str,
    body: ToolUpdate,
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    tool = (
        await db.execute(select(Tool).where(Tool.id == tool_id))
    ).scalar_one_or_none()
    if tool is None:
        raise HTTPException(status_code=404, detail="Tool not found")

    # Only admin-owned overlay columns are editable here (§6).
    fields = body.model_dump(exclude_unset=True)
    for key, value in fields.items():
        setattr(tool, key, value)

    # A disabled tool can never hold a homepage seat, regardless of what else
    # this same patch also tried to set.
    if fields.get("enabled") is False:
        tool.featured_slot = None

    # A slot has exactly one owner per category — claiming it steals it from
    # whoever held it, enforced here (not just the admin UI) so two admins
    # editing at once, or a dropped response, can't leave two tools claiming
    # the same seat. `.scalars().all()` (not `.scalar_one_or_none()`): if the
    # invariant were ever already violated (hand-edited DB, a future bug) this
    # self-heals by clearing every other holder instead of 500ing on
    # MultipleResultsFound over what should be a routine edit.
    if tool.featured_slot is not None and "featured_slot" in fields:
        holders = (
            (
                await db.execute(
                    select(Tool).where(
                        Tool.category == tool.category,
                        Tool.featured_slot == tool.featured_slot,
                        Tool.id != tool.id,
                    )
                )
            )
            .scalars()
            .all()
        )
        for holder in holders:
            holder.featured_slot = None

    await db.commit()
    await db.refresh(tool)
    return {"tool": tool_dict(tool)}
