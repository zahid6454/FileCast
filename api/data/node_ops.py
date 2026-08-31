"""Cutover + provisioning orchestration — NEON_FAILOVER_PLAN.md §7.4/§7.8/
§7.13, Phase D.

This is the code that actually runs a switch or a node-provisioning
sequence. It is dispatched from ``data/job_worker.py``'s wake loop (never
run inline inside an ``api`` request-handling process, §7.13 — a naive
in-process background task there would run inside whichever of the 4
``uvicorn`` workers handled the POST, invisible to the other 3 and to
whichever process a poll later lands on) and it runs as a background task
within ``job_worker.py``'s own event loop (``asyncio.create_task``, same
strong-reference pattern ``_discovery_wake()`` already uses) so the wake
loop's own responsiveness — claiming newly-queued conversion jobs — is
never delayed by a multi-minute sync running in here.

**Wire format for the shared wake queue.** ``converter.py`` already pushes a
bare, unparsed job-id string onto ``JOB_WAKE_QUEUE_KEY`` for conversion-job
dispatch (``converter.py:1391``) — that shape is unchanged. This module adds
a second, JSON-object shape onto the *same* list for switch/provision
dispatch, distinguished by a ``task-type`` field. ``build_switch_task()``/
``build_provision_task()`` are the producer side (called by
``data/routers/admin_nodes.py``); ``parse_wake_task()`` is the consumer side
(called by ``job_worker.py``'s loop) — one shared contract for the field
names on both ends, rather than each side inventing its own dict shape.
``parse_wake_task()`` returns ``None`` for anything that isn't this JSON
shape (a legacy bare job-id string, or JSON that doesn't look like a task),
so a non-JSON push is unaffected and still falls through to the existing
discovery-poll handling in ``job_worker.py`` exactly as it does today.

**Why job_worker.py is imported inside the two ``execute_*`` functions, not
at module level.** ``job_worker.py`` imports this module at its own top
level (to dispatch on wake). Importing ``job_worker`` back at *this*
module's top level would be a straightforward circular import. Both
``execute_switch``/``execute_provision`` only ever actually run as tasks
dispatched *from* ``job_worker.py`` after it has fully imported — so a
function-scoped import here is always safe and sidesteps the cycle
entirely, without needing to relocate ``pause_claiming``/
``resume_claiming``/``drain_in_flight_jobs`` (existing, already-tested
Phase C code) out of ``job_worker.py``.

**Error surfacing.** Neither ``execute_switch`` nor ``execute_provision``
ever raises past themselves in normal operation — every failure path marks
a terminal ``SwitchStatus`` (and, for provisioning, the node's own
``status``) and always releases the pool-operation lock in a ``finally``,
so a background task that nothing ever awaits still leaves behind a clear,
pollable outcome rather than an unhandled-exception log line.
"""

import asyncio
import json
from datetime import UTC, datetime

from log import get_logger
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

import scripts.node_sync as node_sync
from data import neon_api
from data.node_registry import (
    NoActiveNodeError,
    Node,
    SwitchHistoryEntry,
    SwitchStatus,
    TriggerType,
    acquire_pool_lock,
    append_switch_history,
    get_active_node,
    get_last_activity,
    get_node,
    get_settings,
    get_usage_cache,
    list_nodes,
    register_node,
    release_pool_lock,
    set_active_node,
    set_maintenance,
    set_switch_status,
)

logger = get_logger("node_ops")

# --------------------------------------------------------------------------- #
# Wake-queue wire format (§7.13)
# --------------------------------------------------------------------------- #

TASK_TYPE_SWITCH = "switch_node"
TASK_TYPE_PROVISION = "provision_node"


def build_switch_task(*, run_id: str, target_node_id: str, trigger: TriggerType) -> str:
    """JSON payload for a switch dispatch — the producer side of the
    contract ``parse_wake_task``/``execute_switch`` consume."""
    return json.dumps(
        {
            "task-type": TASK_TYPE_SWITCH,
            "run_id": run_id,
            "target_node_id": target_node_id,
            "trigger": trigger,
        }
    )


