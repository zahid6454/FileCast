"""Node registry — Redis-backed multi-Neon-node pool state.

See ``project-docs/NEON_FAILOVER_PLAN.md`` §7.1 for the full design this
module implements. **Phase A only** (§11): this owns pool state in Redis
under the ``filecast:nodes:*`` namespace. Nothing else in the running app
calls into this module yet — ``db.py`` stays on the single static
``DATABASE_URL``, and every write route/health check is untouched — so
this file produces zero behavior change on its own. It exists so later
phases (B onward) have somewhere real to read/write pool state instead of
inventing it ad hoc.

Every Redis call here is bounded by ``REDIS_CALL_TIMEOUT_SECONDS`` the same
way every other short Redis call in this app already is (``redis_client.py``)
— an unreachable Redis fails fast into whatever fallback applies, rather
than hanging a request/loop iteration on the OS's own TCP timeout.

Two functions get *deliberate* fail-open/fallback behavior, because the plan
calls them out specifically (§7.1, §8) — everything else lets a Redis error
propagate to the caller, since a registry mutation (register/retire/switch)
failing loudly is the correct behavior, not something to paper over:

- ``get_active_node()`` falls back to the last successfully-read node_id.
- ``get_settings()`` falls back to the hardcoded ``NodeSettings`` defaults.
"""

import asyncio
import secrets
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Literal

from log import get_logger
from pydantic import BaseModel, ValidationError

from data.redis_client import REDIS_CALL_TIMEOUT_SECONDS, redis_client

logger = get_logger("node_registry")

# --- Key namespace (§7.1) ---
REGISTRY_KEY = "filecast:nodes:registry"
ACTIVE_KEY = "filecast:nodes:active"
MAINTENANCE_KEY = "filecast:nodes:maintenance"
POOL_OP_LOCK_KEY = "filecast:nodes:pool_op_lock"
HEALTH_FAIL_COUNT_KEY = "filecast:nodes:health_fail_count"
SWITCH_HISTORY_KEY = "filecast:nodes:switch_history"
SETTINGS_KEY = "filecast:nodes:settings"


def _usage_key(node_id: str) -> str:
    return f"filecast:nodes:usage:{node_id}"


def _last_activity_key(node_id: str) -> str:
    return f"filecast:nodes:last_activity:{node_id}"


def _switch_status_key(run_id: str) -> str:
    return f"filecast:nodes:switch:{run_id}"


NodeStatus = Literal["provisioning", "ready", "error", "retired"]
TriggerType = Literal["proactive", "reactive", "manual"]


class Node(BaseModel):
    node_id: str
    display_name: str
    connection_string: str
    neon_project_id: str
    status: NodeStatus
    created_at: str  # ISO-8601

    def public_dict(self) -> dict:
        """Every field except the connection string — the ONLY shape any
        admin-facing read endpoint may ever return (§7.1: never expose a
        live database credential to the browser, even to an authenticated
        admin). Not called anywhere yet in this phase; the leak-prevention
        lives with the model it protects so a later router can't forget it."""
        return self.model_dump(exclude={"connection_string"})


class NoActiveNodeError(RuntimeError):
    """No active node in the registry, and no previously-known value to
    fall back to (§7.1) — either Bootstrap (§6) hasn't run yet, or this is
    a cold start with Redis already unreachable. Narrow and rare; every
    other Redis failure mode in this module degrades instead of raising."""


class BootstrapAlreadyDoneError(RuntimeError):
    """Raised by ``bootstrap()`` when ``filecast:nodes:active`` is already
    set — Bootstrap (§6) is a run-once step against a still-empty registry,
    not something safe to repeat against a live pool."""


# --------------------------------------------------------------------------- #
# Registry: node_id -> Node
# --------------------------------------------------------------------------- #


async def register_node(node: Node) -> None:
    """Write (or overwrite) one node's record in the registry hash."""
    await asyncio.wait_for(
        redis_client.hset(REGISTRY_KEY, node.node_id, node.model_dump_json()),
        timeout=REDIS_CALL_TIMEOUT_SECONDS,
    )


async def get_node(node_id: str) -> Node | None:
    raw = await asyncio.wait_for(
        redis_client.hget(REGISTRY_KEY, node_id), timeout=REDIS_CALL_TIMEOUT_SECONDS
    )
    if raw is None:
        return None
    try:
        return Node.model_validate_json(raw)
    except ValidationError:
        logger.error(
            "Corrupt registry entry for node_id=%s",
            node_id,
            exc_info=True,
            extra={
                "data": {"event": "node_registry_corrupt_entry", "node_id": node_id}
            },
        )
        return None


