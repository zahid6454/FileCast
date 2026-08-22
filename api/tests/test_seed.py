"""Tests for seed.py's ``--only-new`` sync path.

Covers the fix this PR makes: a "Sync Tools" run must never touch an existing
tool's admin-curated ``sort_order``, and a newly-discovered tool must be
appended after the current max instead of landing at whatever index it gets
in a freshly recomputed YAML walk order (which could drop it mid-list).
Nothing else in the suite exercises ``seed_tools()`` directly.
"""

import sys
from pathlib import Path

import pytest
import yaml

# seed.py lives at the repo root (api/tests/test_seed.py -> parents[2]).
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data.db import sync_session  # noqa: E402
from data.models import Tool  # noqa: E402

import seed  # noqa: E402

# conftest sets DATABASE_URL -> the test DB before importing data.*, so
# seed.py's `from data.db import sync_session` binds to the same test engine.


@pytest.fixture(autouse=True)
def _tools_dir(tmp_path, monkeypatch):
    """Point seed.py at a scratch tools/ dir instead of the real catalogue,
    so these tests don't drift as real tools are added/renamed."""
    monkeypatch.setattr(seed, "TOOLS_DIR", tmp_path)
    return tmp_path


def _write_tool(
    dir_: Path,
    tool_id: str,
    category: str = "document-conversion",
    enabled: bool = True,
):
    (dir_ / f"{tool_id}.yaml").write_text(
        yaml.safe_dump(
            {"id": tool_id, "category": category, "name": tool_id, "enabled": enabled}
        ),
        encoding="utf-8",
    )


def _rows_by_sort_order() -> list[tuple[str, int]]:
    with sync_session() as db:
        rows = db.query(Tool).order_by(Tool.sort_order).all()
        return [(r.id, r.sort_order) for r in rows]


def _featured_slots() -> dict[str, int | None]:
    with sync_session() as db:
        return {t.id: t.featured_slot for t in db.query(Tool).all()}


def test_only_new_does_not_touch_existing_sort_order(_tools_dir):
    _write_tool(_tools_dir, "a-tool")
    _write_tool(_tools_dir, "b-tool")
    seed.seed_tools(only_new=False)

    with sync_session() as db:
        db.query(Tool).filter(Tool.id == "a-tool").one().sort_order = 999

    seed.seed_tools(only_new=True)  # re-sync, nothing new to insert

    assert dict(_rows_by_sort_order())["a-tool"] == 999


def test_only_new_appends_new_tool_after_current_max(_tools_dir):
    _write_tool(_tools_dir, "a-tool")
    seed.seed_tools(only_new=False)

    with sync_session() as db:
        # Simulate an admin drag-reorder promoting this tool.
        db.query(Tool).filter(Tool.id == "a-tool").one().sort_order = 50

    _write_tool(_tools_dir, "z-tool")  # sorts last alphabetically too
    seed.seed_tools(only_new=True)

    order = _rows_by_sort_order()
    assert [tool_id for tool_id, _ in order] == ["a-tool", "z-tool"]
    assert dict(order)["z-tool"] == 51  # current max (50) + 1


def test_only_new_appends_multiple_new_tools_in_walk_order(_tools_dir):
    _write_tool(_tools_dir, "a-tool")
    seed.seed_tools(only_new=False)

    _write_tool(_tools_dir, "z-tool")
    _write_tool(_tools_dir, "m-tool")
    seed.seed_tools(only_new=True)

    order = [tool_id for tool_id, _ in _rows_by_sort_order()]
    assert order == ["a-tool", "m-tool", "z-tool"]


def test_full_seed_resets_sort_order_to_yaml_order(_tools_dir):
    _write_tool(_tools_dir, "a-tool")
    _write_tool(_tools_dir, "b-tool")
    seed.seed_tools(only_new=False)

    with sync_session() as db:
        db.query(Tool).filter(Tool.id == "a-tool").one().sort_order = 999

    seed.seed_tools(only_new=False)  # full sync, no --only-new

    order = [tool_id for tool_id, _ in _rows_by_sort_order()]
    assert order == ["a-tool", "b-tool"]  # reset back to YAML/alphabetical order


# --------------------------------------------------------------------------- #
# featured_slot (homepage curation, admin-panel redesign) — auto-backfill for
# a never-seen category, and clearing on reclassification
# --------------------------------------------------------------------------- #


def test_brand_new_category_auto_backfills_featured_slot(_tools_dir):
    # Five tools land in a category with zero existing rows — the first four
    # (walk order = alphabetical here, no homepage_order hint) get slots 1-4,
    # the fifth gets none; an EXISTING category must never get this treatment.
    for tid in ["a-tool", "b-tool", "c-tool", "d-tool", "e-tool"]:
        _write_tool(_tools_dir, tid, category="new-category")
    seed.seed_tools(only_new=False)

    slots = _featured_slots()
    assert slots["a-tool"] == 1
    assert slots["b-tool"] == 2
    assert slots["c-tool"] == 3
    assert slots["d-tool"] == 4
    assert slots["e-tool"] is None


def test_disabled_new_tool_does_not_consume_a_backfill_slot(_tools_dir):
    _write_tool(_tools_dir, "a-tool", category="new-category")
    _write_tool(_tools_dir, "b-tool", category="new-category", enabled=False)
    _write_tool(_tools_dir, "c-tool", category="new-category")
    seed.seed_tools(only_new=False)

    slots = _featured_slots()
    assert slots["a-tool"] == 1
    assert slots["b-tool"] is None  # disabled — never eligible for a seat
    assert slots["c-tool"] == 2  # not bumped to 3 — b-tool never took a number


def test_only_new_never_backfills_a_tool_added_to_an_existing_category(_tools_dir):
    _write_tool(_tools_dir, "a-tool", category="document-conversion")
    seed.seed_tools(only_new=False)  # document-conversion now has an existing row

    _write_tool(_tools_dir, "z-tool", category="document-conversion")
    seed.seed_tools(only_new=True)

    assert _featured_slots()["z-tool"] is None


def test_reclassifying_a_tool_clears_its_featured_slot_on_full_reseed(_tools_dir):
    _write_tool(_tools_dir, "a-tool", category="new-category")
    seed.seed_tools(only_new=False)
    assert _featured_slots()["a-tool"] == 1  # auto-backfilled as the sole tool

    # Same tool, reclassified into a different category — a full reseed must
    # not let it silently keep a seat that could collide in the new category.
    _write_tool(_tools_dir, "a-tool", category="other-category")
    seed.seed_tools(only_new=False)

    assert _featured_slots()["a-tool"] is None


def test_unchanged_category_keeps_its_admin_curated_featured_slot(_tools_dir):
    # A full reseed must never touch featured_slot for a tool whose category
    # didn't change — it's admin-owned overlay, same as display_name.
    _write_tool(_tools_dir, "a-tool", category="document-conversion")
    seed.seed_tools(only_new=False)

    with sync_session() as db:
        db.query(Tool).filter(Tool.id == "a-tool").one().featured_slot = 3

    seed.seed_tools(only_new=False)  # same category, no change

    assert _featured_slots()["a-tool"] == 3
