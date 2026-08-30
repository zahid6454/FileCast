"""Data sync mechanism — NEON_FAILOVER_PLAN.md §7.5, Phase C.

One shared implementation, parameterized by ``(source_node_id,
target_node_id)``, meant to be used by every later phase's data-moving
operation: the warm-up sync, the final cutover top-up sync, the weekly
keep-alive sync (§7.9), and initial data seeding during node provisioning
(§7.8). None of those callers exist yet — this module is only the mechanism.
Nothing in the running app calls ``sync_node()`` yet, so this file produces
zero behavior change on its own.

**Intended calling convention for later phases** (not implemented here):
``sync_node()`` is a plain coroutine, so a caller gets to choose how to run
it. The warm-up/keep-alive/provisioning syncs are meant to be fired as a
background task, reusing ``data/job_worker.py``'s own
``_background_tasks: set[asyncio.Task]`` strong-reference pattern
(``asyncio.create_task`` + ``add_done_callback`` inside ``_discovery_wake()``)
so a sync can't be silently garbage-collected mid-run and doesn't block that
loop's own responsiveness. The **final cutover sync** is the one exception:
it's fine for a caller to just ``await sync_node(...)`` in-line there,
because job intake is already intentionally paused for its entire duration
(§7.7) — there's nothing else for the loop to be responsive to at that
specific moment.

**Whole-operation timeout, not a per-step one.** §7.1's "kept in tension"
requirement is that the operations the pool-operation lock guards must be
bounded by a hard timeout strictly shorter than the lock's own TTL, so the
lock only ever expires on a true crash, never on a merely-slow operation.
A caller of ``sync_node()`` is expected to hold that lock for the whole
call. Three subprocesses run per invocation (migration, dump, restore) —
bounding each independently by the same generous timeout could let their
sum exceed the lock's TTL even though each individual step "passed". So
``sync_node()`` instead computes ONE overall deadline
(``SYNC_OPERATION_TIMEOUT_SECONDS`` from the moment it's called) and gives
each subprocess only whatever time remains in that shared budget —
``SYNC_OPERATION_TIMEOUT_SECONDS`` itself is checked against the pool-lock's
TTL at import time via ``node_registry.assert_safe_operation_timeout()``, so
a regression here fails loudly at process startup, not silently in
production.
"""

import asyncio
import os
import re
import secrets
import sys
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path

from data.node_registry import (
    Node,
    assert_safe_operation_timeout,
    get_node,
    record_activity,
)
from log import get_logger

logger = get_logger("node_sync")

# The api/ directory (this file lives at api/scripts/node_sync.py) — alembic.ini
# and the migrations/ package it points at live there, so the migration
# subprocess below needs this as its cwd regardless of the caller's own cwd.
API_DIR = Path(__file__).resolve().parent.parent

# Whole-operation budget for one sync_node() call (migration + dump +
# restore combined) — see the module docstring for why this is one shared
# deadline rather than three independent per-step timeouts. Comfortably
# under node_registry.POOL_OP_LOCK_TTL_SECONDS (20min) with its required
# margin; validated below, not just documented.
SYNC_OPERATION_TIMEOUT_SECONDS = 15 * 60

assert_safe_operation_timeout(SYNC_OPERATION_TIMEOUT_SECONDS)

# Postgres client tools must be v18, matching Neon's actual project version
# — Debian's default postgresql-client metapackage resolves to v17 (§7.5).
# The Dockerfile installs postgresql-client-18 via the PGDG apt repo, which
# places versioned binaries at this conventional Debian/Ubuntu path rather
# than relying on postgresql-client-common's wrapper-script version
# selection (/usr/bin/pg_dump) to pick the right one. Overridable via env
# var so tests (and any environment with a different layout) can point at
# whatever v18 binaries are actually available.
PG_DUMP_BIN = os.getenv("PG_DUMP_BIN", "/usr/lib/postgresql/18/bin/pg_dump")
PG_RESTORE_BIN = os.getenv("PG_RESTORE_BIN", "/usr/lib/postgresql/18/bin/pg_restore")

