"""Database engines and session factories.

One set of model classes (``models.py``) is shared by two static engines built
from the same ``DATABASE_URL`` (psycopg3 drives both, §14-F7):

- **Async** — ``async_engine``/``async_session_factory``.
- **Sync** — ``sync_engine``/``sync_session_factory``, used by ``seed.py``,
  ``build.py`` (Phase 2), Alembic, and test schema setup (``conftest.py``).

These two stay eagerly built from ``settings.database_url`` exactly as before
— they're what every dev/test/CI environment (no Neon nodes registered at
all) and Alembic's own ``env.py`` still bind to directly, unaffected by
anything below.

**N-way dynamic access (NEON_FAILOVER_PLAN.md §7.2, Phase B).** The app
itself no longer binds to a fixed engine: ``get_session()`` (the FastAPI
dependency) and ``sync_session()`` (the context manager) resolve the
*currently active node* via ``node_registry.get_active_node()`` on every
call and use a lazily-constructed, cached engine for that node — never a
hardcoded reference. ``get_active_engine()``/``get_active_session_factory()``
expose that same resolution to callers that need engine-level access
(a raw ``.connect()``, or ``.dispose()`` on shutdown) rather than a session.

Per-node engines are constructed lazily, on first use, and cached by
``node_id`` — never built eagerly for every registered node at once, since
the pool can grow at runtime (no fixed list to build upfront) and eagerly
connecting to N Neon projects at import time would also mean every dev/CI
environment crashes on startup.

**Fallback to the static engines above, deliberately** — when the registry
has nothing to resolve (Redis unreachable with no prior cache, or simply no
node ever registered — the normal dev/test/CI state, and the narrow
pre-Bootstrap window in production), every dynamic accessor here falls back
to ``async_engine``/``sync_engine`` rather than propagating
``node_registry.NoActiveNodeError``. This mirrors §7.10's Dockerfile
migration fix (same fallback-to-``DATABASE_URL`` reasoning) and is what lets
``conftest.py`` and every existing test keep working against the static test
database unmodified, with zero nodes ever registered in the test Redis.

Schema is owned by Alembic (§7); there is **no** ``create_all()`` at runtime.
"""

import asyncio
from collections.abc import AsyncIterator
from contextlib import contextmanager
from typing import NamedTuple

from log import get_logger
from sqlalchemy import Engine, MetaData, create_engine, event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from data.config import settings
from data.node_registry import (
    NoActiveNodeError,
    get_active_node,
    get_active_node_sync,
    get_node,
    get_node_sync,
)

logger = get_logger("db")

# Project-wide constraint naming convention so every PK/FK/unique/index/check
# gets a deterministic, human-readable name (e.g. uq_users_email,
# fk_sessions_user_id_users) instead of a Postgres-assigned default. This makes
# future migrations that drop/alter constraints stable and predictable across
# environments. Explicit names on a model constraint still win over these.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_name)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def _sync_url(url: str) -> str:
    """psycopg3 works for both, but strip an accidental async marker if present."""
    return url.replace("+asyncpg", "+psycopg")


# Bound the *connect* phase (seconds) so an unreachable DB fails fast instead of
# blocking indefinitely. This is what lets DB-optional callers actually degrade:
# build.py's overlay fetch swallows the error and builds from YAML (P10), and
# seed/Alembic run against a healthy DB where the connect is immediate anyway.
# Only the initial connect is bounded — query execution is unaffected.
CONNECT_TIMEOUT_SECONDS = 5


