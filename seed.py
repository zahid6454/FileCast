#!/usr/bin/env python3
"""Seed the ``tools`` table (+ dev users) from ``tools/*.yaml`` → Postgres.

Ports the Worker seed **algorithm verbatim** (ledger D1): a global, monotonic
``sort_order`` assigned by walking categories image → document → data, and within
each category ``homepage_order`` first (ascending) then the rest alphabetically
by id. Writes via the shared **sync** engine instead of piping SQL.

Upsert policy (§11): refresh the seed-managed columns
``sort_order``/``enabled``/``category``/``name``/``input_format``/
``output_format``/``updated_at`` from YAML on every run, but never touch the
admin-owned overlay columns ``display_name``/``maintenance_message``/
``custom_max_file_size``.

Usage:
    python seed.py              # upsert all tools + dev users
    python seed.py --only-new   # only insert tools not already present
"""

import argparse
import sys
from datetime import UTC, datetime
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent
# The shared data package lives under api/ (Docker build context, §2 constraint).
sys.path.insert(0, str(ROOT / "api"))

from data.config import settings  # noqa: E402
from data.db import sync_session  # noqa: E402
from data.models import Tool, User  # noqa: E402

TOOLS_DIR = ROOT / "tools"
SITE_CONFIG = ROOT / "site-config.yaml"

# Fallback category walk order for the global sort_order (ledger D1 / Phase 1
# §14.3), used only if site-config.yaml can't be read. Unknown categories last.
CATEGORY_ORDER_FALLBACK = [
    "image-conversion",
    "document-tools",
    "data-conversion",
    "audio-video",
]


def _load_category_order() -> list[str]:
    """Category walk order for the global ``sort_order`` — sourced from the SAME
    ``site-config.yaml`` list the homepage renders from, so the admin panel's
    category grouping matches the homepage's section order exactly (they used to
    drift: a hardcoded list here put image before document while the homepage put
    document first). Falls back to the static list if the config is unreadable.
    """
    try:
        with open(SITE_CONFIG, encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}
        order = [c["id"] for c in cfg.get("categories", []) if "id" in c]
        return order or CATEGORY_ORDER_FALLBACK
    except (OSError, yaml.YAMLError):
        return CATEGORY_ORDER_FALLBACK


CATEGORY_ORDER = _load_category_order()

# Mirror of data.security.DEV_USERS (kept inline so seed.py has no FastAPI
# import dependency when run from the host). Emails MUST match dev-login.
DEV_USERS = [
    {"email": "admin@dev.local", "name": "Dev Admin", "role": "admin"},
    {"email": "user@dev.local", "name": "Dev User", "role": "user"},
]


def _load_yaml_tools() -> list[dict]:
    tools = []
    for path in sorted(TOOLS_DIR.glob("*.yaml")):
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if not isinstance(data, dict) or "id" not in data:
            print(f"  [warn] skipping invalid tool file: {path.name}")
            continue
        tools.append(data)
    return tools


def _category_rank(category: str) -> int:
    try:
        return CATEGORY_ORDER.index(category)
    except ValueError:
        return len(CATEGORY_ORDER)


def _within_category_key(tool: dict):
    """homepage_order first (ascending), then alphabetical by id."""
    ho = tool.get("homepage_order")
    if ho is not None:
        return (0, ho, tool["id"])
    return (1, 0, tool["id"])


def compute_global_order(tools: list[dict]) -> list[dict]:
    """Return tools sorted into the global monotonic order."""
    return sorted(
        tools,
        key=lambda t: (
            _category_rank(t.get("category", "")),
            *_within_category_key(t),
        ),
    )


def seed_tools(only_new: bool) -> None:
    yaml_tools = _load_yaml_tools()
    ordered = compute_global_order(yaml_tools)
    now = datetime.now(UTC)

    inserted = updated = skipped = 0
    with sync_session() as db:
        existing = {t.id: t for t in db.query(Tool).all()}
        for index, data in enumerate(ordered, start=1):
            tid = data["id"]
            row = existing.get(tid)
            if row is None:
                db.add(
                    Tool(
                        id=tid,
                        enabled=bool(data.get("enabled", True)),
                        sort_order=index,
                        category=data.get("category"),
                        name=data.get("name"),
                        input_format=data.get("input_format"),
                        output_format=data.get("output_format"),
                        updated_at=now,
                    )
                )
                inserted += 1
            elif only_new:
                skipped += 1
            else:
                # Refresh seed-managed columns; leave admin overlay untouched.
                row.enabled = bool(data.get("enabled", True))
                row.sort_order = index
                row.category = data.get("category")
                row.name = data.get("name")
                row.input_format = data.get("input_format")
                row.output_format = data.get("output_format")
                row.updated_at = now
                updated += 1

    print(
        f"  tools: inserted={inserted} updated={updated} skipped={skipped} "
        f"(total {len(ordered)})"
    )


def seed_dev_users() -> None:
    if settings.environment != "development":
        print("  dev users: skipped (ENVIRONMENT != development)")
        return
    created = 0
    with sync_session() as db:
        for spec in DEV_USERS:
            existing = db.query(User).filter(User.email == spec["email"]).one_or_none()
            if existing is None:
                db.add(User(email=spec["email"], name=spec["name"], role=spec["role"]))
                created += 1
    print(f"  dev users: created={created} (of {len(DEV_USERS)})")


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed FileCast tools → Postgres")
    parser.add_argument(
        "--only-new",
        action="store_true",
        help="Only insert tools not already present (post-admin-panel re-runs)",
    )
    args = parser.parse_args()

    print("Seeding FileCast data layer...")
    seed_tools(args.only_new)
    seed_dev_users()
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
