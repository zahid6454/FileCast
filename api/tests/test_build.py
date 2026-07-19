"""Phase 2 build-system tests.

Drives ``build.py`` (repo root) against the shared test Postgres from conftest.
Covers: the DB tool-state overlay, graceful fallback (DB down / empty table),
the global ``sort_order`` applied upstream of render (P9/D1), ``tool-data.json``
(written straight to dist/, excludes disabled tools), the CSP additions
(``script-src`` untouched), robots/sitemap exclusions, and a full-build snapshot
that also exercises StrictUndefined-safe rendering of admin/account.
"""

import json
import sys
from datetime import date
from pathlib import Path

import pytest

# build.py lives at the repo root (api/tests/test_build.py → parents[2]).
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data.db import sync_session  # noqa: E402
from data.models import Conversion, Rating, Tool  # noqa: E402

import build  # noqa: E402

# conftest sets DATABASE_URL → the test DB before importing data.*, so build.py's
# lazy ``from data.db import sync_session`` binds to the same test engine.


def _seed(rows: list[dict]) -> None:
    with sync_session() as s:
        for r in rows:
            s.add(Tool(**r))


def _tool(**kw) -> dict:
    """A YAML-shaped tool dict (post ``load_tools()``)."""
    base = {
        "id": "png-to-jpg",
        "name": "PNG to JPG Converter",
        "slug": "/convert/png-to-jpg",
        "category": "image-conversion",
        "type": "client-side",
        "input_format": "PNG",
        "output_format": "JPG",
        "tagline": "Shrink PNGs",
        "max_file_size": "20MB",
        "max_file_size_bytes": 20 * 1024**2,
    }
    base.update(kw)
    return base


# --------------------------------------------------------------------------- #
# fetch_tool_overrides — DB read + graceful fallback (P10)
# --------------------------------------------------------------------------- #


def test_fetch_tool_overrides_reads_db():
    _seed(
        [
            dict(
                id="png-to-jpg",
                enabled=True,
                sort_order=3,
                display_name="PNG->JPG",
                maintenance_message="brb",
                custom_max_file_size="50MB",
                category="image-conversion",
                name="PNG to JPG",
            ),
            dict(
                id="jpg-to-png",
                enabled=False,
                sort_order=5,
                category="image-conversion",
                name="JPG to PNG",
            ),
        ]
    )
    ov = build.fetch_tool_overrides()
    assert ov["png-to-jpg"] == {
        "enabled": True,
        "display_name": "PNG->JPG",
        "sort_order": 3,
        "maintenance_message": "brb",
        "custom_max_file_size": "50MB",
    }
    assert ov["jpg-to-png"]["enabled"] is False


def test_fetch_tool_overrides_empty_table_returns_empty():
    # Unseeded / empty table degrades to {} (pure-YAML path), never a crash.
    assert build.fetch_tool_overrides() == {}


def test_fetch_tool_overrides_graceful_when_db_down(monkeypatch):
    import data.db as ddb

    def boom():
        raise RuntimeError("connection refused")

    monkeypatch.setattr(ddb, "sync_session", boom)
    # Must swallow the failure and degrade to YAML-only (P10/R4), not raise.
    assert build.fetch_tool_overrides() == {}


def test_sync_engine_has_bounded_connect_timeout():
    # A finite connect timeout is what makes the graceful path *fast* instead of
    # a hang: an unreachable DB errors within seconds, so build.py falls back to
    # YAML rather than blocking indefinitely.
    import data.db as ddb

    assert isinstance(ddb.CONNECT_TIMEOUT_SECONDS, int)
    assert 0 < ddb.CONNECT_TIMEOUT_SECONDS <= 30


# --------------------------------------------------------------------------- #
# apply_tool_overrides — overlay semantics
# --------------------------------------------------------------------------- #


def test_apply_disabled_tool_excluded():
    tools = [_tool(id="a"), _tool(id="b")]
    out = build.apply_tool_overrides(tools, {"a": {"enabled": False}})
    assert [t["id"] for t in out] == ["b"]