def _register_search_path_fix(engine: Engine) -> None:
    """Force ``search_path = public`` on every physical connection this
    engine's pool ever hands out — both when it's first opened AND every
    time it's checked out of the pool for reuse (NEON_FAILOVER_PLAN.md
    §7.2/§7.5/§7.8, Phase D write-up in §11).

    Closes the gap the Phase D rehearsal actually hit in production: a Neon
    project created straight from the console (not via ``neonctl init``) can
    leave its owner role's ``search_path`` empty, and PR #152's fix
    (``scripts/node_sync.py``'s ``_ensure_search_path()``, a persistent
    role-level ``ALTER ROLE ... SET search_path``) only covers the
    orchestration path — migration/dump/truncate/restore. It does NOT cover
    this module, which is what every real request actually connects through
    via ``get_session()``/``sync_session()``. During the rehearsal's live
    cutover, ``current_user()`` (the auth dependency on every authenticated
    route) 500'd with ``UndefinedTable: relation "users" does not exist`` for
    ~3.5 minutes after the switch, then self-resolved.

    **PR #153 originally hooked only the pool's ``"connect"`` event** (fires
    once, the moment SQLAlchemy's pool physically opens a new DBAPI
    connection) on the reasoning that this was "immediate regardless of
    pooler timing." That reasoning had a hole, and it resurfaced for real on
    2026-09-01: a `current_user()` burst against FileCast-2 — the
    already-active, already-"fixed" node, untouched by that day's FileCast-3
    provisioning — threw the identical `UndefinedTable` error 6 times in a
    ~12s window, then self-resolved with no restart. Neon's pooled
    connection string runs PgBouncer-style *transaction-mode* pooling: the
    client-facing connection SQLAlchemy holds onto can be silently
    reassigned to a different backend Postgres session between transactions
    (confirmed both empirically — see `_ensure_search_path()`'s own
    docstring, which caught a *freshly-opened* pooled connection still
    serving a stale backend seconds after an `ALTER ROLE` had committed via
    a direct connection — and in Neon's own docs: "the next transaction may
    land on a different server connection that does not carry the session
    setting forward"). SQLAlchemy's pool has no way to know this happened —
    from its point of view the DBAPI connection object never closed, so
    ``"connect"`` never fires again — which meant a connection that had
    correctly gotten ``search_path = public`` set hours or days earlier
    could silently start serving queries against a different backend
    session with a broken default, with nothing in this module re-asserting
    it. (PR #153's own test suite never could have caught this: it ran
    against a plain local Postgres container with no pooler in front, where
    ``"connect"`` genuinely is 1:1 with a backend session.)

    The fix is the same mechanism applied to the pool's ``"checkout"``
    event too (fires every time a connection is handed out of the pool for
    use — including the first time, right after ``"connect"``, so the two
    together mean "on every physical connect, and immediately before every
    single use"). This costs one extra trivial round-trip per checkout
    (typically once per request), which is the correct trade for a class of
    bug that otherwise reappears nondeterministically on connections that
    were already believed fixed. Note ``pool_pre_ping=True`` (set on every
    engine below) does NOT substitute for this: it only runs a liveness
    ``SELECT 1`` on checkout to decide whether to invalidate-and-reconnect
    the connection — on the common case where the ping succeeds (the
    connection IS alive, just possibly against a reassigned backend), it
    does not touch session state and does not re-fire ``"connect"``.

    Toggle ``autocommit`` around the ``SET`` rather than leaving it inside
    an ordinary (rollback-able) transaction, and restore whatever autocommit
    value the driver had before — psycopg (sync and, via SQLAlchemy's
    greenlet-based async adapter, async) both expose
    ``dbapi_connection.autocommit`` as a plain attribute regardless of which
    mode constructed the connection. This is SQLAlchemy's own documented
    recipe for setting a Postgres session parameter on connect, applied here
    to checkout as well.

    Applied to all four engines this module builds (static async, static
    sync, and both per-node async/sync constructors below) — missing any one
    would leave this exact gap open for whichever traffic path uses it."""

    def _set_search_path(dbapi_connection) -> None:
        existing_autocommit = dbapi_connection.autocommit
        dbapi_connection.autocommit = True
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("SET SESSION search_path = public")
        finally:
            cursor.close()
        dbapi_connection.autocommit = existing_autocommit

    @event.listens_for(engine, "connect")
    def _on_connect(dbapi_connection, connection_record) -> None:  # noqa: ARG001
        _set_search_path(dbapi_connection)

    @event.listens_for(engine, "checkout")
    def _on_checkout(dbapi_connection, connection_record, connection_proxy) -> None:  # noqa: ARG001
        _set_search_path(dbapi_connection)