async def list_nodes() -> list[Node]:
    raw = await asyncio.wait_for(
        redis_client.hgetall(REGISTRY_KEY), timeout=REDIS_CALL_TIMEOUT_SECONDS
    )
    nodes = []
    for node_id, blob in raw.items():
        try:
            nodes.append(Node.model_validate_json(blob))
        except ValidationError:
            logger.error(
                "Corrupt registry entry for node_id=%s — skipped",
                node_id,
                exc_info=True,
                extra={
                    "data": {"event": "node_registry_corrupt_entry", "node_id": node_id}
                },
            )
    return nodes


async def find_node_by_neon_project_id(neon_project_id: str) -> Node | None:
    """Used by provisioning (§7.8, a later phase) to reject a duplicate
    ``neon_project_id`` before it can double-count that project's usage
    across two registry entries. Not called anywhere yet in this phase."""
    for node in await list_nodes():
        if node.neon_project_id == neon_project_id:
            return node
    return None


# --------------------------------------------------------------------------- #
# Active pointer, with the Redis-unavailability fallback (§7.1)
# --------------------------------------------------------------------------- #

# Same short-TTL-in-process-cache idea as any other per-request Redis lookup
# this app already caches (redis_client.py) — avoids a Redis round trip on
# every single call while still noticing a real switch within a few seconds.
ACTIVE_NODE_CACHE_TTL_SECONDS = 3

# Process-global by design: one FastAPI worker process (of the 4) or the one
# job_worker.py process, each with its own Python interpreter, so there is no
# cross-process sharing to worry about here — Redis is the only thing shared
# across those processes.
_cached_active_node_id: str | None = None
_cached_active_node_at: float = 0.0  # time.monotonic() of the last successful read


async def get_active_node() -> str:
    """The node_id currently serving traffic (compare directly against a
    candidate node_id, e.g. ``node_id == await get_active_node()`` — §7.8's
    active-node-retire check does exactly this).

    Redis is a harder dependency here than anywhere else in the app: unlike
    the rate limiter or the job-wake signal, there is no sensible value to
    fail open to (§7.1) — "no rate limiting" is a safe default, "no idea
    which database to use" is not. So this falls back to the last
    successfully-read value instead, and only raises if it has never
    successfully read one.
    """
    global _cached_active_node_id, _cached_active_node_at

    now = time.monotonic()
    if (
        _cached_active_node_id is not None
        and now - _cached_active_node_at < ACTIVE_NODE_CACHE_TTL_SECONDS
    ):
        return _cached_active_node_id

    try:
        node_id = await asyncio.wait_for(
            redis_client.get(ACTIVE_KEY), timeout=REDIS_CALL_TIMEOUT_SECONDS
        )
    except Exception:  # noqa: BLE001 — any failure here must fall back, not raise
        node_id = None

    if node_id:
        _cached_active_node_id = node_id
        _cached_active_node_at = now
        return node_id

    if _cached_active_node_id is not None:
        logger.warning(
            "Active-node lookup failed (Redis unreachable, or "
            "filecast:nodes:active unset) — falling back to last-known-active "
            "node_id=%s",
            _cached_active_node_id,
            extra={
                "data": {
                    "event": "active_node_fallback",
                    "node_id": _cached_active_node_id,
                }
            },
        )
        return _cached_active_node_id

    raise NoActiveNodeError(
        "No active node registered, and no previously-known value to fall back "
        "to. Either Bootstrap (NEON_FAILOVER_PLAN.md §6) has not run yet, or "
        "this is a cold start with Redis already unreachable."
    )


async def set_active_node(node_id: str) -> None:
    await asyncio.wait_for(
        redis_client.set(ACTIVE_KEY, node_id), timeout=REDIS_CALL_TIMEOUT_SECONDS
    )


# --------------------------------------------------------------------------- #
# Maintenance flag (§7.6 consumes this; owned here since it's registry state)
# --------------------------------------------------------------------------- #


async def is_maintenance() -> bool:
    """Fails open (returns False) on a Redis read error, deliberately —
    every other Redis-backed gate in this app fails open, and a Redis blip
    with no cutover in progress must never block every write on the site
    (§7.6). The narrow accepted tradeoff: a write could slip through during
    the same brief window a real cutover AND a Redis outage coincide."""
    try:
        value = await asyncio.wait_for(
            redis_client.get(MAINTENANCE_KEY), timeout=REDIS_CALL_TIMEOUT_SECONDS
        )
    except Exception:  # noqa: BLE001 — fail open, see docstring
        logger.warning(
            "Maintenance-flag read failed — treating as not-in-maintenance",
            extra={"data": {"event": "maintenance_read_failed"}},
        )
        return False
    return value == "1"