# Bounds only the libpq *connect* phase of the dump/restore subprocesses —
# the overall subprocess is separately bounded by the shared remaining-time
# budget above. This just makes a genuinely-unreachable node fail fast with
# a clear libpq error instead of silently eating into that budget on a slow
# TCP handshake. A little more generous than data/db.py's
# CONNECT_TIMEOUT_SECONDS (5s) to leave room for a cold-starting Neon
# compute endpoint.
PG_CONNECT_TIMEOUT_SECONDS = 10

_DRIVER_SUFFIX_RE = re.compile(r"^postgresql\+[A-Za-z0-9_]+://")


class NodeSyncError(RuntimeError):
    """A migration/dump/restore step failed (nonzero exit) or a requested
    node has no registry record."""


class NodeSyncTimeoutError(NodeSyncError):
    """A step didn't finish within its share of SYNC_OPERATION_TIMEOUT_SECONDS
    — either it was killed mid-run, or there was no budget left to even start
    it. Distinguished from NodeSyncError so a future caller (§7.4's "target
    failure during warm-up: pick the next-best reserve node and retry" vs.
    "target failure during cutover: abort the flip") can tell a timeout apart
    from an outright failure if that distinction ever matters."""


def _libpq_url(url: str) -> str:
    """pg_dump/pg_restore (libpq-based) don't understand a SQLAlchemy driver
    suffix like ``+psycopg`` — same transformation
    ``.github/workflows/db-backup.yml``'s pg_dump step already applies to
    this same style of connection string."""
    return _DRIVER_SUFFIX_RE.sub("postgresql://", url)


async def _run_subprocess(
    args: list[str],
    *,
    env: dict[str, str] | None,
    remaining_seconds: float,
    description: str,
) -> None:
    """Run ``args`` via ``asyncio.create_subprocess_exec`` — never a blocking
    ``subprocess.run`` (§7.5): every caller of ``sync_node()`` runs inside
    ``data/job_worker.py``'s own event loop, which is single-instance and
    also responsible for picking up every real conversion job, so a blocking
    call here would stall all conversion processing for the duration of the
    dump/restore.

    Raises ``NodeSyncTimeoutError`` if ``remaining_seconds`` is already
    exhausted (killing the process if it had to be started to find out) or
    ``NodeSyncError`` on a nonzero exit — including a nonzero exit caused by
    the binary itself being missing/unreadable, or any other OS-level
    failure to spawn or manage the process. A future caller (§7.8: "any
    failure at any step marks error... never left holding the lock") is
    meant to catch exactly this two-member exception hierarchy, not have to
    also guard against a bare OSError escaping from underneath it.
    """
    if remaining_seconds <= 0:
        raise NodeSyncTimeoutError(
            f"{description}: no time remaining in this sync operation's "
            f"{SYNC_OPERATION_TIMEOUT_SECONDS}s overall budget"
        )

    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            cwd=API_DIR,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except OSError as exc:
        # The binary is missing/not executable, or some other OS-level
        # failure to even start the process (e.g. PG_DUMP_BIN misconfigured)
        # — must not escape as a bare OSError past this function's stable
        # NodeSyncError contract.
        raise NodeSyncError(f"{description}: failed to start ({exc})") from exc

    try:
        _stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=remaining_seconds
        )
    except TimeoutError:
        try:
            proc.kill()
            await proc.wait()
        except ProcessLookupError:
            # Lost the race: the process exited on its own between the
            # timeout firing and the kill — already gone, nothing left to
            # clean up.
            pass
        raise NodeSyncTimeoutError(
            f"{description} did not finish within its {remaining_seconds:.0f}s "
            "remaining budget — killed"
        ) from None

    if proc.returncode != 0:
        raise NodeSyncError(
            f"{description} failed (exit {proc.returncode}): "
            f"{stderr.decode(errors='replace')[-2000:]}"
        )