def build_provision_task(*, run_id: str, node_id: str) -> str:
    """JSON payload for a provisioning dispatch (initial or a retry) — the
    producer side of the contract ``parse_wake_task``/``execute_provision``
    consume."""
    return json.dumps(
        {"task-type": TASK_TYPE_PROVISION, "run_id": run_id, "node_id": node_id}
    )


def parse_wake_task(raw: str) -> tuple[str, dict] | None:
    """The consumer side, called from ``job_worker.py``'s wake loop on every
    popped value. Returns ``(task_type, kwargs)`` — ``kwargs`` is ready to
    pass straight to ``execute_switch(**kwargs)``/``execute_provision(**kwargs)``
    — or ``None`` for anything that isn't this JSON task shape, which covers
    both a non-JSON string (the legacy bare job-id push, unchanged) and JSON
    that doesn't carry a recognized ``task-type``. Never raises — a
    malformed push must degrade to "not a task" and fall through to the
    existing discovery-poll handling, never crash the wake loop."""
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    task_type = payload.get("task-type")
    if task_type not in (TASK_TYPE_SWITCH, TASK_TYPE_PROVISION):
        return None
    kwargs = {k: v for k, v in payload.items() if k != "task-type"}
    return task_type, kwargs


# --------------------------------------------------------------------------- #
# Switch-target selection (§7.4)
# --------------------------------------------------------------------------- #


async def select_switch_target(exclude_node_ids: set[str]) -> str | None:
    """The reserve node with the lowest cached ``usage_ratio``, tie-broken by
    whichever has gone longest since it was last active (spreads wear
    evenly, §7.4). Only ``status == "ready"`` nodes are eligible — "active"
    is not a status value (§7.1: the active pointer and a node's own status
    are independent), so the caller excludes the current source (and any
    already-tried, unreachable target) via ``exclude_node_ids``.

    A node with no usage cache yet (never polled — e.g. immediately after
    provisioning) is treated as ratio 0.0: no evidence it's used, so it's
    not penalized for missing data. Returns ``None`` if no eligible reserve
    exists at all.
    """
    candidates = [
        n
        for n in await list_nodes()
        if n.status == "ready" and n.node_id not in exclude_node_ids
    ]
    if not candidates:
        return None

    scored = []
    for node in candidates:
        usage = await get_usage_cache(node.node_id)
        ratio = usage.ratio if usage else 0.0
        last_active = await get_last_activity(node.node_id)
        # None (never touched) sorts as "longest since active" — treat it as
        # the oldest possible timestamp so it wins the tie-break over any
        # node with a real, more-recent last-activity timestamp.
        last_active_sort_key = last_active or datetime.min.replace(tzinfo=UTC)
        scored.append((ratio, last_active_sort_key, node.node_id))

    scored.sort(key=lambda item: (item[0], item[1]))
    return scored[0][2]


async def pool_has_headroom() -> bool:
    """NEON_FAILOVER_PLAN.md §7.11/§9 — the shared "does any reserve node
    have meaningfully more headroom than the active one" check behind
    ``/pool-health`` (§7.11) and the admin panel's overview banner (§7.12,
    a later phase). Reuses ``select_switch_target``'s own selection logic
    rather than a separately-computed notion of "healthy" — §9's own
    reasoning is literally "moving to an equally-drained node doesn't
    create capacity, it only relocates the same shortage," so this isn't
    just "some ready reserve happens to exist."

    Short-circuits to healthy while the active node itself is still well
    under ``warmup_threshold_pct`` (§8) — reusing that existing setting
    rather than inventing a new one — since comparing near-zero-usage nodes
    against each other is meaningless (a brand new pool would otherwise
    read "degraded" just because every node's usage happens to be equally
    unmeasured or equally near zero, which is the opposite of what this
    signal is for). Once the active node is genuinely getting used up, this
    starts asking the real question: is there somewhere meaningfully better
    to go.
    """
    try:
        active_node_id = await get_active_node()
    except NoActiveNodeError:
        return True  # nothing to protect yet (pre-Bootstrap) — not "degraded"

    active_usage = await get_usage_cache(active_node_id)
    active_ratio = active_usage.ratio if active_usage else 0.0

    node_settings = await get_settings()
    if active_ratio < node_settings.warmup_threshold_pct / 100:
        return True

    target_node_id = await select_switch_target(exclude_node_ids={active_node_id})
    if target_node_id is None:
        return False

    target_usage = await get_usage_cache(target_node_id)
    target_ratio = target_usage.ratio if target_usage else 0.0
    return target_ratio < active_ratio