async def set_maintenance(enabled: bool) -> None:
    if enabled:
        await asyncio.wait_for(
            redis_client.set(MAINTENANCE_KEY, "1"), timeout=REDIS_CALL_TIMEOUT_SECONDS
        )
    else:
        await asyncio.wait_for(
            redis_client.delete(MAINTENANCE_KEY), timeout=REDIS_CALL_TIMEOUT_SECONDS
        )


# --------------------------------------------------------------------------- #
# Pool-operation lock (§7.1) — atomic acquire, TTL'd, tension with operation
# timeouts made explicit below
# --------------------------------------------------------------------------- #

# Long enough to comfortably cover the largest expected full-database sync
# (a switch's top-up, or a brand-new node's initial seed, §7.5/§7.8) — this
# TTL exists ONLY to recover a *crashed* job_worker.py mid-operation
# (mirroring recover_orphaned_jobs()'s reasoning for `converting` rows), not
# to bound how long a legitimate operation may run.
POOL_OP_LOCK_TTL_SECONDS = 20 * 60

# §7.1's "kept in tension" requirement: a guarded operation's own hard
# timeout (a pg_dump/pg_restore subprocess timeout, a Neon connect timeout —
# node_sync.py, a later phase) must be strictly shorter than the lock's TTL,
# with margin, or a merely-slow-but-still-alive operation can have its lock
# expire out from under it, letting a second operation start concurrently
# against the same source node — the exact race the lock exists to prevent,
# reintroduced through its own recovery mechanism. This margin is enforced
# in code, not just documented, so a future caller that gets it wrong fails
# loudly instead of silently reopening that race.
_OPERATION_TIMEOUT_MARGIN_SECONDS = 30


def assert_safe_operation_timeout(operation_timeout_seconds: float) -> None:
    """Raise if ``operation_timeout_seconds`` isn't safely under
    ``POOL_OP_LOCK_TTL_SECONDS``. Call this from any future caller that
    acquires the pool-operation lock (``node_sync.py``, a later phase) with
    the timeout it's about to bound its own subprocess/connect calls with."""
    limit = POOL_OP_LOCK_TTL_SECONDS - _OPERATION_TIMEOUT_MARGIN_SECONDS
    if operation_timeout_seconds > limit:
        raise ValueError(
            f"operation timeout ({operation_timeout_seconds}s) is not safely "
            f"under the pool-op lock TTL ({POOL_OP_LOCK_TTL_SECONDS}s, "
            f"{_OPERATION_TIMEOUT_MARGIN_SECONDS}s margin) — the lock could "
            "expire out from under a still-running operation instead of only "
            "ever firing on a true crash."
        )


# Standard compare-and-delete release: only the holder that presented the
# matching token may delete the lock. A plain GET-then-DEL from Python would
# race a fresh acquire that happened between the two calls (e.g. this
# operation's own timeout fired just as the TTL also expired) — the two
# Redis calls below must be one atomic unit.
_RELEASE_LOCK_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
else
    return 0