def test_apply_overrides_fields():
    tools = [_tool()]
    out = build.apply_tool_overrides(
        tools,
        {
            "png-to-jpg": {
                "enabled": True,
                "display_name": "New Name",
                "custom_max_file_size": "50MB",
                "sort_order": 7,
                "maintenance_message": "down for maintenance",
            }
        },
    )
    t = out[0]
    assert t["name"] == "New Name"
    assert t["max_file_size"] == "50MB"
    # R3: bytes must be recomputed, not left at the YAML value.
    assert t["max_file_size_bytes"] == build.parse_file_size("50MB")
    assert t["sort_order"] == 7
    assert t["maintenance_message"] == "down for maintenance"


def test_apply_absent_tool_unchanged():
    tools = [_tool()]
    out = build.apply_tool_overrides(tools, {"other": {"enabled": True}})
    assert out[0]["name"] == "PNG to JPG Converter"
    assert "sort_order" not in out[0]


def test_apply_empty_overrides_is_noop():
    tools = [_tool()]
    assert build.apply_tool_overrides(tools, {}) is tools


def test_apply_invalid_custom_size_keeps_yaml():
    tools = [_tool()]
    out = build.apply_tool_overrides(
        tools, {"png-to-jpg": {"enabled": True, "custom_max_file_size": "banana"}}
    )
    # Malformed admin value must not fail the build (P10) — YAML limit retained.
    assert out[0]["max_file_size"] == "20MB"
    assert out[0]["max_file_size_bytes"] == 20 * 1024**2


# --------------------------------------------------------------------------- #
# sort_tools — global order upstream of render (P9/D1)
# --------------------------------------------------------------------------- #


def test_sort_by_sort_order():
    tools = [
        _tool(id="a", sort_order=3),
        _tool(id="b", sort_order=1),
        _tool(id="c", sort_order=2),
    ]
    assert [t["id"] for t in build.sort_tools(tools)] == ["b", "c", "a"]


def test_sort_unseeded_go_to_end_stably():
    tools = [_tool(id="a"), _tool(id="b", sort_order=1), _tool(id="c")]
    # a, c have no sort_order → INF → keep their original order, after b.
    assert [t["id"] for t in build.sort_tools(tools)] == ["b", "a", "c"]


def test_sort_no_db_preserves_filename_order():
    tools = [_tool(id="a"), _tool(id="b"), _tool(id="c")]
    assert [t["id"] for t in build.sort_tools(tools)] == ["a", "b", "c"]


# --------------------------------------------------------------------------- #
# write_tool_data — dist/tool-data.json (P8)
# --------------------------------------------------------------------------- #