async def run_warmup_sync(source_node_id: str, target_node_id: str) -> bool:
    """Standalone background warm-up sync — NEON_FAILOVER_PLAN.md §7.4
    Trigger 1's 70% threshold, Phase E. Unlike ``execute_switch``'s own
    internal warm-up (Phase 1 below), this runs entirely outside a switch:
    the active node keeps serving all traffic unaffected, and nothing about
    which node is active changes.

    Still reads from whatever node is currently active and truncates the
    target (§7.5), so — same reasoning as a provisioning sync (§7.1) — it
    must not run concurrently with a switch that could change which node is
    active mid-copy, or with another sync into the same target. Acquires the
    pool-operation lock itself for exactly that reason.

    Returns ``False`` (a no-op) if the lock is already held by a switch or
    provisioning operation in progress — logged and ignored, same as any
    other trigger racing the lock (§7.4's concurrency guard); the next poll
    cycle simply tries again. Returns ``True`` once the sync has run to
    completion, whether it succeeded or failed (a failure already demotes
    the target to ``error`` via ``sync_or_mark_target_unsafe``, same as
    ``execute_switch``'s own warm-up) — never raises.
    """
    token = await acquire_pool_lock(f"warmup:{target_node_id}")
    if token is None:
        logger.info(
            "Warm-up sync skipped: pool operation already in progress",
            extra={
                "data": {
                    "event": "warmup_lock_rejected",
                    "source_node_id": source_node_id,
                    "target_node_id": target_node_id,
                }
            },
        )
        return False
    try:
        await sync_or_mark_target_unsafe(source_node_id, target_node_id)
    except Exception:  # noqa: BLE001 — a background maintenance sync, not a switch
        logger.warning(
            "Warm-up sync failed: %s -> %s",
            source_node_id,
            target_node_id,
            exc_info=True,
            extra={
                "data": {
                    "event": "warmup_sync_failed",
                    "source_node_id": source_node_id,
                    "target_node_id": target_node_id,
                }
            },
        )
    finally:
        await release_pool_lock(token)
    return True


# --------------------------------------------------------------------------- #
# Shared helpers — used by both switch execution and provisioning below
# --------------------------------------------------------------------------- #


async def _mark_node_status(node_id: str, status: str) -> Node | None:
    """Set a node's status, unless it's already ``retired`` — §7.8 doesn't
    forbid retiring a still-``provisioning`` node (a reasonable way for an
    admin to cancel one), and that's a deliberate, authoritative admin
    action taken via a completely different code path (the retire route)
    while this operation was still in flight. This operation's own
    eventual outcome (``ready``/``error``) must not silently clobber that.

    Deliberately does **not** guard against overwriting ``error`` (only
    ``retired``): a losing side of a lock-contention race (two ``retry``
    dispatches racing for the same already-errored node, say) may mark this
    same node ``error`` well before the WINNING side's real work finishes —
    if that were also protected, the winner's later legitimate ``ready``
    would be silently discarded because someone else's rejection got there
    first. ``retired`` is the one status only a human admin ever sets
    directly; ``error`` can come from either a human or a losing race, so
    only ``retired`` is safe to treat as authoritative here.
    """
    node = await get_node(node_id)
    if node is None:
        return None
    if node.status == "retired":
        return node
    updated = node.model_copy(update={"status": status})
    await register_node(updated)
    return updated