end
"""
_release_lock_script = redis_client.register_script(_RELEASE_LOCK_SCRIPT)


async def acquire_pool_lock(
    holder: str, *, ttl_seconds: float = POOL_OP_LOCK_TTL_SECONDS
) -> str | None:
    """Atomically acquire the pool-operation lock (``SET ... NX PX``) — a
    single Redis command, so two concurrent triggers can never both observe
    "unlocked" (§7.1). Returns a unique token the caller must hold onto and
    pass to ``release_pool_lock()``, or ``None`` if another operation
    already holds it. A ``None`` result must be logged and skipped at the
    call site (§7.4's concurrency guard) — never queued or retried here.

    ``holder`` is a free-form label (e.g. ``"switch:{run_id}"``) folded into
    the token purely for diagnostics if the lock is ever inspected mid-hold.
    """
    token = f"{holder}:{secrets.token_hex(8)}"
    try:
        acquired = await asyncio.wait_for(
            redis_client.set(
                POOL_OP_LOCK_KEY, token, nx=True, px=int(ttl_seconds * 1000)
            ),
            timeout=REDIS_CALL_TIMEOUT_SECONDS,
        )
    except Exception:  # noqa: BLE001 — treat as "lock unavailable", see docstring
        logger.error(
            "Pool-lock acquire failed (Redis unreachable) for holder=%s",
            holder,
            exc_info=True,
            extra={"data": {"event": "pool_lock_acquire_error", "holder": holder}},
        )
        return None
    return token if acquired else None


async def release_pool_lock(token: str) -> bool:
    """Release the pool-operation lock, but only if ``token`` still matches
    the current holder — see ``_RELEASE_LOCK_SCRIPT`` above for why this
    can't be a plain DEL. Returns ``False`` (not raised) if the lock had
    already expired or been taken over by someone else; that is a normal
    outcome for an operation that overran its own timeout, not an error."""
    try:
        result = await asyncio.wait_for(
            _release_lock_script(keys=[POOL_OP_LOCK_KEY], args=[token]),
            timeout=REDIS_CALL_TIMEOUT_SECONDS,
        )
    except Exception:  # noqa: BLE001 — treat as "release failed", see docstring
        logger.error(
            "Pool-lock release failed (Redis unreachable)",
            exc_info=True,
            extra={"data": {"event": "pool_lock_release_error"}},
        )
        return False
    return bool(result)


async def force_release_pool_lock() -> None:
    """Unconditional release, independent of any token — for job_worker.py
    startup (§7.1: "on job_worker.py startup, check for and clear a stale
    lock the same way [recover_orphaned_jobs] already checks for orphaned
    converting rows"). A lock can only ever be legitimately held by a task
    running inside a job_worker.py process; a fresh process starting up
    means any lock still set belongs to a now-dead previous incarnation.
    Not called anywhere yet in this phase — job_worker.py isn't touched
    until a later phase."""
    await asyncio.wait_for(
        redis_client.delete(POOL_OP_LOCK_KEY), timeout=REDIS_CALL_TIMEOUT_SECONDS
    )


@asynccontextmanager
async def pool_operation_lock(
    holder: str, *, ttl_seconds: float = POOL_OP_LOCK_TTL_SECONDS
):
    """``async with pool_operation_lock("switch:abc123") as token:`` — yields
    the token on success, or ``None`` immediately if the lock is already
    held elsewhere (callers must check for ``None``, per
    ``acquire_pool_lock``'s docstring). Always releases on the way out,
    success or exception, via the safe compare-and-delete."""
    token = await acquire_pool_lock(holder, ttl_seconds=ttl_seconds)
    try:
        yield token
    finally:
        if token is not None:
            await release_pool_lock(token)


# --------------------------------------------------------------------------- #
# Shared consecutive-failure counter (§7.4's reactive trigger)
# --------------------------------------------------------------------------- #


async def increment_health_fail_count() -> int:
    """Must be Redis-backed, not in-process — ``api`` runs 4 worker
    processes, and there's no guarantee consecutive health-check requests
    land on the same one (§7.1)."""
    return await asyncio.wait_for(
        redis_client.incr(HEALTH_FAIL_COUNT_KEY), timeout=REDIS_CALL_TIMEOUT_SECONDS
    )


async def reset_health_fail_count() -> None:
    await asyncio.wait_for(
        redis_client.delete(HEALTH_FAIL_COUNT_KEY), timeout=REDIS_CALL_TIMEOUT_SECONDS
    )


async def get_health_fail_count() -> int:
    value = await asyncio.wait_for(
        redis_client.get(HEALTH_FAIL_COUNT_KEY), timeout=REDIS_CALL_TIMEOUT_SECONDS
    )
    return int(value) if value else 0


# --------------------------------------------------------------------------- #
# Usage cache (§7.3)
# --------------------------------------------------------------------------- #


class UsageCache(BaseModel):
    ratio: float
    checked_at: str  # ISO-8601


# Comfortably longer than the default 15-minute poll interval (§8) so one
# missed poll cycle doesn't drop straight to "no cached value" — the switch
# decision (§7.4) reads this cache, never a live call, precisely so a
# transient Neon API failure doesn't block a decision.
USAGE_CACHE_TTL_SECONDS = 30 * 60


async def set_usage_cache(
    node_id: str, ratio: float, *, checked_at: datetime | None = None
) -> None:
    payload = UsageCache(
        ratio=ratio, checked_at=(checked_at or datetime.now(UTC)).isoformat()
    )
    await asyncio.wait_for(
        redis_client.set(
            _usage_key(node_id), payload.model_dump_json(), ex=USAGE_CACHE_TTL_SECONDS
        ),
        timeout=REDIS_CALL_TIMEOUT_SECONDS,
    )


async def get_usage_cache(node_id: str) -> UsageCache | None:
    raw = await asyncio.wait_for(
        redis_client.get(_usage_key(node_id)), timeout=REDIS_CALL_TIMEOUT_SECONDS
    )
    if raw is None:
        return None
    try:
        return UsageCache.model_validate_json(raw)
    except ValidationError:
        return None


# --------------------------------------------------------------------------- #
# Last-activity timestamps (§7.1/§7.12 — drives the admin panel's "days
# inactive" column; updated for both sides of every sync, §7.5)
# --------------------------------------------------------------------------- #


async def record_activity(node_id: str, *, when: datetime | None = None) -> None:
    await asyncio.wait_for(
        redis_client.set(
            _last_activity_key(node_id), (when or datetime.now(UTC)).isoformat()
        ),
        timeout=REDIS_CALL_TIMEOUT_SECONDS,
    )


async def get_last_activity(node_id: str) -> datetime | None:
    raw = await asyncio.wait_for(
        redis_client.get(_last_activity_key(node_id)),
        timeout=REDIS_CALL_TIMEOUT_SECONDS,
    )
    if raw is None:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


# --------------------------------------------------------------------------- #
# Switch/provisioning run status + history (§7.1, §7.13)
# --------------------------------------------------------------------------- #


class SwitchStatus(BaseModel):
    status: Literal["pending", "done", "error"]
    detail: str | None = None
    source_node_id: str | None = None
    target_node_id: str | None = None
    trigger: TriggerType | None = None


# A finished run's status stays pollable for a day, then expires — nothing
# needs it after the admin panel has shown the terminal state, and without a
# TTL this key would grow unbounded, one entry per switch/provision, forever.
SWITCH_STATUS_TTL_SECONDS = 24 * 60 * 60


async def set_switch_status(run_id: str, status: SwitchStatus) -> None:
    await asyncio.wait_for(
        redis_client.set(
            _switch_status_key(run_id),
            status.model_dump_json(),
            ex=SWITCH_STATUS_TTL_SECONDS,
        ),
        timeout=REDIS_CALL_TIMEOUT_SECONDS,
    )


async def get_switch_status(run_id: str) -> SwitchStatus | None:
    raw = await asyncio.wait_for(
        redis_client.get(_switch_status_key(run_id)), timeout=REDIS_CALL_TIMEOUT_SECONDS
    )
    if raw is None:
        return None
    try:
        return SwitchStatus.model_validate_json(raw)
    except ValidationError:
        return None


class SwitchHistoryEntry(BaseModel):
    trigger: TriggerType
    source_node_id: str
    target_node_id: str
    outcome: Literal["success", "failure"]
    detail: str | None = None
    at: str  # ISO-8601


# Plenty for the admin panel's History tab (§7.12); capped so the list
# itself never grows unbounded.
SWITCH_HISTORY_MAX_LEN = 50


async def append_switch_history(entry: SwitchHistoryEntry) -> None:
    await asyncio.wait_for(
        redis_client.lpush(SWITCH_HISTORY_KEY, entry.model_dump_json()),
        timeout=REDIS_CALL_TIMEOUT_SECONDS,
    )
    await asyncio.wait_for(
        redis_client.ltrim(SWITCH_HISTORY_KEY, 0, SWITCH_HISTORY_MAX_LEN - 1),
        timeout=REDIS_CALL_TIMEOUT_SECONDS,
    )


async def get_switch_history(
    limit: int = SWITCH_HISTORY_MAX_LEN,
) -> list[SwitchHistoryEntry]:
    raw_items = await asyncio.wait_for(
        redis_client.lrange(SWITCH_HISTORY_KEY, 0, limit - 1),
        timeout=REDIS_CALL_TIMEOUT_SECONDS,
    )
    entries = []
    for raw in raw_items:
        try:
            entries.append(SwitchHistoryEntry.model_validate_json(raw))
        except ValidationError:
            continue
    return entries


# --------------------------------------------------------------------------- #
# Settings (§8) — admin-editable, with hardcoded fallback defaults
# --------------------------------------------------------------------------- #


class NodeSettings(BaseModel):
    warmup_threshold_pct: int = 70
    cutover_threshold_pct: int = 80
    usage_poll_interval_minutes: int = 15
    inactivity_warning_days: int = 14
    reactive_failure_count: int = 2


# These are not just initial values — §8 requires them to also be the
# fallback used if filecast:nodes:settings can't be read from Redis at all.
DEFAULT_NODE_SETTINGS = NodeSettings()


async def get_settings() -> NodeSettings:
    try:
        raw = await asyncio.wait_for(
            redis_client.hgetall(SETTINGS_KEY), timeout=REDIS_CALL_TIMEOUT_SECONDS
        )
    except Exception:  # noqa: BLE001 — fall back to hardcoded defaults, see §8
        logger.warning(
            "Settings read failed — using hardcoded defaults",
            extra={"data": {"event": "node_settings_fallback"}},
        )
        return DEFAULT_NODE_SETTINGS.model_copy()

    if not raw:
        return DEFAULT_NODE_SETTINGS.model_copy()

    merged = DEFAULT_NODE_SETTINGS.model_dump() | raw
    try:
        return NodeSettings.model_validate(merged)
    except ValidationError:
        logger.error(
            "Corrupt settings hash — using hardcoded defaults",
            exc_info=True,
            extra={"data": {"event": "node_settings_corrupt"}},
        )
        return DEFAULT_NODE_SETTINGS.model_copy()


async def update_settings(partial: dict[str, int]) -> NodeSettings:
    """Validate and merge a partial update into the settings hash — each
    admin-edited field takes effect immediately (§7.12/§8), no batch save.
    Raises ``ValueError`` for a field name that isn't one of the five known
    settings, or ``pydantic.ValidationError`` for an out-of-range/wrong-type
    value on a known one; the caller (a later phase's PUT route) turns
    either into a 4xx.

    Writes ONLY the fields named in ``partial`` back to the hash — never the
    full merged snapshot. §7.12 designs each of the five settings as its
    own independently auto-saving control (no batch submit), so two
    concurrent edits to two DIFFERENT fields are a real scenario (two
    browser tabs, or a slow request overlapping a fast one); a full-hash
    read-merge-write here would let the second write's stale snapshot of
    the FIRST field silently clobber the first write's change to it.
    Writing only the touched field(s) makes concurrent edits to different
    fields commute correctly instead of racing.
    """
    unknown = set(partial) - set(NodeSettings.model_fields)
    if unknown:
        # NodeSettings ignores unknown keys on validate (deliberately, so a
        # stray/legacy field in the Redis hash doesn't sink the whole
        # fallback-to-defaults read path in get_settings()) — so an unknown
        # key here would otherwise silently vanish during merge/validate
        # and then raise a confusing AttributeError below instead of a
        # clean, actionable error.
        raise ValueError(f"Unknown settings field(s): {sorted(unknown)}")
    current = await get_settings()
    updated = NodeSettings.model_validate(current.model_dump() | partial)
    changed = {key: str(getattr(updated, key)) for key in partial}
    await asyncio.wait_for(
        redis_client.hset(SETTINGS_KEY, mapping=changed),
        timeout=REDIS_CALL_TIMEOUT_SECONDS,
    )
    return updated


# --------------------------------------------------------------------------- #
# Bootstrap (§6) — see scripts/bootstrap_node_registry.py for the runnable
# entrypoint. The logic lives here so it can be unit-tested directly against
# a fake registry without going through argparse/CLI plumbing.
# --------------------------------------------------------------------------- #


async def bootstrap(
    *,
    neon_project_id: str,
    connection_string: str,
    display_name: str = "Node 1 (bootstrap)",
    node_id: str | None = None,
) -> Node:
    """Register today's single existing Neon project as the pool's first
    node, and point the active pointer at it (§6). This is a **different**
    flow from normal provisioning (§7.8) — there is no "current active
    node" to sync from yet; this node already *is* the data, so no sync
    happens here at all.

    Idempotency guard: refuses if ``filecast:nodes:active`` is already set,
    since this is meant to run exactly once against a still-empty registry
    — a second run against a live pool could silently repoint production
    traffic's active pointer.
    """
    existing_active = await asyncio.wait_for(
        redis_client.get(ACTIVE_KEY), timeout=REDIS_CALL_TIMEOUT_SECONDS
    )
    if existing_active:
        raise BootstrapAlreadyDoneError(
            f"filecast:nodes:active is already set to {existing_active!r} — "
            "bootstrap has already run. Refusing to overwrite it."
        )

    node = Node(
        node_id=node_id or secrets.token_hex(8),
        display_name=display_name,
        connection_string=connection_string,
        neon_project_id=neon_project_id,
        status="ready",
        created_at=datetime.now(UTC).isoformat(),
    )
    await register_node(node)
    await set_active_node(node.node_id)
    return node