def test_write_tool_data_shape(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.write_tool_data([_tool(id="a", tagline="hi"), _tool(id="b")])
    out = tmp_path / "tool-data.json"
    assert out.exists()
    data = json.loads(out.read_text(encoding="utf-8"))  # valid JSON, not minified
    assert [r["id"] for r in data] == ["a", "b"]
    assert set(data[0]) == {
        "id",
        "name",
        "slug",
        "input_format",
        "output_format",
        "category",
        "tagline",
    }


def test_tool_data_excludes_disabled(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "DIST", tmp_path)
    tools = build.apply_tool_overrides(
        [_tool(id="a"), _tool(id="b")], {"a": {"enabled": False}}
    )
    build.write_tool_data(tools)
    data = json.loads((tmp_path / "tool-data.json").read_text(encoding="utf-8"))
    assert [r["id"] for r in data] == ["b"]


def test_write_tool_data_slug_fallback(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "DIST", tmp_path)
    slugless = _tool(id="widget")
    del slugless["slug"]  # a YAML tool may omit slug; must not KeyError the build
    build.write_tool_data([slugless])
    data = json.loads((tmp_path / "tool-data.json").read_text(encoding="utf-8"))
    assert data[0]["slug"] == "/convert/widget"


# --------------------------------------------------------------------------- #
# CSP + robots/sitemap
# --------------------------------------------------------------------------- #


def _csp_line(tmp_path) -> str:
    text = (tmp_path / "_headers").read_text(encoding="utf-8")
    return next(ln for ln in text.splitlines() if "Content-Security-Policy" in ln)


def test_generate_headers_csp_additions(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_headers({})  # no adsense/ga4/sentry
    csp = _csp_line(tmp_path)
    assert "font-src 'self' https://fonts.gstatic.com" in csp
    assert "https://fonts.googleapis.com" in csp  # style-src
    assert "https://lh3.googleusercontent.com" in csp  # img-src
    assert "https://accounts.google.com" in csp  # connect-src OAuth
    assert "https://oauth2.googleapis.com" in csp
    assert "https://api.filecast.io" in csp  # already present, unchanged


def test_generate_headers_script_src_untouched(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_headers({})
    csp = _csp_line(tmp_path)
    assert "script-src 'self';" in csp  # exactly 'self', no new hosts


def test_generate_robots_excludes_admin_account(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_robots({"site": {"base_url": "https://filecast.io"}})
    robots = (tmp_path / "robots.txt").read_text(encoding="utf-8")
    assert "Disallow: /admin/" in robots
    assert "Disallow: /account/" in robots


def test_generate_sitemap_excludes_admin_account(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_sitemap(
        {"site": {"base_url": "https://filecast.io"}}, [_tool(id="a")], {}
    )
    sitemap = (tmp_path / "sitemap.xml").read_text(encoding="utf-8")
    assert "/admin/" not in sitemap
    assert "/account/" not in sitemap


# --------------------------------------------------------------------------- #
# Full build — snapshot + end-to-end overlay (also StrictUndefined-safe render)
# --------------------------------------------------------------------------- #


@pytest.fixture
def built(tmp_path, monkeypatch):
    """Run a full build into a temp dir (no DB overlay unless the test seeds)."""
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    return tmp_path


def test_full_build_additive_outputs(built):
    # tool-data.json valid, written straight to dist/ (not under dist/js/).
    tool_data = built / "tool-data.json"
    assert tool_data.exists()
    assert not (built / "js" / "tool-data.json").exists()
    records = json.loads(tool_data.read_text(encoding="utf-8"))
    assert len(records) == 34  # all YAML tools (no overlay)

    # Snapshot one record's shape/content.
    png = next(r for r in records if r["id"] == "png-to-jpg")
    assert png["input_format"] == "PNG" and png["output_format"] == "JPG"
    assert png["slug"] == "/convert/png-to-jpg"

    # admin/ + account/ shells render (StrictUndefined-safe) and carry noindex.
    admin = (built / "admin" / "index.html").read_text(encoding="utf-8")
    account = (built / "account" / "index.html").read_text(encoding="utf-8")
    assert "noindex, nofollow" in admin
    assert "noindex, nofollow" in account
    assert "filecast-config" in admin  # CSP-safe API config island

    # robots excludes admin/account; sitemap must NOT list them.
    robots = (built / "robots.txt").read_text(encoding="utf-8")
    assert "Disallow: /admin/" in robots and "Disallow: /account/" in robots
    sitemap = (built / "sitemap.xml").read_text(encoding="utf-8")
    assert "/admin/" not in sitemap and "/account/" not in sitemap

    # Existing converter page still carries a working TOOL_CONFIG island.
    page = (built / "convert" / "png-to-jpg" / "index.html").read_text(encoding="utf-8")
    assert 'id="tool-config"' in page

    # head_extra must NOT leak noindex onto ordinary pages (only admin/account).
    home = (built / "index.html").read_text(encoding="utf-8")
    assert "noindex" not in home
    assert "noindex" not in page


def test_full_build_disable_propagates(tmp_path, monkeypatch):
    _seed(
        [
            dict(
                id="png-to-jpg",
                enabled=False,
                sort_order=1,
                category="image-conversion",
                name="PNG to JPG",
            )
        ]
    )
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    assert not (tmp_path / "convert" / "png-to-jpg" / "index.html").exists()
    data = json.loads((tmp_path / "tool-data.json").read_text(encoding="utf-8"))
    assert "png-to-jpg" not in {r["id"] for r in data}


def test_full_build_rename_propagates(tmp_path, monkeypatch):
    _seed(
        [
            dict(
                id="png-to-jpg",
                enabled=True,
                sort_order=1,
                display_name="PNG->JPG (New)",
                category="image-conversion",
                name="PNG to JPG",
            )
        ]
    )
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    page = (tmp_path / "convert" / "png-to-jpg" / "index.html").read_text(
        encoding="utf-8"
    )
    assert "PNG-&gt;JPG (New)" in page or "PNG->JPG (New)" in page
    data = json.loads((tmp_path / "tool-data.json").read_text(encoding="utf-8"))
    rec = next(r for r in data if r["id"] == "png-to-jpg")
    assert rec["name"] == "PNG->JPG (New)"


def test_full_build_sort_order_drives_ordering(tmp_path, monkeypatch):
    # xml-to-json sorts last by filename; sort_order=1 must pull it to the front.
    _seed(
        [
            dict(
                id="xml-to-json",
                enabled=True,
                sort_order=1,
                category="data-conversion",
                name="XML to JSON",
            )
        ]
    )
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    data = json.loads((tmp_path / "tool-data.json").read_text(encoding="utf-8"))
    assert data[0]["id"] == "xml-to-json"


# --------------------------------------------------------------------------- #
# Phase 6 — baked rating aggregates + the conversion total (all P10-degrading)
# --------------------------------------------------------------------------- #


def _seed_ratings(tool_id: str, yes: int, no: int) -> None:
    with sync_session() as s:
        for i in range(yes):
            s.add(Rating(tool_id=tool_id, vote="yes", fingerprint=f"{tool_id}-y{i}"))
        for i in range(no):
            s.add(Rating(tool_id=tool_id, vote="no", fingerprint=f"{tool_id}-n{i}"))
        s.commit()


def test_fetch_rating_aggregates_buckets_by_string_vote():
    # R9: the GROUP BY buckets on the literal 'yes'/'no' strings. A boolean
    # column would drop every row here and bake all-zero scores with no error.
    _seed_ratings("png-to-jpg", yes=44, no=8)
    _seed_ratings("jpg-to-png", yes=2, no=0)
    agg = build.fetch_rating_aggregates()
    assert agg["png-to-jpg"] == {"yes": 44, "no": 8}
    assert agg["jpg-to-png"] == {"yes": 2, "no": 0}


def test_fetch_rating_aggregates_empty_table_returns_empty():
    assert build.fetch_rating_aggregates() == {}


def test_fetch_rating_aggregates_ignores_stray_vote_values():
    # The `vote in ("yes","no")` filter is what makes a bad row inert rather than
    # a KeyError mid-build. A stray value must not appear, crash, or be counted.
    _seed_ratings("png-to-jpg", yes=2, no=1)
    with sync_session() as s:
        s.add(Rating(tool_id="png-to-jpg", vote="maybe", fingerprint="stray"))
        s.commit()
    assert build.fetch_rating_aggregates()["png-to-jpg"] == {"yes": 2, "no": 1}


def test_apply_rating_aggregates_tolerates_ratings_for_unknown_tools():
    # A retired/renamed tool can still have rows (ratings are never purged, D5).
    tools = [_tool(id="png-to-jpg")]
    build.apply_rating_aggregates(tools, {"deleted-tool": {"yes": 9, "no": 1}})
    assert "rating" not in tools[0]
    assert len(tools) == 1


def test_fetch_rating_aggregates_graceful_when_db_down(monkeypatch):
    import data.db as ddb

    def boom():
        raise RuntimeError("connection refused")

    monkeypatch.setattr(ddb, "sync_session", boom)
    # Degrades to "no baked scores" rather than failing the build (P10).
    assert build.fetch_rating_aggregates() == {}


def test_apply_rating_aggregates_annotates_only_present_tools():
    tools = [_tool(id="png-to-jpg"), _tool(id="jpg-to-png")]
    build.apply_rating_aggregates(tools, {"png-to-jpg": {"yes": 44, "no": 8}})
    assert tools[0]["rating"] == {"yes": 44, "no": 8}
    # Absent from the aggregate ⇒ no key at all ⇒ the template emits no island.
    assert "rating" not in tools[1]


def test_apply_rating_aggregates_no_db_annotates_nothing():
    tools = [_tool(id="png-to-jpg")]
    build.apply_rating_aggregates(tools, {})
    assert "rating" not in tools[0]


def test_fetch_total_conversions_sums_and_degrades(monkeypatch):
    with sync_session() as s:
        s.add(Conversion(tool_id="png-to-jpg", date=date(2026, 1, 1), count=700))
        s.add(Conversion(tool_id="jpg-to-png", date=date(2026, 1, 2), count=545))
        s.commit()
    assert build.fetch_total_conversions() == 1245

    import data.db as ddb

    def boom():
        raise RuntimeError("connection refused")

    monkeypatch.setattr(ddb, "sync_session", boom)
    # None (not 0) so the homepage badge is absent rather than showing a zero.
    assert build.fetch_total_conversions() is None


def test_full_build_bakes_rating_island_only_where_rated(tmp_path, monkeypatch):
    _seed_ratings("png-to-jpg", yes=44, no=8)
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()

    rated = (tmp_path / "convert" / "png-to-jpg" / "index.html").read_text(
        encoding="utf-8"
    )
    assert 'id="tool-ratings"' in rated
    island = rated.split('id="tool-ratings">')[1].split("</script>")[0]
    # Raw counts only — no precomputed percentage crosses the language boundary.
    assert json.loads(island) == {"yes": 44, "no": 8}
    assert "%" not in island

    unrated = (tmp_path / "convert" / "jpg-to-png" / "index.html").read_text(
        encoding="utf-8"
    )
    assert 'id="tool-ratings"' not in unrated
    assert 'id="tool-config"' in unrated

    # R3 — the island is a SIBLING, never folded into #tool-config. Nesting it
    # would corrupt that island's JSON and break every converter on the page
    # with no build-time error, so pin the boundary on a *rated* page.
    config_json = rated.split('id="tool-config">')[1].split("</script>")[0]
    assert json.loads(config_json)["id"] == "png-to-jpg"
    assert "tool-ratings" not in config_json
    assert rated.index('id="tool-ratings"') > rated.index('id="tool-config"')


def test_full_build_without_db_emits_no_rating_island(tmp_path, monkeypatch):
    import data.db as ddb

    def boom():
        raise RuntimeError("connection refused")

    monkeypatch.setattr(ddb, "sync_session", boom)
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()  # must not raise (P10)

    page = (tmp_path / "convert" / "png-to-jpg" / "index.html").read_text(
        encoding="utf-8"
    )
    assert 'id="tool-ratings"' not in page
    assert 'id="feedback"' in page  # widget still ships; voting still POSTs
    home = (tmp_path / "index.html").read_text(encoding="utf-8")
    assert "Files Converted" not in home


def test_homepage_conversion_badge_floor(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "DIST", tmp_path)

    # Below the 1000 floor → hidden, so the counter is never a sad small number.
    monkeypatch.setattr(build, "fetch_total_conversions", lambda: 999)
    build.build()
    assert "Files Converted" not in (tmp_path / "index.html").read_text(
        encoding="utf-8"
    )

    # At/above the floor → shown, thousands-formatted in Python (R12).
    monkeypatch.setattr(build, "fetch_total_conversions", lambda: 1245)
    build.build()
    assert "1,245+ Files Converted" in (tmp_path / "index.html").read_text(
        encoding="utf-8"
    )