async def sync_or_mark_target_unsafe(source_node_id: str, target_node_id: str) -> None:
    """Wraps ``node_sync.sync_node()`` for every caller that syncs into an
    EXISTING ``ready`` reserve — both of ``execute_switch``'s own call sites
    (warm-up and the final cutover top-up) below, and the standalone
    proactive-trigger warm-up in ``run_warmup_sync`` (§7.4, Phase E) — so a
    failure here must not leave that node's registry status unchanged.

    ``sync_node()`` truncates the target before restoring into it (§7.5);
    those two steps aren't one transaction, so ANY exception escaping it —
    not just ``NodeSyncError`` — can mean the target's data is now
    truncated/partially restored, not merely "not yet updated." Demoting
    out of ``ready`` here (the same terminal state ``execute_provision()``
    already uses for any of its own failures) means this target can never
    be silently re-selected by a LATER, unrelated switch while its data is
    suspect — the existing retry flow (a full re-sync) is the correct way
    back to ``ready``, not leaving this ``ready`` and hoping the next sync
    happens to fully overwrite whatever the failed one left behind.

    Always re-raises unchanged — this only adds a side effect; callers keep
    their existing ``NodeSyncError``-vs-anything-else control flow.
    """
    try:
        await node_sync.sync_node(source_node_id, target_node_id)
    except Exception:
        await _mark_node_status(target_node_id, "error")
        raise


# --------------------------------------------------------------------------- #
# Switch execution (§7.4/§7.7/§7.13)
# --------------------------------------------------------------------------- #


