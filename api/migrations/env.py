"""Alembic environment — runs migrations with the SYNC engine (§7, simplest).

Imports ``data.models`` so ``Base.metadata`` is populated, and builds the URL
from ``data.config.settings`` (DATABASE_URL). psycopg3 drives the sync engine.
"""

from logging.config import fileConfig

from alembic import context
from data import models  # noqa: F401 — populates Base.metadata
from data.config import settings
from data.db import Base
from sqlalchemy import engine_from_config, pool, text

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Override URL from settings; strip any async marker for the sync engine.
config.set_main_option(
    "sqlalchemy.url", settings.database_url.replace("+asyncpg", "+psycopg")
)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        # NEON_FAILOVER_PLAN.md §7.5/§7.8 — a Neon project created straight
        # from the console (not via `neonctl init`) can leave its owner
        # role's search_path empty rather than the usual "public" default.
        # Every unqualified DDL statement a migration issues (a bare
        # `CREATE TABLE ...`, no schema prefix — which is what every
        # existing migration in this repo does) then fails with "no schema
        # has been selected to create in." A session-level SET fixes THIS
        # connection immediately and unconditionally, regardless of
        # whether a role-level fix (scripts/node_sync.py's
        # _ensure_search_path()) has actually propagated through Neon's
        # connection pooler yet — a pooled connection can be served from a
        # cached backend session whose state predates a role-level ALTER,
        # so this session-level SET is the only thing that's reliably
        # immediate. Harmless no-op on a node whose search_path was
        # already correct (every node created via `neonctl init`, and the
        # active node in every deploy today).
        connection.execute(text("SET search_path = public"))
        # Close out the transaction SQLAlchemy auto-began for the SET above
        # (its first statement on a fresh Connection) before Alembic's own
        # context.begin_transaction() takes over below — leaving it open
        # left Alembic's commit() only closing its own nested scope, and
        # this connection's `with` block then rolled back the outer
        # transaction on exit, silently discarding every migration that
        # had just run (confirmed by hand: the migration log showed every
        # step succeeding, but the tables were gone afterward).
        connection.commit()
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
