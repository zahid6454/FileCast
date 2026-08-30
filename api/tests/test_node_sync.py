"""Tests for scripts/node_sync.py (NEON_FAILOVER_PLAN.md §7.5, §12).

Most of this suite mocks the actual dump/restore/migration subprocesses —
they're pure orchestration behavior (call order, error propagation, cleanup,
the shared-deadline budget) that doesn't need a real Postgres round trip to
verify. Two exceptions exercise the real mechanism directly:

- ``_run_subprocess`` itself is tested against real (trivial, Postgres-free)
  Python subprocesses — this is what actually proves the "kill on timeout,
  raise on nonzero exit, asyncio.create_subprocess_exec not a blocking
  subprocess.run" contract, portably, without needing pg_dump at all.
- ``test_sync_node_moves_real_data_via_real_pg_dump_restore_v18`` is the
  required §12 real-binary test: two throwaway databases created on a real
  Postgres 18 SERVER (``TEST_NODE_SYNC_POSTGRES_URL`` — see
  ``two_real_databases`` below for why this has to be a v18 server, not the
  rest of this suite's v16 ``TEST_DATABASE_URL``), real ``alembic upgrade
  head`` subprocesses building **both** the source's and the target's schema
  (a real pool node's schema is always Alembic-managed, never
  ``Base.metadata.create_all()`` — building only the target's schema that way
  would leave the source with no ``alembic_version`` table at all and hide
  the exact duplicate-key collision ``_dump()``'s
  ``--exclude-table-data=alembic_version`` exists to prevent), and real
  ``pg_dump``/``pg_restore`` v18 binaries moving one row between them.

Subprocess-spawning tests are skipped on Windows: ``asyncio`` subprocess
support requires the Proactor event loop, but conftest.py pins the Selector
policy on Windows for psycopg-async compatibility (see its own comment) —
a pre-existing constraint, not something new here. They run for real in CI
(Linux) and in the deployed containers (also Linux).
"""

import os
import secrets
import sys
import time
from pathlib import Path

import pytest
from data import node_registry
from data.db import Base, _sync_url
from data.models import Tool
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

import scripts.node_sync as node_sync


def _make_node(node_id: str, connection_string: str) -> node_registry.Node:
    return node_registry.Node(
        node_id=node_id,
        display_name=f"Node {node_id}",
        connection_string=connection_string,
        neon_project_id=f"proj-{node_id}",
        status="ready",
        created_at="2026-01-01T00:00:00+00:00",
    )


# --------------------------------------------------------------------------- #
# _libpq_url — the SQLAlchemy-driver-suffix strip pg_dump/pg_restore need
# --------------------------------------------------------------------------- #


def test_libpq_url_strips_the_sqlalchemy_driver_suffix():
    assert (
        node_sync._libpq_url("postgresql+psycopg://user:pw@host/db")
        == "postgresql://user:pw@host/db"
    )


def test_libpq_url_leaves_an_already_plain_url_unchanged():
    assert (
        node_sync._libpq_url("postgresql://user:pw@host/db")
        == "postgresql://user:pw@host/db"
    )


# --------------------------------------------------------------------------- #
# _truncate_all_tables_sql — the pg_restore --clean/--data-only workaround
# --------------------------------------------------------------------------- #


def test_truncate_all_tables_sql_covers_every_model_table():
    sql = node_sync._truncate_all_tables_sql()
    assert sql.startswith("TRUNCATE ")
    assert sql.endswith(" RESTART IDENTITY CASCADE")
    # Every table SQLAlchemy knows about must be named — a partial sync that
    # skipped a table would defeat the whole point (§7.5: session rows live
    # in Postgres too).
    for table in Base.metadata.sorted_tables:
        assert f'"{table.name}"' in sql


# --------------------------------------------------------------------------- #
# sync_node orchestration — mocked dump/restore/migration
# --------------------------------------------------------------------------- #


async def test_sync_node_raises_when_source_node_missing():
    await node_registry.register_node(_make_node("dst", "postgresql://h/db"))
    with pytest.raises(node_sync.NodeSyncError, match="source"):
        await node_sync.sync_node("does-not-exist", "dst")


