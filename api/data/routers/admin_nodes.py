"""Cutover orchestration — NEON_FAILOVER_PLAN.md §7.13, Phase D.

The first router in this plan where a real production database switch
becomes possible. Every route here requires ``Depends(require_admin)``, the
same as ``admin_deploy.py`` — these routes expose pool state and can
trigger a live switch or start a real (if slow) data-moving background
operation.

**This router only ever dispatches — it never does the actual switch or
sync work itself.** ``api`` runs ``--workers 4`` (``Dockerfile:49``); a
naive in-process background task started from a POST handler here would
run inside whichever of the 4 processes handled that request, invisible to
the other 3 and to whichever process a later poll happens to land on. So a
POST here does three things and returns immediately: validates, records
Redis state (the node row, or a ``pending`` ``SwitchStatus``), and pushes a
JSON task onto the same wake queue ``job_worker.py`` already ``BRPOP``s
from for conversion jobs (``JOB_WAKE_QUEUE_KEY``) — ``data/node_ops.py``'s
``execute_switch()``/``execute_provision()`` do the real work, dispatched
from *there*, in the one long-running process built for it.

**Never return a raw connection string.** Every response below goes
through ``Node.public_dict()`` (or omits ``connection_string`` outright) —
even to an authenticated admin, per §7.1: there's no operational need for
the browser to see a live database credential again after the one-time
write during provisioning.

**Why a dropped wake-queue push must be a real error, not fire-and-forget.**
``converter.py``'s own job-enqueue push onto this same list fails open (a
dropped push there just means slower pickup via the worker's periodic GC
sweep, since the ``ConversionJob`` row is the durable source of truth). A
switch/provision task has no such fallback — nothing here re-scans Redis
for a ``pending`` run that never got its wake — so a dropped push would
otherwise leave a node stuck silently in ``provisioning`` (or a switch
silently never happening) forever. ``_dispatch()`` below surfaces that
failure as a real 502 and rolls back any state it already wrote, instead of
returning a calm "queued" for a task that will never run.
"""

import asyncio
import secrets
from datetime import UTC, datetime

from converter import JOB_WAKE_QUEUE_KEY
from fastapi import APIRouter, Depends, HTTPException
from log import get_logger
from pydantic import BaseModel, ValidationError, field_validator

from data.node_ops import build_provision_task, build_switch_task
from data.node_registry import (
    NoActiveNodeError,
    Node,
    SwitchStatus,
    find_node_by_neon_project_id,
    get_active_node,
    get_last_activity,
    get_node,
    get_settings,
    get_switch_status,
    get_usage_cache,
    list_nodes,
    normalize_connection_string,
    register_node,
    set_switch_status,
    update_settings,
)
from data.redis_client import REDIS_CALL_TIMEOUT_SECONDS, redis_client
from data.security import require_admin

logger = get_logger("admin-nodes")

router = APIRouter(prefix="/api/v1/admin/nodes", tags=["admin-nodes"])

DISPLAY_NAME_MAX = 100


async def _dispatch(raw_payload: str, *, run_id: str, on_failure=None) -> None:
    """Push ``raw_payload`` onto the wake queue; on any failure, mark
    ``run_id`` as errored, run ``on_failure`` (e.g. flip a freshly-created
    node back to ``error`` instead of leaving it stuck in ``provisioning``),
    and raise a real 502 — see the module docstring for why this can't be
    best-effort the way ``converter.py``'s job-enqueue push is."""
    try:
        await asyncio.wait_for(
            redis_client.lpush(JOB_WAKE_QUEUE_KEY, raw_payload),
            timeout=REDIS_CALL_TIMEOUT_SECONDS,
        )
    except Exception as exc:  # noqa: BLE001 — surface for real, see docstring
        logger.error(
            "Failed to dispatch task to job_worker",
            exc_info=True,
            extra={"data": {"event": "admin_nodes_dispatch_failed", "run_id": run_id}},
        )
        await set_switch_status(
            run_id,
            SwitchStatus(
                status="error",
                detail="Could not dispatch to the worker process. Try again.",
            ),
        )
        if on_failure is not None:
            await on_failure()
        raise HTTPException(
            status_code=502,
            detail="Could not dispatch to the worker process. Try again.",
        ) from exc


def _node_dict(
    node: Node, *, is_active: bool, usage: dict | None, last_activity: str | None
) -> dict:
    return {
        **node.public_dict(),
        "is_active": is_active,
        "usage": usage,
        "last_activity": last_activity,
    }