async def _run_migration(target: Node, *, remaining_seconds: float) -> None:
    """Bring the target's schema current before any data copy (§7.5/§7.10) —
    idempotent against an already-current schema, so it's safe and cheap to
    run on every single invocation, including a target that was already
    up to date. Same ``python -m alembic upgrade head`` shape as the
    Dockerfile's migration step, targeting ``target`` instead of whatever
    DATABASE_URL happens to resolve to."""
    await _run_subprocess(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        env={**os.environ, "DATABASE_URL": target.connection_string},
        remaining_seconds=remaining_seconds,
        description=f"migration against target node {target.node_id!r}",
    )


async def _dump(source: Node, dump_path: Path, *, remaining_seconds: float) -> None:
    """Full-database, data-only dump — every table, no curated subset (§7.5):
    session rows live in Postgres, so a partial sync that omitted, say, the
    sessions table would silently log users out on every switch."""
    await _run_subprocess(
        [
            PG_DUMP_BIN,
            "--format=custom",
            "--data-only",
            f"--file={dump_path}",
            _libpq_url(source.connection_string),
        ],
        env={**os.environ, "PGCONNECT_TIMEOUT": str(PG_CONNECT_TIMEOUT_SECONDS)},
        remaining_seconds=remaining_seconds,
        description=f"pg_dump from source node {source.node_id!r}",
    )


async def _restore(target: Node, dump_path: Path, *, remaining_seconds: float) -> None:
    """``--clean --data-only`` (§7.5): the target's tables already exist (the
    migration step above just ran), so this clears their existing rows
    before loading the fresh copy — safe on a brand-new, still-empty target
    too (deleting zero rows from an empty table is a no-op)."""
    await _run_subprocess(
        [
            PG_RESTORE_BIN,
            "--clean",
            "--data-only",
            f"--dbname={_libpq_url(target.connection_string)}",
            str(dump_path),
        ],
        env={**os.environ, "PGCONNECT_TIMEOUT": str(PG_CONNECT_TIMEOUT_SECONDS)},
        remaining_seconds=remaining_seconds,
        description=f"pg_restore into target node {target.node_id!r}",
    )


async def sync_node(source_node_id: str, target_node_id: str) -> None:
    """Migrate + copy every table's data from ``source_node_id`` to
    ``target_node_id`` (§7.5). The caller is responsible for holding the
    pool-operation lock (§7.1) for the duration of this call — this function
    only bounds its own wall-clock time against
    ``SYNC_OPERATION_TIMEOUT_SECONDS``, it does not acquire the lock itself,
    since a future caller may need to do other work (e.g. the drain step,
    §7.7) under the same lock hold.

    Does **not** sync application files (conversion input/output bytes) —
    those live on a shared disk volume outside Postgres, entirely
    independent of which node is active (§7.5).
    """
    deadline = time.monotonic() + SYNC_OPERATION_TIMEOUT_SECONDS

    source = await get_node(source_node_id)
    if source is None:
        raise NodeSyncError(f"source node {source_node_id!r} has no registry record")
    target = await get_node(target_node_id)
    if target is None:
        raise NodeSyncError(f"target node {target_node_id!r} has no registry record")

    await _run_migration(target, remaining_seconds=deadline - time.monotonic())

    dump_path = Path(tempfile.gettempdir()) / f"node_sync_{secrets.token_hex(8)}.dump"
    try:
        await _dump(source, dump_path, remaining_seconds=deadline - time.monotonic())
        await _restore(target, dump_path, remaining_seconds=deadline - time.monotonic())
    finally:
        dump_path.unlink(missing_ok=True)

    logger.info(
        "Node sync complete: %s -> %s",
        source_node_id,
        target_node_id,
        extra={
            "data": {
                "event": "node_sync_complete",
                "source_node_id": source_node_id,
                "target_node_id": target_node_id,
            }
        },
    )

    # Reading from the source counts as activity too, not just writing to
    # the target (§7.1/§7.5) — both timestamps use the same instant so the
    # admin panel's "days inactive" column reflects this sync consistently
    # for either node.
    now = datetime.now(UTC)
    await record_activity(source_node_id, when=now)
    await record_activity(target_node_id, when=now)
