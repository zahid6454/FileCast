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
from sqlalchemy import Engine, MetaData, create_engine
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
    Node,
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


# --- Static async engine — the dev/test/CI and pre-Bootstrap fallback ---
async_engine = create_async_engine(settings.database_url, pool_pre_ping=True)
async_session_factory = async_sessionmaker(
    async_engine, expire_on_commit=False, class_=AsyncSession
)


# --- Static sync engine (scripts + Alembic + conftest.py's schema setup) ---
sync_engine = create_engine(
    _sync_url(settings.database_url),
    pool_pre_ping=True,
    connect_args={"connect_timeout": CONNECT_TIMEOUT_SECONDS},
)
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


async def _resolve_active_node() -> Node | None:
    """The registry record for the currently active node, or ``None`` when
    there's nothing to resolve (Redis unreachable with no prior cache, or no
    node ever registered) — the case every accessor below falls back to the
    static engines above for."""
    try:
        node_id = await get_active_node()
    except NoActiveNodeError:
        return None
    node = await get_node(node_id)
    if node is None:
        logger.error(
            "Active node id=%s has no registry record — falling back to the "
            "static DATABASE_URL engine",
            node_id,
            extra={"data": {"event": "active_node_record_missing", "node_id": node_id}},
        )
    return node


async def _get_active_async_engine() -> _AsyncNodeEngine:
    node = await _resolve_active_node()
    if node is None:
        return _AsyncNodeEngine(async_engine, async_session_factory)

    cached = _async_node_engines.get(node.node_id)
    if cached is not None:
        return cached
    async with _async_node_engines_lock:
        cached = _async_node_engines.get(node.node_id)
        if cached is not None:
            return cached
        engine = create_async_engine(node.connection_string, pool_pre_ping=True)
        entry = _AsyncNodeEngine(
            engine,
            async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession),
        )
        _async_node_engines[node.node_id] = entry
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


def _resolve_active_node_sync() -> Node | None:
    node_id = get_active_node_sync()
    if node_id is None:
        return None
    node = get_node_sync(node_id)
    if node is None:
        logger.error(
            "Active node id=%s has no registry record — falling back to the "
            "static DATABASE_URL engine",
            node_id,
            extra={"data": {"event": "active_node_record_missing", "node_id": node_id}},
        )
    return node


def _get_active_sync_engine() -> _SyncNodeEngine:
    node = _resolve_active_node_sync()
    if node is None:
        return _SyncNodeEngine(sync_engine, sync_session_factory)

    cached = _sync_node_engines.get(node.node_id)
    if cached is not None:
        return cached
    # No lock: sync_session() only ever runs synchronously on a single
    # thread at a time (a script's own call, or a test's plain function
    # call) — never truly concurrent the way the async path above can be.
    engine = create_engine(
        _sync_url(node.connection_string),
        pool_pre_ping=True,
        connect_args={"connect_timeout": CONNECT_TIMEOUT_SECONDS},
    )
    entry = _SyncNodeEngine(engine, sessionmaker(engine, expire_on_commit=False))
    _sync_node_engines[node.node_id] = entry
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