async def _active_node_id_or_none() -> str | None:
    """``GET /nodes`` must not 500 just because the active pointer can't be
    resolved right now (Redis unreachable with no prior cache, or the
    narrow pre-Bootstrap window, §7.1) — it degrades to "no node marked
    active" rather than failing the whole listing."""
    try:
        return await get_active_node()
    except NoActiveNodeError:
        return None


# --------------------------------------------------------------------------- #
# Request bodies
# --------------------------------------------------------------------------- #


class ProvisionNodeBody(BaseModel):
    display_name: str
    connection_string: str
    neon_project_id: str

    @field_validator("display_name")
    @classmethod
    def _display_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("display_name must not be empty")
        if len(v) > DISPLAY_NAME_MAX:
            raise ValueError(f"display_name must be ≤ {DISPLAY_NAME_MAX} characters")
        return v

    @field_validator("connection_string")
    @classmethod
    def _connection_string(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("connection_string must not be empty")
        return v

    @field_validator("neon_project_id")
    @classmethod
    def _neon_project_id(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("neon_project_id must not be empty")
        return v


class RenameNodeBody(BaseModel):
    display_name: str

    @field_validator("display_name")
    @classmethod
    def _display_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("display_name must not be empty")
        if len(v) > DISPLAY_NAME_MAX:
            raise ValueError(f"display_name must be ≤ {DISPLAY_NAME_MAX} characters")
        return v


class UpdateNodeSettingsBody(BaseModel):
    """Every field optional — §7.12's Settings tab auto-saves one changed
    field at a time (no batch submit), so a PUT here typically carries
    exactly one key. Only the fields actually present get merged in
    (``update_settings``'s own contract)."""

    warmup_threshold_pct: int | None = None
    cutover_threshold_pct: int | None = None
    usage_poll_interval_minutes: int | None = None
    inactivity_warning_days: int | None = None
    reactive_failure_count: int | None = None


# --------------------------------------------------------------------------- #
# Switch
# --------------------------------------------------------------------------- #


@router.post("/{node_id}/switch")
async def trigger_switch(node_id: str, admin=Depends(require_admin)):
    target = await get_node(node_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Node not found.")
    if target.status != "ready":
        raise HTTPException(
            status_code=400,
            detail=f"Node status is {target.status!r}; only a ready reserve node "
            "can be a switch target.",
        )
    active_node_id = await get_active_node()
    if node_id == active_node_id:
        raise HTTPException(status_code=400, detail="This node is already active.")

    run_id = secrets.token_hex(8)
    await set_switch_status(
        run_id,
        SwitchStatus(
            status="pending",
            detail="Switch queued",
            source_node_id=active_node_id,
            target_node_id=node_id,
            trigger="manual",
        ),
    )
    await _dispatch(
        build_switch_task(run_id=run_id, target_node_id=node_id, trigger="manual"),
        run_id=run_id,
    )
    logger.info(
        "Switch triggered by %s: %s -> %s",
        admin.email,
        active_node_id,
        node_id,
        extra={
            "data": {
                "event": "admin_node_switch_trigger",
                "actor": admin.email,
                "run_id": run_id,
                "source_node_id": active_node_id,
                "target_node_id": node_id,
            }
        },
    )
    return {"run_id": run_id, "status": "queued"}


# --------------------------------------------------------------------------- #
# Provisioning (add node / retry)
# --------------------------------------------------------------------------- #


@router.post("")
async def provision_node(body: ProvisionNodeBody, admin=Depends(require_admin)):
    # §7.1/§7.8 step 1 — reject a duplicate neon_project_id BEFORE anything
    # is written, so a typo'd resubmit never gets a second registry entry
    # double-counting the same project's usage.
    existing = await find_node_by_neon_project_id(body.neon_project_id)
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Neon project {body.neon_project_id!r} is already registered "
            f"as node {existing.node_id!r}.",
        )

    node_id = secrets.token_hex(8)
    node = Node(
        node_id=node_id,
        display_name=body.display_name,
        connection_string=normalize_connection_string(body.connection_string),
        neon_project_id=body.neon_project_id,
        status="provisioning",  # §7.8 step 2 — visible in the admin panel immediately
        created_at=datetime.now(UTC).isoformat(),
    )
    await register_node(node)

    run_id = secrets.token_hex(8)
    await set_switch_status(
        run_id,
        SwitchStatus(
            status="pending", detail="Checking connection", target_node_id=node_id
        ),
    )

    async def _rollback_to_error() -> None:
        await register_node(node.model_copy(update={"status": "error"}))

    await _dispatch(
        build_provision_task(run_id=run_id, node_id=node_id),
        run_id=run_id,
        on_failure=_rollback_to_error,
    )
    logger.info(
        "Node provisioning triggered by %s: node_id=%s",
        admin.email,
        node_id,
        extra={
            "data": {
                "event": "admin_node_provision_trigger",
                "actor": admin.email,
                "run_id": run_id,
                "node_id": node_id,
            }
        },
    )
    return {"node_id": node_id, "run_id": run_id, "status": "queued"}


@router.post("/{node_id}/retry")
async def retry_provisioning(node_id: str, admin=Depends(require_admin)):
    node = await get_node(node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found.")
    if node.status != "error":
        raise HTTPException(
            status_code=400,
            detail=f"Node status is {node.status!r}; only an errored node can be retried.",
        )

    await register_node(node.model_copy(update={"status": "provisioning"}))
    run_id = secrets.token_hex(8)
    await set_switch_status(
        run_id,
        SwitchStatus(
            status="pending", detail="Retrying provisioning", target_node_id=node_id
        ),
    )

    async def _rollback_to_error() -> None:
        await register_node(node.model_copy(update={"status": "error"}))

    await _dispatch(
        build_provision_task(run_id=run_id, node_id=node_id),
        run_id=run_id,
        on_failure=_rollback_to_error,
    )
    logger.info(
        "Node provisioning retried by %s: node_id=%s",
        admin.email,
        node_id,
        extra={
            "data": {
                "event": "admin_node_provision_retry",
                "actor": admin.email,
                "run_id": run_id,
                "node_id": node_id,
            }
        },
    )
    return {"run_id": run_id, "status": "queued"}


# --------------------------------------------------------------------------- #
# Status / listing / settings
# --------------------------------------------------------------------------- #


@router.get("/{run_id}/status")
async def get_run_status(run_id: str, _admin=Depends(require_admin)):
    status = await get_switch_status(run_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Unknown run_id.")
    return status.model_dump()


@router.get("")
async def list_nodes_route(_admin=Depends(require_admin)):
    active_node_id = await _active_node_id_or_none()
    nodes = await list_nodes()
    result = []
    for node in nodes:
        usage = await get_usage_cache(node.node_id)
        last_activity = await get_last_activity(node.node_id)
        result.append(
            _node_dict(
                node,
                is_active=(node.node_id == active_node_id),
                usage=usage.model_dump() if usage else None,
                last_activity=last_activity.isoformat() if last_activity else None,
            )
        )
    return {"nodes": result}


@router.get("/settings")
async def get_node_settings(_admin=Depends(require_admin)):
    return (await get_settings()).model_dump()


@router.put("/settings")
async def put_node_settings(body: UpdateNodeSettingsBody, admin=Depends(require_admin)):
    partial = body.model_dump(exclude_none=True)
    try:
        updated = await update_settings(partial)
    except (ValueError, ValidationError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    logger.info(
        "Node settings updated by %s: %s",
        admin.email,
        partial,
        extra={
            "data": {
                "event": "admin_node_settings_update",
                "actor": admin.email,
                "fields": sorted(partial),
            }
        },
    )
    return updated.model_dump()


# --------------------------------------------------------------------------- #
# Rename / retire
# --------------------------------------------------------------------------- #


@router.patch("/{node_id}")
async def rename_node(node_id: str, body: RenameNodeBody, admin=Depends(require_admin)):
    node = await get_node(node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found.")
    updated = node.model_copy(update={"display_name": body.display_name})
    await register_node(updated)
    logger.info(
        "Node renamed by %s: %s -> %r",
        admin.email,
        node_id,
        body.display_name,
        extra={
            "data": {
                "event": "admin_node_rename",
                "actor": admin.email,
                "node_id": node_id,
            }
        },
    )
    return {"node": updated.public_dict()}


@router.post("/{node_id}/retire")
async def retire_node(node_id: str, admin=Depends(require_admin)):
    node = await get_node(node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found.")
    active_node_id = await get_active_node()
    if node_id == active_node_id:
        # §7.8/§7.12 — retiring the currently-active node must be impossible,
        # not just discouraged in the UI: status and the active pointer are
        # independent pieces of state, so nothing else stops get_active_node()
        # from keeping returning a "retired" node otherwise.
        raise HTTPException(
            status_code=400, detail="Cannot retire the currently active node."
        )
    updated = node.model_copy(update={"status": "retired"})
    await register_node(updated)
    logger.info(
        "Node retired by %s: %s",
        admin.email,
        node_id,
        extra={
            "data": {
                "event": "admin_node_retire",
                "actor": admin.email,
                "node_id": node_id,
            }
        },
    )
    return {"node": updated.public_dict()}