async def execute_switch(
    *, run_id: str, target_node_id: str, trigger: TriggerType
) -> None:
    """Run one switch end-to-end. Dispatched from ``job_worker.py``'s wake
    loop as a background task — see the module docstring for why this must
    never be awaited inline there.

    Two phases, matching §7.4's "manual follows the exact same sequence as
    proactive" requirement:

    1. **Warm-up** — a full sync to the target while the active node keeps
       serving all traffic, unaffected. If the target is unreachable here,
       there's no urgency (§7.4): fall back to the next-best reserve and
       retry, trying every remaining reserve at most once before giving up.
    2. **Cutover** — pause new job pickup, drain in-flight jobs (§7.7), one
       more short top-up sync, flip the active pointer, resume. If the
       target fails *here* (after maintenance mode is already active),
       abort the flip and resume on the original node (§7.4) rather than
       ever leaving the app with no active node.
    """
    token = await acquire_pool_lock(f"switch:{run_id}")
    if token is None:
        logger.warning(
            "Switch rejected: pool operation already in progress",
            extra={"data": {"event": "switch_lock_rejected", "run_id": run_id}},
        )
        await set_switch_status(
            run_id,
            SwitchStatus(
                status="error",
                detail="Another pool operation (switch or provisioning) is already in progress.",
                target_node_id=target_node_id,
                trigger=trigger,
            ),
        )
        return

    from data import job_worker  # deferred — see module docstring

    source_node_id: str | None = None
    try:
        source_node_id = await get_active_node()
        if source_node_id == target_node_id:
            await set_switch_status(
                run_id,
                SwitchStatus(
                    status="error",
                    detail="Target node is already the active node.",
                    source_node_id=source_node_id,
                    target_node_id=target_node_id,
                    trigger=trigger,
                ),
            )
            return

        # --- Phase 1: warm-up, with next-best-target retry on failure ---
        current_target = target_node_id
        tried: set[str] = set()
        while True:
            tried.add(current_target)
            await set_switch_status(
                run_id,
                SwitchStatus(
                    status="pending",
                    detail=f"Warming up target node {current_target!r}",
                    source_node_id=source_node_id,
                    target_node_id=current_target,
                    trigger=trigger,
                ),
            )
            target = await get_node(current_target)
            if target is not None and target.status == "ready":
                try:
                    await sync_or_mark_target_unsafe(source_node_id, current_target)
                    break  # warm-up succeeded
                except node_sync.NodeSyncError as exc:
                    logger.warning(
                        "Warm-up sync to %s failed (%s) — trying next-best reserve",
                        current_target,
                        exc,
                        extra={
                            "data": {
                                "event": "switch_warmup_target_failed",
                                "run_id": run_id,
                                "target_node_id": current_target,
                            }
                        },
                    )
            else:
                logger.warning(
                    "Warm-up target %s is no longer a ready reserve — trying "
                    "next-best",
                    current_target,
                    extra={
                        "data": {
                            "event": "switch_warmup_target_invalid",
                            "run_id": run_id,
                            "target_node_id": current_target,
                        }
                    },
                )

            next_target = await select_switch_target(tried | {source_node_id})
            if next_target is None:
                detail = "No reachable reserve node available for warm-up."
                await set_switch_status(
                    run_id,
                    SwitchStatus(
                        status="error",
                        detail=detail,
                        source_node_id=source_node_id,
                        target_node_id=current_target,
                        trigger=trigger,
                    ),
                )
                await append_switch_history(
                    SwitchHistoryEntry(
                        trigger=trigger,
                        source_node_id=source_node_id,
                        target_node_id=current_target,
                        outcome="failure",
                        detail=detail,
                        at=datetime.now(UTC).isoformat(),
                    )
                )
                return
            current_target = next_target

        # --- Phase 2: cutover (§7.6/§7.7) ---
        await set_maintenance(True)
        try:
            drained = await job_worker.drain_in_flight_jobs()
            if not drained:
                logger.warning(
                    "Switch proceeding past the drain timeout with jobs still "
                    "converting — each is bounded by its own queue timeout "
                    "regardless (§7.7)",
                    extra={
                        "data": {"event": "switch_drain_timed_out", "run_id": run_id}
                    },
                )

            await set_switch_status(
                run_id,
                SwitchStatus(
                    status="pending",
                    detail="Final top-up sync",
                    source_node_id=source_node_id,
                    target_node_id=current_target,
                    trigger=trigger,
                ),
            )
            try:
                await sync_or_mark_target_unsafe(source_node_id, current_target)
            except node_sync.NodeSyncError as exc:
                # Target failure during final cutover (§7.4): abort the flip,
                # resume on the original (still-healthy) node.
                logger.error(
                    "Final top-up sync failed during cutover — aborting flip, "
                    "resuming on source node %s",
                    source_node_id,
                    extra={
                        "data": {
                            "event": "switch_cutover_sync_failed",
                            "run_id": run_id,
                        }
                    },
                )
                await set_switch_status(
                    run_id,
                    SwitchStatus(
                        status="error",
                        detail=f"Final sync to target failed: {exc}",
                        source_node_id=source_node_id,
                        target_node_id=current_target,
                        trigger=trigger,
                    ),
                )
                await append_switch_history(
                    SwitchHistoryEntry(
                        trigger=trigger,
                        source_node_id=source_node_id,
                        target_node_id=current_target,
                        outcome="failure",
                        detail=str(exc),
                        at=datetime.now(UTC).isoformat(),
                    )
                )
                return

            # Re-validate the target is still a ready reserve right before
            # the flip — a plain sync failure (caught above) isn't the only
            # way the target could stop being a valid switch target mid-
            # cutover: an admin could retire it out from under this switch
            # in the window between the warm-up check (Phase 1) and here.
            # A stale/retired target's connection string can still connect
            # and sync just fine, so a sync-failure catch alone wouldn't
            # catch this — only re-checking status explicitly does.
            target_at_cutover = await get_node(current_target)
            if target_at_cutover is None or target_at_cutover.status != "ready":
                status_repr = (
                    target_at_cutover.status if target_at_cutover else "missing"
                )
                detail = (
                    f"Target node is no longer a ready reserve at cutover time "
                    f"(status={status_repr})."
                )
                logger.error(
                    "Target %s invalid at cutover time (status=%s) — aborting "
                    "flip, resuming on source node %s",
                    current_target,
                    status_repr,
                    source_node_id,
                    extra={
                        "data": {
                            "event": "switch_cutover_target_invalid",
                            "run_id": run_id,
                        }
                    },
                )
                await set_switch_status(
                    run_id,
                    SwitchStatus(
                        status="error",
                        detail=detail,
                        source_node_id=source_node_id,
                        target_node_id=current_target,
                        trigger=trigger,
                    ),
                )
                await append_switch_history(
                    SwitchHistoryEntry(
                        trigger=trigger,
                        source_node_id=source_node_id,
                        target_node_id=current_target,
                        outcome="failure",
                        detail=detail,
                        at=datetime.now(UTC).isoformat(),
                    )
                )
                return

            await set_switch_status(
                run_id,
                SwitchStatus(
                    status="pending",
                    detail="Flipping live traffic",
                    source_node_id=source_node_id,
                    target_node_id=current_target,
                    trigger=trigger,
                ),
            )
            await set_active_node(current_target)

            await set_switch_status(
                run_id,
                SwitchStatus(
                    status="done",
                    detail="Switch complete.",
                    source_node_id=source_node_id,
                    target_node_id=current_target,
                    trigger=trigger,
                ),
            )
            await append_switch_history(
                SwitchHistoryEntry(
                    trigger=trigger,
                    source_node_id=source_node_id,
                    target_node_id=current_target,
                    outcome="success",
                    detail=None,
                    at=datetime.now(UTC).isoformat(),
                )
            )
            logger.info(
                "Switch complete: %s -> %s",
                source_node_id,
                current_target,
                extra={
                    "data": {
                        "event": "switch_complete",
                        "run_id": run_id,
                        "source_node_id": source_node_id,
                        "target_node_id": current_target,
                    }
                },
            )
        finally:
            # §7.7 step 5 — always clear the pause once maintenance lifts,
            # regardless of outcome; idempotent if claiming was never
            # actually paused (an early-return above never reached drain).
            await set_maintenance(False)
            job_worker.resume_claiming()
    except Exception as exc:  # noqa: BLE001 — must always release the lock below
        logger.error(
            "Switch failed unexpectedly",
            exc_info=True,
            extra={"data": {"event": "switch_unexpected_error", "run_id": run_id}},
        )
        detail = f"Unexpected error: {exc}"
        await set_switch_status(
            run_id,
            SwitchStatus(
                status="error",
                detail=detail,
                source_node_id=source_node_id,
                target_node_id=target_node_id,
                trigger=trigger,
            ),
        )
        if source_node_id is not None:
            # SwitchHistoryEntry requires source_node_id (unlike SwitchStatus,
            # where it's optional) — only append if we got far enough to
            # resolve one. `target_node_id` (the original param, not
            # `current_target`) is used deliberately: this except clause can
            # be reached before Phase 1's while loop ever assigns
            # `current_target`, and referencing an unassigned local here
            # would raise UnboundLocalError from inside an exception handler.
            await append_switch_history(
                SwitchHistoryEntry(
                    trigger=trigger,
                    source_node_id=source_node_id,
                    target_node_id=target_node_id,
                    outcome="failure",
                    detail=detail,
                    at=datetime.now(UTC).isoformat(),
                )
            )
    finally:
        await release_pool_lock(token)


