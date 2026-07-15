"""Database engines and session factories.

One set of model classes (``models.py``) is shared by two engines built from the
same ``DATABASE_URL`` (psycopg3 drives both, §14-F7):

- **Async** — the FastAPI app. ``get_session`` is the request-scoped dependency.
- **Sync** — ``seed.py``, ``build.py`` (Phase 2), and Alembic. ``sync_session``
  is a context manager.

Schema is owned by Alembic (§7); there is **no** ``create_all()`` at runtime.
"""

from collections.abc import AsyncIterator
from contextlib import contextmanager

from sqlalchemy import MetaData, create_engine
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from data.config import settings

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


# --- Async engine (the app) ---
async_engine = create_async_engine(settings.database_url, pool_pre_ping=True)
async_session_factory = async_sessionmaker(
    async_engine, expire_on_commit=False, class_=AsyncSession
)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding an ``AsyncSession`` (commit/rollback managed
    by the caller/route; the context closes the session)."""
    async with async_session_factory() as session:
        yield session


# --- Sync engine (scripts + Alembic) ---
sync_engine = create_engine(
    _sync_url(settings.database_url),
    pool_pre_ping=True,
    connect_args={"connect_timeout": CONNECT_TIMEOUT_SECONDS},
)
sync_session_factory = sessionmaker(sync_engine, expire_on_commit=False)


@contextmanager
def sync_session():
    """Context manager yielding a sync ``Session`` with commit-on-success."""
    session = sync_session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
