"""Resolve the connection string ``alembic upgrade head`` should target at
container start (NEON_FAILOVER_PLAN.md §7.10).

The Dockerfile's ``CMD`` used to run a bare ``alembic upgrade head``, which
reads ``DATABASE_URL`` — a static, deploy-time environment variable — via
``migrations/env.py``. That was correct while there was only ever one
database, but breaks the moment the first switch happens: the env var never
moves when the active node changes (node identity lives in Redis, not env
vars, by design — §7.1), so every subsequent deploy would keep migrating
whichever node happened to be node #1 at Bootstrap, forever, regardless of
which node is actually active. Two concrete failures follow: a real schema
change can ship without ever reaching the real active node, and once node #1
is retired or exhausts its quota, the migration step starts failing outright
— blocking every future deploy, including the one needed to fix it, even
though the real active node is perfectly healthy.

This script resolves the SAME active node ``get_active_node()`` does
everywhere else in the app, prints its connection string to stdout, and
falls back to the static ``settings.database_url`` (``DATABASE_URL`` /
``PROD_DATABASE_URL``, §6) whenever the registry can't be read — Redis
unreachable, or the pre-Bootstrap window before ``filecast:nodes:active`` is
set. That fallback means Bootstrap needs no special-casing here: before
Bootstrap has run, this resolves to the exact same value the env var already
holds, so the migration step behaves identically to today until the registry
has something real in it.

Prints EXACTLY ONE line to stdout — the resolved connection string — meant
to be captured by the Dockerfile CMD's command substitution and exported as
DATABASE_URL before ``alembic upgrade head`` runs. All diagnostics go to
stderr so they never end up inside that captured value.

Usage:  python -m scripts.resolve_active_db_url
"""

import asyncio
import sys

from data.config import settings
from data.node_registry import NoActiveNodeError, get_active_node, get_node


async def resolve() -> str:
    try:
        node_id = await get_active_node()
    except NoActiveNodeError:
        print(
            "resolve_active_db_url: no active node in the registry "
            "(pre-Bootstrap, or Redis unreachable) — falling back to the "
            "static DATABASE_URL",
            file=sys.stderr,
        )
        return settings.database_url

    try:
        node = await get_node(node_id)
    except Exception as exc:  # noqa: BLE001 — this is the migration-target
        # resolver the Dockerfile CMD's `export DATABASE_URL=$(...) &&
        # alembic upgrade head && ...` depends on: an uncaught exception
        # here means this script exits non-zero with empty stdout, the
        # `export` assignment itself then fails, and the `&&` chain
        # short-circuits BEFORE alembic ever runs — the container fails to
        # start outright on a transient Redis hiccup. get_node() (§7.1,
        # node_registry.py) propagates Redis errors loudly by design for its
        # other callers, but this script's whole purpose is to always
        # resolve to a usable value, so any failure here must degrade to the
        # static fallback exactly like the NoActiveNodeError case above.
        print(
            f"resolve_active_db_url: registry lookup for active "
            f"node_id={node_id!r} failed ({exc!r}) — falling back to the "
            "static DATABASE_URL",
            file=sys.stderr,
        )
        return settings.database_url

    if node is None:
        print(
            f"resolve_active_db_url: active node_id={node_id!r} has no "
            "registry record — falling back to the static DATABASE_URL",
            file=sys.stderr,
        )
        return settings.database_url

    return node.connection_string


def main() -> int:
    print(asyncio.run(resolve()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