# --------------------------------------------------------------------------- #
# Node provisioning (§7.8)
# --------------------------------------------------------------------------- #

# Bounds the throwaway connectivity-check connection only — node_sync's own
# SYNC_OPERATION_TIMEOUT_SECONDS separately bounds the migrate+dump+restore
# step that follows.
CONNECTIVITY_CHECK_TIMEOUT_SECONDS = 10.0


async def _check_connectivity(node: Node) -> None:
    """Bounded-timeout connect + ``SELECT 1`` against a brand-new node,
    before anything else touches it (§7.8 step 4) — a throwaway engine, not
    the shared per-node cache in ``data/db.py`` (this node isn't ``ready``
    yet, and may never become so)."""
    engine = create_async_engine(node.connection_string, pool_pre_ping=False)
    try:
        async with asyncio.timeout(CONNECTIVITY_CHECK_TIMEOUT_SECONDS):
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
    except TimeoutError as exc:
        raise node_sync.NodeSyncError(
            f"Connection to the new node timed out after "
            f"{CONNECTIVITY_CHECK_TIMEOUT_SECONDS:.0f}s — check the connection string."
        ) from exc
    except Exception as exc:
        raise node_sync.NodeSyncError(
            f"Could not connect to the new node: {exc}"
        ) from exc
    finally:
        await engine.dispose()