# --- Static async engine — the dev/test/CI and pre-Bootstrap fallback ---
async_engine = create_async_engine(settings.database_url, pool_pre_ping=True)
_register_search_path_fix(async_engine.sync_engine)
async_session_factory = async_sessionmaker(
    async_engine, expire_on_commit=False, class_=AsyncSession
)


# --- Static sync engine (scripts + Alembic + conftest.py's schema setup) ---
sync_engine = create_engine(
    _sync_url(settings.database_url),
    pool_pre_ping=True,
    connect_args={"connect_timeout": CONNECT_TIMEOUT_SECONDS},
)
_register_search_path_fix(sync_engine)
sync_session_factory = sessionmaker(sync_engine, expire_on_commit=False)


# --------------------------------------------------------------------------- #
# N-way dynamic per-node engines (§7.2) — async side
# --------------------------------------------------------------------------- #


class _AsyncNodeEngine(NamedTuple):
    engine: AsyncEngine
    session_factory: async_sessionmaker[AsyncSession]


# node_id -> its lazily-constructed engine/session-factory pair. In practice
# only the active node and, briefly, a sync target are ever actually
# connected to at once (§7.2) — an unbounded cache is fine at this scale.
_async_node_engines: dict[str, _AsyncNodeEngine] = {}

# Same double-checked-locking shape as node_registry's own active-node cache
# refresh: without this, two concurrent cache-misses for the same node_id
# would each construct their own engine, and the second to finish would
# silently replace the first in the cache — harmless for correctness here
# (both point at the same database), but it leaks the first engine's pool
# connections since nothing ever calls .dispose() on it.
_async_node_engines_lock = asyncio.Lock()


async def _get_active_async_engine() -> _AsyncNodeEngine:
    try:
        node_id = await get_active_node()
    except NoActiveNodeError:
        return _AsyncNodeEngine(async_engine, async_session_factory)

    # Checked BEFORE any registry lookup, not just before engine construction:
    # once an engine is cached for this node_id, there's no need to re-fetch
    # its Node record (a real Redis HGET) on every single request just to
    # re-derive a connection_string we already built an engine from — that
    # would turn every request into two Redis round trips instead of the one
    # get_active_node() itself already needs.
    cached = _async_node_engines.get(node_id)
    if cached is not None:
        return cached

    async with _async_node_engines_lock:
        cached = _async_node_engines.get(node_id)
        if cached is not None:
            return cached

        node = None
        try:
            node = await get_node(node_id)
        except Exception:  # noqa: BLE001 — a registry-lookup hiccup must fall
            # back to the static engine, not raise — get_node() (§7.1,
            # node_registry.py) propagates Redis errors loudly by design for
            # its OTHER (admin/provisioning) callers, but this dynamic
            # accessor's whole contract is graceful degradation on any
            # resolution failure, the same as the NoActiveNodeError case
            # above. Left unguarded, a transient Redis hiccup on this one
            # call would 500 every request through get_session() and, worse,
            # crash job_worker.py outright at startup (recover_orphaned_jobs()
            # has no try/except around this call chain).
            logger.error(
                "Registry lookup for active node_id=%s failed — falling back "
                "to the static DATABASE_URL engine",
                node_id,
                exc_info=True,
                extra={
                    "data": {
                        "event": "active_node_lookup_failed",
                        "node_id": node_id,
                    }
                },
            )
        else:
            if node is None:
                logger.error(
                    "Active node id=%s has no registry record — falling back "
                    "to the static DATABASE_URL engine",
                    node_id,
                    extra={
                        "data": {
                            "event": "active_node_record_missing",
                            "node_id": node_id,
                        }
                    },
                )

        if node is None:
            return _AsyncNodeEngine(async_engine, async_session_factory)

        engine = create_async_engine(node.connection_string, pool_pre_ping=True)
        _register_search_path_fix(engine.sync_engine)
        entry = _AsyncNodeEngine(
            engine,
            async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession),
        )
        _async_node_engines[node_id] = entry
        return entry