async def test_sync_node_raises_when_target_node_missing():
    await node_registry.register_node(_make_node("src", "postgresql://h/db"))
    with pytest.raises(node_sync.NodeSyncError, match="target"):
        await node_sync.sync_node("src", "does-not-exist")


async def test_sync_node_runs_migration_then_dump_then_truncate_then_restore(
    monkeypatch,
):
    await node_registry.register_node(_make_node("src", "postgresql://h/src"))
    await node_registry.register_node(_make_node("dst", "postgresql://h/dst"))

    call_order = []

    async def fake_migration(target, *, remaining_seconds):
        call_order.append(("migration", target.node_id))

    async def fake_dump(source, dump_path, *, remaining_seconds):
        call_order.append(("dump", source.node_id))

    async def fake_truncate(target, *, remaining_seconds):
        call_order.append(("truncate", target.node_id))

    async def fake_restore(target, dump_path, *, remaining_seconds):
        call_order.append(("restore", target.node_id))

    monkeypatch.setattr(node_sync, "_run_migration", fake_migration)
    monkeypatch.setattr(node_sync, "_dump", fake_dump)
    monkeypatch.setattr(node_sync, "_truncate_target", fake_truncate)
    monkeypatch.setattr(node_sync, "_restore", fake_restore)

    await node_sync.sync_node("src", "dst")

    assert call_order == [
        ("migration", "dst"),
        ("dump", "src"),
        ("truncate", "dst"),
        ("restore", "dst"),
    ]


async def test_sync_node_records_activity_for_both_source_and_target(monkeypatch):
    await node_registry.register_node(_make_node("src", "postgresql://h/src"))
    await node_registry.register_node(_make_node("dst", "postgresql://h/dst"))

    monkeypatch.setattr(node_sync, "_run_migration", _noop3)
    monkeypatch.setattr(node_sync, "_dump", _noop3)
    monkeypatch.setattr(node_sync, "_truncate_target", _noop3)
    monkeypatch.setattr(node_sync, "_restore", _noop3)

    assert await node_registry.get_last_activity("src") is None
    assert await node_registry.get_last_activity("dst") is None

    await node_sync.sync_node("src", "dst")

    assert await node_registry.get_last_activity("src") is not None
    assert await node_registry.get_last_activity("dst") is not None


async def _noop3(*_args, **_kwargs) -> None:
    return None


async def test_sync_node_cleans_up_the_dump_file_even_when_restore_fails(monkeypatch):
    await node_registry.register_node(_make_node("src", "postgresql://h/src"))
    await node_registry.register_node(_make_node("dst", "postgresql://h/dst"))

    written_path: Path | None = None

    async def fake_migration(target, *, remaining_seconds):
        return None

    async def fake_dump(source, dump_path, *, remaining_seconds):
        nonlocal written_path
        written_path = dump_path
        dump_path.write_bytes(b"fake dump bytes")

    async def fake_restore(target, dump_path, *, remaining_seconds):
        raise node_sync.NodeSyncError("pg_restore exploded")

    monkeypatch.setattr(node_sync, "_run_migration", fake_migration)
    monkeypatch.setattr(node_sync, "_dump", fake_dump)
    monkeypatch.setattr(node_sync, "_truncate_target", _noop3)
    monkeypatch.setattr(node_sync, "_restore", fake_restore)

    with pytest.raises(node_sync.NodeSyncError, match="exploded"):
        await node_sync.sync_node("src", "dst")

    assert written_path is not None
    assert not written_path.exists()


async def test_sync_node_cleans_up_the_dump_file_on_success(monkeypatch):
    await node_registry.register_node(_make_node("src", "postgresql://h/src"))
    await node_registry.register_node(_make_node("dst", "postgresql://h/dst"))

    written_path: Path | None = None

    async def fake_dump(source, dump_path, *, remaining_seconds):
        nonlocal written_path
        written_path = dump_path
        dump_path.write_bytes(b"fake dump bytes")

    async def fake_restore(target, dump_path, *, remaining_seconds):
        assert dump_path.exists()  # still there for restore to read

    monkeypatch.setattr(node_sync, "_run_migration", _noop3)
    monkeypatch.setattr(node_sync, "_dump", fake_dump)
    monkeypatch.setattr(node_sync, "_truncate_target", _noop3)
    monkeypatch.setattr(node_sync, "_restore", fake_restore)

    await node_sync.sync_node("src", "dst")

    assert written_path is not None
    assert not written_path.exists()