async def execute_provision(*, run_id: str, node_id: str) -> None:
    """Run node provisioning end-to-end (§7.8 step 4 onward). The node row
    already exists in the registry as ``provisioning`` — written
    synchronously by the admin router before dispatch (§7.8 step 2), so
    it's visible in the admin panel immediately. This function only ever
    advances it to ``ready`` or ``error``, and never leaves it stuck
    silently in ``provisioning`` — every exit path below sets a terminal
    node status and switch status, and the ``finally`` always releases the
    pool-operation lock.

    Step order follows §7.8 literally: validate connectivity → migrate +
    full initial sync from the active node (one ``node_sync.sync_node()``
    call does both) → confirm the Neon API key can see the project →
    mark ready. The Neon-visibility check runs *after* the sync, exactly as
    specified, even though that means a wrong project id wastes a sync —
    that ordering is what §7.8 requires here, not an efficiency call to
    revisit.
    """
    token = await acquire_pool_lock(f"provision:{run_id}")
    if token is None:
        logger.warning(
            "Provisioning rejected: pool operation already in progress",
            extra={"data": {"event": "provision_lock_rejected", "run_id": run_id}},
        )
        await _mark_node_status(node_id, "error")
        await set_switch_status(
            run_id,
            SwitchStatus(
                status="error",
                detail="Another pool operation (switch or provisioning) is already in progress.",
                target_node_id=node_id,
            ),
        )
        return

    try:
        node = await get_node(node_id)
        if node is None:
            await set_switch_status(
                run_id,
                SwitchStatus(
                    status="error",
                    detail=f"Node {node_id!r} vanished from the registry.",
                    target_node_id=node_id,
                ),
            )
            return

        await set_switch_status(
            run_id,
            SwitchStatus(
                status="pending", detail="Checking connection", target_node_id=node_id
            ),
        )
        await _check_connectivity(node)

        await set_switch_status(
            run_id,
            SwitchStatus(
                status="pending",
                detail="Bringing schema up to date and copying current data",
                target_node_id=node_id,
            ),
        )
        source_node_id = await get_active_node()
        await node_sync.sync_node(source_node_id, node_id)

        await set_switch_status(
            run_id,
            SwitchStatus(
                status="pending",
                detail="Confirming usage tracking works",
                target_node_id=node_id,
            ),
        )
        await neon_api.verify_project_visible(node.neon_project_id)

        await _mark_node_status(node_id, "ready")
        await set_switch_status(
            run_id,
            SwitchStatus(status="done", detail="Node ready.", target_node_id=node_id),
        )
        logger.info(
            "Node provisioning complete: %s",
            node_id,
            extra={"data": {"event": "node_provision_complete", "node_id": node_id}},
        )
    except Exception as exc:  # noqa: BLE001 — must always mark a terminal state
        logger.error(
            "Node provisioning failed: %s",
            node_id,
            exc_info=True,
            extra={
                "data": {
                    "event": "node_provision_failed",
                    "node_id": node_id,
                    "run_id": run_id,
                }
            },
        )
        await _mark_node_status(node_id, "error")
        await set_switch_status(
            run_id,
            SwitchStatus(status="error", detail=str(exc), target_node_id=node_id),
        )
    finally:
        await release_pool_lock(token)