async def get_active_engine() -> AsyncEngine:
    """Resolve the active node and return its (lazily constructed, cached)
    ``AsyncEngine`` — for callers that need engine-level access (a raw
    ``.connect()`` for a health probe, or ``.dispose()`` on shutdown), not
    just a session. Never a hardcoded reference (§7.2)."""
    entry = await _get_active_async_engine()
    return entry.engine


async def get_active_session_factory() -> async_sessionmaker[AsyncSession]:
    """Resolve the active node and return its (lazily constructed, cached)
    session factory — the dynamic replacement for importing
    ``async_session_factory`` directly (§7.2: every call site that opens its
    own session outside ``Depends(get_session)`` must go through this)."""
    entry = await _get_active_async_engine()
    return entry.session_factory


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding an ``AsyncSession`` against the currently
    active node (commit/rollback managed by the caller/route; the context
    closes the session)."""
    session_factory = await get_active_session_factory()
    async with session_factory() as session:
        yield session


async def dispose_engines() -> None:
    """Dispose every cached per-node async engine, plus the static fallback
    engine — shutdown must not assume a fixed engine was the only one ever
    connected to (§7.2)."""
    for entry in _async_node_engines.values():
        await entry.engine.dispose()
    _async_node_engines.clear()
    await async_engine.dispose()


# --------------------------------------------------------------------------- #
# N-way dynamic per-node engines (§7.2) — sync side
# --------------------------------------------------------------------------- #
#
# Deliberately NOT built on the async accessors above via asyncio.run(): every
# existing test that calls sync_session() does so as a plain sync function
# call from *inside* an already-running pytest-asyncio event loop (e.g.
# test_ratings.py's `_seed_votes` helper), where asyncio.run() would raise
# "cannot be called from a running event loop". data/tasks.py's purge loop
# (the one real production caller, §7.2) never runs an event loop at all, so
# a plain blocking Redis call works equally well there. get_active_node_sync()/
# get_node_sync() (data/node_registry.py) are the sync-Redis-client twins of
# get_active_node()/get_node() that make this possible.


class _SyncNodeEngine(NamedTuple):
    engine: Engine
    session_factory: sessionmaker


_sync_node_engines: dict[str, _SyncNodeEngine] = {}


def _get_active_sync_engine() -> _SyncNodeEngine:
    node_id = get_active_node_sync()
    if node_id is None:
        return _SyncNodeEngine(sync_engine, sync_session_factory)

    # Same reasoning as the async path above: skip the registry lookup
    # entirely once an engine is already cached for this node_id, rather
    # than re-fetching its connection_string (a real Redis HGET) on every
    # call. get_node_sync() already fails safe on a Redis error (returns
    # None), so no separate exception handling is needed here.
    cached = _sync_node_engines.get(node_id)
    if cached is not None:
        return cached

    # No lock: sync_session() only ever runs synchronously on a single
    # thread at a time (a script's own call, or a test's plain function
    # call) — never truly concurrent the way the async path above can be.
    node = get_node_sync(node_id)
    if node is None:
        logger.error(
            "Active node id=%s has no registry record — falling back to the "
            "static DATABASE_URL engine",
            node_id,
            extra={"data": {"event": "active_node_record_missing", "node_id": node_id}},
        )
        return _SyncNodeEngine(sync_engine, sync_session_factory)

    engine = create_engine(
        _sync_url(node.connection_string),
        pool_pre_ping=True,
        connect_args={"connect_timeout": CONNECT_TIMEOUT_SECONDS},
    )
    _register_search_path_fix(engine)
    entry = _SyncNodeEngine(engine, sessionmaker(engine, expire_on_commit=False))
    _sync_node_engines[node_id] = entry
    return entry


@contextmanager
def sync_session():
    """Context manager yielding a sync ``Session`` against the currently
    active node, with commit-on-success."""
    entry = _get_active_sync_engine()
    session = entry.session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
