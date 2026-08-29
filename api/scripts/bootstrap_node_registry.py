"""Bootstrap — register today's existing production Neon project as the
pool's first node (NEON_FAILOVER_PLAN.md §6).

Run ONCE, as the first deploy of the multi-node failover feature, before any
``api``/``worker`` code that depends on the registry is live. This is a
real, one-time write to production Redis — running it is a separate,
manual, human-supervised action, distinct from writing or merging the PR
that adds this script (see §11, Phase A's stop point).

Usage (from the ``api/`` directory, inside the deployed container):

    python -m scripts.bootstrap_node_registry --neon-project-id <id> [--yes]

Without ``--yes`` this only prints what it *would* register (a dry run) —
re-run with ``--yes`` once that output looks right to actually write it.
``--connection-string`` defaults to ``settings.database_url``, which in the
deployed containers already resolves to ``PROD_DATABASE_URL`` (§6) — pass
it explicitly only to override that (e.g. for a local rehearsal against a
disposable registry).
"""

import argparse
import asyncio
import sys
from urllib.parse import urlsplit, urlunsplit

from data.config import settings
from data.node_registry import BootstrapAlreadyDoneError, Node, bootstrap


def _mask_connection_string(url: str) -> str:
    """For display only — the raw value is still what gets stored. Never
    echo a live database password to a terminal/log."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return "<unparseable>"
    if parts.password is None:
        return url
    netloc = parts.netloc.replace(f":{parts.password}@", ":***@")
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--neon-project-id",
        required=True,
        help="The existing production project's Neon project ID (from Neon's "
        "console — nothing about the project itself changes).",
    )
    parser.add_argument(
        "--connection-string",
        default=None,
        help="Defaults to settings.database_url (PROD_DATABASE_URL in the "
        "deployed containers).",
    )
    parser.add_argument(
        "--display-name",
        default="Node 1 (bootstrap)",
        help="Shown in the admin panel's Nodes tab.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Actually write to Redis. Without this, only a dry-run summary "
        "is printed.",
    )
    return parser.parse_args(argv)


async def _run(argv: list[str]) -> int:
    args = _parse_args(argv)
    connection_string = args.connection_string or settings.database_url

    print("Bootstrap — about to register:")
    print(f"  display_name:      {args.display_name}")
    print(f"  neon_project_id:   {args.neon_project_id}")
    print(f"  connection_string: {_mask_connection_string(connection_string)}")
    print(f"  redis_url:         {settings.redis_url}")
    print()

    if not args.yes:
        print("Dry run only (pass --yes to actually write). Nothing was changed.")
        return 0

    try:
        node = await bootstrap(
            neon_project_id=args.neon_project_id,
            connection_string=connection_string,
            display_name=args.display_name,
        )
    except BootstrapAlreadyDoneError as exc:
        print(f"Refusing to bootstrap: {exc}", file=sys.stderr)
        return 1

    _print_result(node)
    return 0


def _print_result(node: Node) -> None:
    print(f"Registered node_id={node.node_id!r} and set it as active.")
    print(
        "Confirm via redis-cli (HGETALL filecast:nodes:registry, "
        "GET filecast:nodes:active) before moving on to Phase B."
    )


def main(argv: list[str]) -> int:
    return asyncio.run(_run(argv))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