async def test_sync_node_never_starts_a_step_with_no_remaining_budget(monkeypatch):
    """Regression guard for the shared-deadline design (module docstring):
    if the budget is already exhausted by the time a later step would run,
    that step must never actually spawn a subprocess — it should fail fast
    with NodeSyncTimeoutError instead.

    ``_dump`` is deliberately left as the REAL implementation here (only
    ``_run_migration``/``_restore`` are mocked): with the deadline already in
    the past, its own ``_run_subprocess()`` call must raise before ever
    touching the pg_dump binary (the same guard proven directly by
    ``test_run_subprocess_raises_immediately_with_zero_budget_left`` below),
    so this test needs no real Postgres client tools and runs on every
    platform, Windows included.
    """
    await node_registry.register_node(_make_node("src", "postgresql://h/src"))
    await node_registry.register_node(_make_node("dst", "postgresql://h/dst"))

    async def fake_migration(target, *, remaining_seconds):
        return None

    restore_called = False

    async def fake_restore(target, dump_path, *, remaining_seconds):
        nonlocal restore_called
        restore_called = True

    monkeypatch.setattr(node_sync, "_run_migration", fake_migration)
    monkeypatch.setattr(node_sync, "_restore", fake_restore)
    # Force the deadline to already be in the past the instant sync_node()
    # computes it — simplest reliable way to do this without sleeping:
    # patch the overall budget itself negative, so
    # `deadline = time.monotonic() + SYNC_OPERATION_TIMEOUT_SECONDS` is
    # already behind "now".
    monkeypatch.setattr(node_sync, "SYNC_OPERATION_TIMEOUT_SECONDS", -1)

    with pytest.raises(node_sync.NodeSyncTimeoutError):
        await node_sync.sync_node("src", "dst")

    assert restore_called is False


# --------------------------------------------------------------------------- #
# _run_subprocess — real (Postgres-free) subprocess mechanics. Skipped on
# Windows: asyncio subprocess support needs the Proactor loop, which
# conftest.py deliberately doesn't use here (see its own docstring).
# --------------------------------------------------------------------------- #

skip_without_subprocess_support = pytest.mark.skipif(
    sys.platform == "win32",
    reason="asyncio subprocess support requires the Proactor event loop; "
    "conftest.py pins Selector on Windows for psycopg-async compatibility",
)


@skip_without_subprocess_support
async def test_run_subprocess_succeeds_on_a_clean_exit():
    await node_sync._run_subprocess(
        [sys.executable, "-c", "pass"],
        env=None,
        remaining_seconds=10,
        description="test",
    )  # must not raise


@skip_without_subprocess_support
async def test_run_subprocess_raises_node_sync_error_on_nonzero_exit():
    with pytest.raises(node_sync.NodeSyncError, match="exit 3"):
        await node_sync._run_subprocess(
            [sys.executable, "-c", "import sys; sys.exit(3)"],
            env=None,
            remaining_seconds=10,
            description="test",
        )


@skip_without_subprocess_support
async def test_run_subprocess_wraps_a_missing_binary_as_node_sync_error():
    # Regression guard: asyncio.create_subprocess_exec raises a bare OSError
    # (FileNotFoundError on POSIX/Windows alike) when the binary itself
    # doesn't exist or isn't executable — a misconfigured PG_DUMP_BIN/
    # PG_RESTORE_BIN, say. A future caller (§7.8) is meant to catch
    # NodeSyncError/NodeSyncTimeoutError as the complete failure contract;
    # this must not leak a different exception type past that.
    with pytest.raises(node_sync.NodeSyncError, match="failed to start"):
        await node_sync._run_subprocess(
            ["/definitely/does/not/exist/pg_dump_binary"],
            env=None,
            remaining_seconds=10,
            description="test",
        )


@skip_without_subprocess_support
async def test_run_subprocess_includes_stderr_in_the_error():
    with pytest.raises(node_sync.NodeSyncError, match="boom"):
        await node_sync._run_subprocess(
            [
                sys.executable,
                "-c",
                "import sys; sys.stderr.write('boom'); sys.exit(1)",
            ],
            env=None,
            remaining_seconds=10,
            description="test",
        )


@skip_without_subprocess_support
async def test_run_subprocess_kills_and_raises_timeout_instead_of_waiting_it_out():
    start = time.monotonic()
    with pytest.raises(node_sync.NodeSyncTimeoutError):
        await node_sync._run_subprocess(
            [sys.executable, "-c", "import time; time.sleep(30)"],
            env=None,
            remaining_seconds=0.3,
            description="test",
        )
    elapsed = time.monotonic() - start
    # Actually killed, not left to run out its full 30s sleep.
    assert elapsed < 10


@skip_without_subprocess_support
async def test_run_subprocess_raises_immediately_with_zero_budget_left():
    # No subprocess should even be spawned — nothing to assert on the
    # process itself, but this must return well under any real subprocess
    # startup+kill latency.
    start = time.monotonic()
    with pytest.raises(node_sync.NodeSyncTimeoutError):
        await node_sync._run_subprocess(
            [sys.executable, "-c", "pass"],
            env=None,
            remaining_seconds=0,
            description="test",
        )
    assert time.monotonic() - start < 1


# --------------------------------------------------------------------------- #
# §7.1's lock-TTL-vs-operation-timeout tension — the required §12 coverage:
# confirm the bound actually holds today, not just that the mechanism exists.
# --------------------------------------------------------------------------- #


def test_sync_operation_timeout_is_safely_under_the_pool_lock_ttl():
    # sync_node() gives EACH of its three subprocess steps up to the full
    # remaining budget at the moment it starts — so the single overall
    # deadline (SYNC_OPERATION_TIMEOUT_SECONDS) is what must stay under the
    # pool lock's TTL, not some per-step slice of it. This call is the same
    # guard node_sync.py itself runs at import time (module-level, above);
    # repeated here as an explicit, discoverable regression test rather than
    # relying on "the module failed to import" to surface a violation.
    node_registry.assert_safe_operation_timeout(
        node_sync.SYNC_OPERATION_TIMEOUT_SECONDS
    )


# --------------------------------------------------------------------------- #
# Real v18 binaries, real data movement (§12's required real-binary test).
# --------------------------------------------------------------------------- #


def _v18_binaries_available() -> bool:
    return (
        Path(node_sync.PG_DUMP_BIN).is_file()
        and Path(node_sync.PG_RESTORE_BIN).is_file()
    )


def _node_sync_postgres_url() -> str | None:
    """A real Postgres 18 SERVER for the real-binary test below — deliberately
    NOT ``TEST_DATABASE_URL`` (that's the v16 server the rest of this suite
    targets, matching this repo's actual production server version). v18
    ``pg_dump``/``pg_restore`` embed v18-only session GUCs in their dump
    metadata (e.g. ``SET transaction_timeout = 0``) that a v16 server
    rejects outright — confirmed for real: running this test against a v16
    server fails with ``unrecognized configuration parameter
    "transaction_timeout"`` even though the truncate/restore logic itself is
    correct. Real Neon deployments run v18 client tools against a v18
    server, so this env var exists to let this one test exercise a genuinely
    matching pair. ``None`` when unset (e.g. a local run without a second
    Postgres instance standing by) — the test skips gracefully rather than
    hard-failing; ci.yml's ``postgres18`` service sets this.
    """
    return os.environ.get("TEST_NODE_SYNC_POSTGRES_URL")


@pytest.fixture
def two_real_databases():
    """Two throwaway logical databases on the Postgres 18 server
    ``TEST_NODE_SYNC_POSTGRES_URL`` points at, standing in for "two local/dev
    Postgres containers": pg_dump/pg_restore correctness (and the real v18
    binaries) don't depend on source and target being separate server
    processes, only separate databases reachable over a real connection —
    and this avoids provisioning two service containers just for one test.
    Created/dropped via an autocommit connection to the server's default
    "postgres" maintenance database (CREATE/DROP DATABASE can't run inside a
    transaction block).
    """
    # render_as_string(hide_password=False) — NOT plain str(url)/repr(url),
    # which SQLAlchemy deliberately renders with the password masked as
    # "***" for safe logging/display. Using the masked form here would
    # silently try to authenticate with the literal password "***" instead
    # of the real one (caught by CI's real Postgres service, not by a local
    # run where this whole test skips on Windows).
    postgres_url = _node_sync_postgres_url()
    admin_url = (
        make_url(_sync_url(postgres_url))
        .set(database="postgres")
        .render_as_string(hide_password=False)
    )
    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    src_name = f"fc_node_sync_src_{secrets.token_hex(4)}"
    dst_name = f"fc_node_sync_dst_{secrets.token_hex(4)}"
    with admin_engine.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{src_name}"'))
        conn.execute(text(f'CREATE DATABASE "{dst_name}"'))
    try:
        base_url = make_url(postgres_url)
        src_url = base_url.set(database=src_name).render_as_string(hide_password=False)
        dst_url = base_url.set(database=dst_name).render_as_string(hide_password=False)
        yield src_url, dst_url
    finally:
        with admin_engine.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{src_name}" WITH (FORCE)'))
            conn.execute(text(f'DROP DATABASE IF EXISTS "{dst_name}" WITH (FORCE)'))
        admin_engine.dispose()


@skip_without_subprocess_support
@pytest.mark.skipif(
    not _v18_binaries_available(),
    reason="postgresql-client-18 not installed at the expected PGDG path "
    "(PG_DUMP_BIN/PG_RESTORE_BIN) — install it (see api/Dockerfile) to run "
    "this test for real",
)
@pytest.mark.skipif(
    _node_sync_postgres_url() is None,
    reason="TEST_NODE_SYNC_POSTGRES_URL not set — point it at a real "
    "Postgres 18 server (see ci.yml's postgres18 service) to run this test "
    "for real; the main TEST_DATABASE_URL server is v16 and will reject "
    "v18 pg_restore's session GUCs",
)
async def test_sync_node_moves_real_data_via_real_pg_dump_restore_v18(
    two_real_databases,
):
    src_url, dst_url = two_real_databases
    src_node = _make_node("real-src", src_url)

    # Source's schema is built via a real `alembic upgrade head` subprocess
    # too — not Base.metadata.create_all() — because a real pool node is
    # always Alembic-managed, and its `alembic_version` row is exactly what
    # would collide with the target's own (also just-migrated, via
    # sync_node()'s own migration step) `alembic_version` row if `_dump()`
    # ever included it. create_all() would build an equivalent schema but
    # silently skip creating `alembic_version` altogether, hiding that
    # collision instead of exercising it.
    await node_sync._run_migration(src_node, remaining_seconds=60)

    # One representative row — what's actually under test here is real bytes
    # flowing src -> dst via real pg_dump/pg_restore, migrated schemas on
    # both ends included.
    src_engine = create_engine(_sync_url(src_url))
    with src_engine.connect() as conn:
        conn.execute(
            Tool.__table__.insert().values(
                id="jpg-to-png",
                enabled=True,
                sort_order=1,
                category="image-conversion",
                name="JPG to PNG",
                input_format="JPG",
                output_format="PNG",
            )
        )
        conn.commit()
    src_engine.dispose()

    await node_registry.register_node(src_node)
    await node_registry.register_node(_make_node("real-dst", dst_url))

    await node_sync.sync_node("real-src", "real-dst")

    dst_engine = create_engine(_sync_url(dst_url))
    with dst_engine.connect() as conn:
        name = conn.execute(
            text("SELECT name FROM tools WHERE id = 'jpg-to-png'")
        ).scalar_one_or_none()
    dst_engine.dispose()

    assert name == "JPG to PNG"
