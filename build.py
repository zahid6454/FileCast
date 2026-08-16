#!/usr/bin/env python3
"""FileCast static site generator.

Reads tool configs (YAML), content (Markdown), and templates (Jinja2),
then outputs a complete static site to dist/.

Usage:
    python build.py              # Build to dist/
    python build.py --serve      # Build + start local preview server
    python build.py --watch      # Watch for changes, auto-rebuild + live reload
"""

import argparse
import base64
import functools
import hashlib
import http.server
import io
import json
import os
import re
import shutil
import sys
import urllib.request
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlparse

import csscompressor
import jinja2
import markdown
import rjsmin
import yaml
from PIL import Image, ImageDraw, ImageFont

# Ensure console output is UTF-8 so non-ASCII characters (e.g. the "→" in
# build logs) don't crash on Windows' default cp1252 stdout.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
TEMPLATES_DIR = ROOT / "templates"
TOOLS_DIR = ROOT / "tools"
STATIC_DIR = ROOT / "static"
ASSETS_DIR = ROOT / "assets"

# The only accepted values for a tool's `type`. Enforced in load_tools() because
# this field decides a public privacy claim (the Local/Cloud badge); see there.
VALID_TOOL_TYPES = {"client-side", "server-side"}

# The only accepted values for a tool's `subcategory`. Enforced in load_tools()
# because base.html/category.html select on these by equality (StrictUndefined),
# so a missing value crashes every page's build and a typo'd value silently
# drops the tool from both the nav dropdown and the category grid.
VALID_SUBCATEGORIES = {"converter", "utility"}

# Footer "Popular Tools" row (O2 report §5.7/§13 #18). Reuses the exact 6 tools
# the SAME report already named "highest-volume" for the Phase 1 Search
# Console indexing priority (§13 #1) — traceable back to the report itself
# rather than a fresh, undocumented judgment call. Order is deliberate (highest
# volume first); select_popular_tools() below preserves it.
POPULAR_TOOL_IDS = [
    "docx-to-pdf",
    "png-to-jpg",
    "heic-to-jpg",
    "pdf-merge",
    "pdf-compress",
    "image-resize",
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def parse_file_size(size_str: str) -> int:
    """Convert human-readable size like '20MB' to bytes."""
    size_str = size_str.strip().upper()
    match = re.match(r"^(\d+(?:\.\d+)?)\s*(KB|MB|GB)$", size_str)
    if not match:
        raise ValueError(f"Cannot parse file size: {size_str!r}")
    value = float(match.group(1))
    unit = match.group(2)
    multipliers = {"KB": 1024, "MB": 1024**2, "GB": 1024**3}
    return int(value * multipliers[unit])


def file_hash(content: bytes, length: int = 8) -> str:
    """Return first `length` hex chars of SHA-256 digest."""
    return hashlib.sha256(content).hexdigest()[:length]


def sri_hash(content: bytes) -> str:
    """Return SRI integrity attribute value (sha384)."""
    digest = hashlib.sha384(content).digest()
    return "sha384-" + base64.b64encode(digest).decode()


def format_bytes_filter(value: int) -> str:
    """Jinja2 filter: 1048576 → '1.0 MB'."""
    if value < 1024:
        return f"{value} B"
    elif value < 1024**2:
        return f"{value / 1024:.1f} KB"
    elif value < 1024**3:
        return f"{value / 1024 ** 2:.1f} MB"
    else:
        return f"{value / 1024 ** 3:.1f} GB"


def render_markdown(md_path: Path) -> str:
    """Read a markdown file and return HTML. Returns empty string if missing."""
    if not md_path.exists():
        return ""
    text = md_path.read_text(encoding="utf-8")
    return markdown.markdown(text, extensions=["tables", "fenced_code"])


def parse_faq_pairs(md_path: Path) -> list[dict]:
    """Parse FAQ markdown into structured Q&A pairs for FAQPage schema.

    Expects format:
        ### Question text?
        Answer paragraph(s).
    """
    if not md_path.exists():
        return []
    text = md_path.read_text(encoding="utf-8")
    pairs = []
    current_q = None
    current_a_lines: list[str] = []

    for line in text.splitlines():
        if line.startswith("### "):
            if current_q and current_a_lines:
                answer = " ".join(ln.strip() for ln in current_a_lines if ln.strip())
                pairs.append(
                    {
                        "@type": "Question",
                        "name": current_q,
                        "acceptedAnswer": {
                            "@type": "Answer",
                            "text": answer,
                        },
                    }
                )
            current_q = line[4:].strip()
            current_a_lines = []
        elif line.startswith("## "):
            continue
        elif current_q is not None:
            current_a_lines.append(line)

    if current_q and current_a_lines:
        answer = " ".join(ln.strip() for ln in current_a_lines if ln.strip())
        pairs.append(
            {
                "@type": "Question",
                "name": current_q,
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": answer,
                },
            }
        )

    return pairs


# ---------------------------------------------------------------------------
# Step 1: Clean dist/
# ---------------------------------------------------------------------------


def clean_dist():
    if DIST.exists():
        for item in DIST.iterdir():
            if item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink()
    else:
        DIST.mkdir(parents=True)


# ---------------------------------------------------------------------------
# Step 2: Load site config
# ---------------------------------------------------------------------------


def load_site_config() -> dict:
    config_path = ROOT / "site-config.yaml"
    with open(config_path, encoding="utf-8") as f:
        return yaml.safe_load(f)


# ---------------------------------------------------------------------------
# Step 3-4: Discover and parse tool configs
# ---------------------------------------------------------------------------


def fetch_tool_overrides() -> dict:
    """Read the admin tool-state overlay from Postgres via the Phase 1 sync engine.

    Returns ``{tool_id: {enabled, display_name, sort_order, maintenance_message,
    custom_max_file_size}}``, or ``{}`` on ANY failure (shared package not
    importable, ``DATABASE_URL`` unset/unreachable, DB down, empty table) so the
    build degrades to pure-YAML output. A tool absent from the result keeps its
    YAML defaults (ledger P10) — the build never fails closed on DB state.

    Reads the DB directly (no HTTP, no build key) via the same seam as
    ``seed.py``: the shared ``data`` package under ``api/`` (ledger §11 #3, F7).
    ``DATABASE_URL`` comes from the environment/``.env`` (Phase 1 ``Settings``);
    on the host it must point at ``localhost:5432`` (the container uses the
    docker-internal ``postgres`` host) — a wrong/unset URL degrades gracefully.
    """
    try:
        api_path = str(ROOT / "api")  # Phase 1 shared package
        if api_path not in sys.path:  # avoid unbounded growth across watch rebuilds
            sys.path.insert(0, api_path)
        from data.db import sync_session
        from data.models import Tool

        result = {}
        with sync_session() as session:
            for t in session.query(Tool).all():
                result[t.id] = {
                    "enabled": t.enabled,
                    "display_name": t.display_name,
                    "sort_order": t.sort_order,
                    "maintenance_message": t.maintenance_message,
                    "custom_max_file_size": t.custom_max_file_size,
                }
        if result:
            print(f"  [db] tool overlay applied ({len(result)} row(s))")
        return result  # populated only on full success
    except Exception as e:  # noqa: BLE001 — intentional catch-all (ledger P10/R4)
        print(
            f"  [db] tool overlay unavailable ({type(e).__name__}); "
            f"building from YAML only"
        )
        return {}  # all-or-nothing: never a half overlay


def apply_tool_overrides(tools: list[dict], overrides: dict) -> list[dict]:
    """Merge the DB overlay onto each YAML-enabled tool; drop admin-disabled tools.

    - ``enabled is False`` in the DB row ⇒ **exclude** the tool (the operational
      toggle over YAML-enabled tools; the DB never resurrects a YAML-disabled tool
      — those were never loaded by ``load_tools()``).
    - ``display_name`` (non-empty) → ``tool["name"]``.
    - ``custom_max_file_size`` (non-empty) → ``tool["max_file_size"]`` **and**
      recomputes ``tool["max_file_size_bytes"]`` (the bytes value is what the
      client enforces via ``TOOL_CONFIG``; a stale one would be a silent bug — R3).
    - ``sort_order`` (not None) → ``tool["sort_order"]``.
    - ``maintenance_message`` (non-empty) → ``tool["maintenance_message"]``.
    - A tool **absent** from ``overrides`` is left exactly as YAML produced it (P10).

    Kept separate from ``load_tools()`` so the no-DB path stays pure-YAML.
    """
    if not overrides:
        return tools
    result = []
    for tool in tools:
        ov = overrides.get(tool["id"])
        if ov is None:
            result.append(tool)  # unseeded → YAML defaults (P10)
            continue
        if ov.get("enabled") is False:
            print(f"  [db] {tool['id']} disabled by admin overlay")
            continue
        display_name = ov.get("display_name")
        if display_name:
            tool["name"] = display_name
        custom_size = ov.get("custom_max_file_size")
        if custom_size:
            try:
                tool["max_file_size_bytes"] = parse_file_size(custom_size)
                tool["max_file_size"] = custom_size
            except ValueError:
                # Malformed admin value must not fail the build (P10): keep YAML.
                print(
                    f"  [db] {tool['id']}: ignoring invalid "
                    f"custom_max_file_size {custom_size!r}"
                )
        sort_order = ov.get("sort_order")
        if sort_order is not None:
            tool["sort_order"] = sort_order
        maintenance = ov.get("maintenance_message")
        if maintenance:
            tool["maintenance_message"] = maintenance
        result.append(tool)
    return result


def fetch_site_settings() -> dict:
    """Read the admin Site Settings overlay from Postgres via the Phase 1 sync engine.

    Returns an overlay shaped like the ``site-config.yaml`` blocks it overrides
    (``site`` / ``adsense`` / ``ga4`` / ``sentry``), or ``{}`` on ANY failure
    (shared package not importable, ``DATABASE_URL`` unset/unreachable, DB down,
    no singleton row) so the build degrades to pure-YAML output — all
    integrations OFF and today's copy (ledger P10).

    **All-or-nothing (load-bearing).** A partial merge would ship a
    half-configured site with no warning: the CSP and the templates could
    disagree about which integrations are on. So this returns either the FULL
    overlay or ``{}`` — never a subset. Same DB seam as ``fetch_tool_overrides``.
    """
    try:
        api_path = str(ROOT / "api")  # Phase 1 shared package
        if api_path not in sys.path:  # avoid unbounded growth across watch rebuilds
            sys.path.insert(0, api_path)
        from data.db import sync_session
        from data.models import SiteSetting

        with sync_session() as session:
            row = session.query(SiteSetting).filter(SiteSetting.id == 1).one_or_none()
            if row is None:
                return {}  # no row → pure YAML (all-off launch posture)
            overlay = {
                "site": {
                    "name": row.site_name,
                    "tagline": row.site_tagline,
                    "description": row.site_description,
                },
                "adsense": {
                    "enabled": row.adsense_enabled,
                    "publisher_id": row.adsense_publisher_id or "",
                    "slots": {
                        "leaderboard": row.adsense_slot_leaderboard or "",
                        "in_content": row.adsense_slot_in_content or "",
                    },
                },
                "ga4": {
                    "enabled": row.ga4_enabled,
                    "measurement_id": row.ga4_measurement_id or "",
                },
                "sentry": {
                    "enabled": row.sentry_enabled,
                    "dsn": row.sentry_dsn or "",
                },
            }
        print("  [db] site settings overlay applied")
        return overlay  # populated only on full success
    except Exception as e:  # noqa: BLE001 — intentional catch-all (ledger P10/R4)
        print(
            f"  [db] site settings unavailable ({type(e).__name__}); "
            f"building from YAML only"
        )
        return {}  # all-or-nothing: never a half overlay


def _deep_merge(base: dict, overlay: dict) -> dict:
    """Recursively overlay ``overlay`` onto ``base`` in place.

    Only keys present in ``overlay`` are touched, so YAML-only structural fields
    (``site.base_url``, ``adsense.slots.footer``) survive the merge — the overlay
    carries just the admin-editable display/integration keys.
    """
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value
    return base


def apply_site_settings(site_config: dict, overlay: dict) -> dict:
    """Merge the DB Site Settings overlay onto the YAML ``site_config``.

    An empty ``overlay`` (DB down / no row) leaves ``site_config`` untouched → the
    all-off YAML launch posture. Applied ONCE right after ``load_site_config()`` so
    BOTH ``create_jinja_env()`` (``env.globals``) and ``generate_headers()`` (the
    CSP) read the same merged dict and can never disagree.
    """
    if not overlay:
        return site_config
    return _deep_merge(site_config, overlay)


def fetch_rating_aggregates() -> dict:
    """Read per-tool yes/no vote counts from Postgres via the Phase 1 sync engine.

    Returns ``{tool_id: {"yes": int, "no": int}}``, or ``{}`` on ANY failure
    (shared package not importable, ``DATABASE_URL`` unset/unreachable, DB down,
    empty table) so tool pages simply render without a baked score — never
    fail-closed (ledger P10). One ``GROUP BY`` query, not one per tool.

    ``Rating.vote`` is a **String** holding the literal ``'yes'``/``'no'`` (the
    hard Phase 6 §7/R9 contract): a boolean column would make the bucket filter
    below drop every row and bake all-zero aggregates with no error.

    Ratings are RETAINED by the purge (D5), so this aggregate is stable across
    deploys rather than decaying.
    """
    try:
        api_path = str(ROOT / "api")  # Phase 1 shared package
        if api_path not in sys.path:  # avoid unbounded growth across watch rebuilds
            sys.path.insert(0, api_path)
        from data.db import sync_session
        from data.models import Rating
        from sqlalchemy import func, select

        result: dict = {}
        with sync_session() as session:
            rows = session.execute(
                select(Rating.tool_id, Rating.vote, func.count()).group_by(
                    Rating.tool_id, Rating.vote
                )
            ).all()
        for tool_id, vote, n in rows:
            if vote in ("yes", "no"):
                bucket = result.setdefault(tool_id, {"yes": 0, "no": 0})
                bucket[vote] += int(n)
        if result:
            print(f"  [db] rating aggregates baked ({len(result)} tool(s))")
        return result
    except Exception as e:  # noqa: BLE001 — intentional catch-all (ledger P10)
        print(
            f"  [db] rating aggregates unavailable ({type(e).__name__}); "
            f"tool pages render without baked scores"
        )
        return {}


def apply_rating_aggregates(tools: list[dict], aggregates: dict) -> list[dict]:
    """Annotate each tool with its raw ``{yes, no}`` counts, where it has any.

    A tool absent from ``aggregates`` keeps **no** ``rating`` key, so its template
    renders no ``#tool-ratings`` island and the widget falls back to the plain
    prompt — the per-tool P10 degrade.

    Raw counts only: the 50-rating threshold and the percentage are computed
    client-side in ``shared.js`` (``scoreLine()``), in one place rather than
    duplicated across two languages (R4).
    """
    for tool in tools:
        agg = aggregates.get(tool["id"])
        if agg:
            tool["rating"] = {"yes": agg.get("yes", 0), "no": agg.get("no", 0)}
    return tools


def fetch_total_conversions() -> int | None:
    """Sum the anonymous conversions aggregate for the homepage trust counter.

    Returns the total, or ``None`` on ANY failure (P10) — the homepage badge is
    guarded on it, so no DB simply means no badge and a homepage identical to
    Phase 3's.
    """
    try:
        api_path = str(ROOT / "api")  # Phase 1 shared package
        if api_path not in sys.path:  # avoid unbounded growth across watch rebuilds
            sys.path.insert(0, api_path)
        from data.db import sync_session
        from data.models import Conversion
        from sqlalchemy import func, select

        with sync_session() as session:
            total = session.execute(
                select(func.coalesce(func.sum(Conversion.count), 0))
            ).scalar_one()
        return int(total)
    except Exception as e:  # noqa: BLE001 — intentional catch-all (ledger P10)
        print(
            f"  [db] conversion total unavailable ({type(e).__name__}); "
            f"homepage counter hidden"
        )
        return None


def sort_tools(tools: list[dict]) -> list[dict]:
    """Stable global sort of the flat tools list by the DB ``sort_order`` (P9/D1).

    Applied **upstream** of ``group_tools_by_category()`` so home/404/category
    pages and ``tool-data.json`` all inherit the admin order. Tools without a
    ``sort_order`` (unseeded, or the whole no-DB path) sort to the end and keep
    their current (filename) order — a stable sort makes the no-DB output
    byte-identical to today's.
    """
    inf = float("inf")
    return sorted(
        tools,
        key=lambda t: t["sort_order"] if t.get("sort_order") is not None else inf,
    )


def select_popular_tools(tools: list[dict]) -> list[dict]:
    """Resolve POPULAR_TOOL_IDS to lightweight {id, name, slug} dicts, in that
    list's order, for the footer's "Popular Tools" row.

    Skips any id not present in ``tools`` rather than erroring — the same P10
    degrade-gracefully posture as apply_tool_overrides(): an admin disabling
    one of these six tools via the DB overlay must not break every page's
    footer, just quietly shorten the row by one.
    """
    tool_map = {t["id"]: t for t in tools}
    return [
        {"id": tid, "name": tool_map[tid]["name"], "slug": tool_map[tid]["slug"]}
        for tid in POPULAR_TOOL_IDS
        if tid in tool_map
    ]


def load_tools() -> list[dict]:
    tools = []
    if not TOOLS_DIR.exists():
        return tools
    for yaml_path in sorted(TOOLS_DIR.glob("*.yaml")):
        with open(yaml_path, encoding="utf-8") as f:
            tool = yaml.safe_load(f)
        if not isinstance(tool, dict):
            print(f"  [warn] Skipping invalid tool file: {yaml_path.name}")
            continue
        if "id" not in tool:
            print(f"  [warn] Skipping tool without 'id': {yaml_path.name}")
            continue
        # `type` is privacy-critical, not cosmetic: it selects the Local/Cloud
        # badge, the HowTo structured data, whether api_base_url reaches
        # TOOL_CONFIG, and whether server-upload.js loads. Those consumers do
        # not agree on a default — the badge macro treats "not server-side" as
        # Local, while tool.html's HowTo block treats "not client-side" as
        # uploaded — so a typo like `server` or `Server-Side` would render a
        # green "Local / runs entirely in your browser" pill on a tool that
        # uploads. Fail loudly here instead: a skip would silently drop the
        # tool from the live site, and a warning would scroll past in a 34-tool
        # build. An *absent* type already crashes via StrictUndefined; this
        # closes the typo case.
        if tool.get("type") not in VALID_TOOL_TYPES:
            raise SystemExit(
                f"  [fail] {yaml_path.name}: 'type' is {tool.get('type')!r}, "
                f"expected one of {sorted(VALID_TOOL_TYPES)}. This field drives "
                f"the privacy badge — fix the YAML rather than relaxing this check."
            )
        # base.html/category.html select on this by equality to split the nav
        # dropdown and category grid into converters vs. utility tools. A
        # missing value crashes StrictUndefined on every page (the nav is
        # site-wide); a typo'd value silently drops the tool from both.
        # Fail loudly here instead, at the one place that knows the filename.
        if tool.get("subcategory") not in VALID_SUBCATEGORIES:
            raise SystemExit(
                f"  [fail] {yaml_path.name}: 'subcategory' is {tool.get('subcategory')!r}, "
                f"expected one of {sorted(VALID_SUBCATEGORIES)}. This field drives "
                f"the nav dropdown / category page split — fix the YAML rather than "
                f"relaxing this check."
            )
        if not tool.get("enabled", True):
            print(f"  [skip] {tool['id']} (disabled)")
            continue
        tool["max_file_size_bytes"] = parse_file_size(tool.get("max_file_size", "20MB"))
        tools.append(tool)
    return tools


# ---------------------------------------------------------------------------
# Step 5: Group tools by category
# ---------------------------------------------------------------------------


def group_tools_by_category(tools: list[dict], categories: list[dict]) -> dict:
    """Return {category_id: {**category_data, 'tools': [...]}} only for non-empty categories."""
    by_cat = {}
    for cat in categories:
        cat_tools = [t for t in tools if t.get("category") == cat["id"]]
        if cat_tools:
            by_cat[cat["id"]] = {**cat, "tools": cat_tools}
    return by_cat


# ---------------------------------------------------------------------------
# Step 6: Load content markdown for each tool
# ---------------------------------------------------------------------------


def load_tool_content(tools: list[dict]):
    """Mutate each tool dict: add 'content_html' with rendered HTML blocks
    and 'faq_structured_data' with parsed Q&A pairs for FAQPage schema."""
    for tool in tools:
        content_config = tool.get("content", {})
        content_html = {}
        for key, rel_path in content_config.items():
            md_path = ROOT / rel_path
            content_html[key] = render_markdown(md_path)
        tool["content_html"] = content_html

        faq_path = content_config.get("faq", "")
        if faq_path:
            tool["faq_structured_data"] = parse_faq_pairs(ROOT / faq_path)
        else:
            tool["faq_structured_data"] = []


# ---------------------------------------------------------------------------
# Step 6b: "Alternatives" content block (O2 report §5.8/§13 #19)
# ---------------------------------------------------------------------------
#
# Shared, group-keyed snippets rather than 34 bespoke per-tool essays: most
# tools are grouped by OUTPUT format — a JPG output has the same real-world
# offline alternatives whether it came from PNG, WebP, or HEIC (Preview/
# Photos/GIMP handle all of them identically), so {source}/{target} template
# substitution is enough to keep each one accurate. ALTERNATIVES_GROUP_OVERRIDES
# covers the tools whose real alternative differs from their output-format
# siblings:
#   - the four PDF ACTION tools (pdf-compress/merge/rotate/split are all
#     PDF->PDF) don't share docx/pptx/xlsx-to-pdf's "open in Office and Save
#     As" answer — there's no source document to open.
#   - html-to-pdf/image-to-pdf's alternative is a browser print dialog or the
#     OS's print-to-PDF feature, not an Office app.
#   - the three image action tools (compress/resize/bulk-compress) have no
#     "convert to X" answer at all; they share one resize/compress-specific
#     snippet instead.
#
# Every (heading, sentence) pair below may reference {source}/{target}
# (tool.input_format/output_format) via str.format().
ALTERNATIVES: dict[str, tuple[str, str]] = {
    "PDF": (
        "Other Ways to Convert {source} to PDF",
        "You can also convert {source} to PDF using Microsoft Word, PowerPoint, or Excel (File → Save As → PDF), Google Docs, Slides, or Sheets (File → Download → PDF), or LibreOffice (File → Export as PDF). FileCast is useful when you don't have these installed or prefer not to upload your file to a cloud service.",
    ),
    "browser-print-to-pdf": (
        "Other Ways to Convert {source} to PDF",
        "You can also create a PDF from {source} using your browser's Print dialog (Print → Save as PDF), or your operating system's own print-to-PDF feature. FileCast is useful when you want a quick conversion without opening a print dialog.",
    ),
    "DOCX": (
        "Other Ways to Convert {source} to Word",
        "You can also convert {source} to an editable Word document using Microsoft Word (Open, then Save As), Google Docs (Open, then Download as Word), or LibreOffice Writer (Open, then Export as DOCX). FileCast is useful when you don't have any of these installed.",
    ),
    "JPG": (
        "Other Ways to Convert {source} to JPG",
        "You can also convert {source} to JPG using your device's built-in photo viewer (File → Export or Save As), or an image editor like GIMP or Photoshop. FileCast is useful when you want a quick conversion without opening a separate app.",
    ),
    "PNG": (
        "Other Ways to Convert {source} to PNG",
        "You can also convert {source} to PNG using your device's built-in photo viewer (File → Export or Save As), or an image editor like GIMP or Photoshop. FileCast is useful when you want a quick conversion without opening a separate app.",
    ),
    "WebP": (
        "Other Ways to Convert {source} to WebP",
        "You can also convert {source} to WebP using an image editor like GIMP or Photoshop, both of which support WebP export. FileCast is useful when you don't have an image editor installed.",
    ),
    "HTML": (
        "Other Ways to Convert {source} to HTML",
        "You can also convert {source} to HTML using a word processor's \"Save as Web Page\" export, or a short script using your language's {source} and HTML libraries. FileCast is useful for a one-off conversion without setting either up.",
    ),
    "Markdown": (
        "Other Ways to Convert HTML to Markdown",
        "You can also convert HTML to Markdown using a browser extension, or your CMS's built-in export option, if it has one. FileCast is useful when neither is available.",
    ),
    "JSON": (
        "Other Ways to Convert {source} to JSON",
        "You can also convert {source} to JSON using a short script in your language of choice — most have built-in libraries for both {source} and JSON — or a dedicated command-line conversion tool. FileCast is useful for a quick, one-off conversion without writing any code.",
    ),
    "CSV": (
        "Other Ways to Convert {source} to CSV",
        "You can also convert {source} to CSV by importing it into a spreadsheet app like Excel or Google Sheets and saving as CSV, or with a short script using your language's {source} and CSV libraries. FileCast is useful for a quick, one-off conversion.",
    ),
    "XML": (
        "Other Ways to Convert {source} to XML",
        "You can also convert {source} to XML using a dedicated command-line conversion tool, or a short script using your language's {source} and XML libraries. FileCast is useful for a quick, one-off conversion without writing any code.",
    ),
    "YAML": (
        "Other Ways to Convert {source} to YAML",
        "You can also convert {source} to YAML using a dedicated command-line conversion tool, or a short script using your language's {source} and YAML libraries. FileCast is useful for a quick, one-off conversion without writing any code.",
    ),
    "pdf-compress": (
        "Other Ways to Compress a PDF",
        "You can also compress a PDF using Adobe Acrobat's Compress PDF tool, or Preview on Mac (File → Export → Reduce File Size). FileCast is useful when you don't have either installed.",
    ),
    "pdf-merge": (
        "Other Ways to Merge PDFs",
        "You can also merge PDFs using Preview on Mac (drag page thumbnails between two open PDFs), or Adobe Acrobat's Combine Files tool. FileCast is useful when you don't have either installed.",
    ),
    "pdf-rotate": (
        "Other Ways to Rotate a PDF",
        "You can also rotate PDF pages using Preview on Mac (Tools → Rotate, then File → Export), or Adobe Acrobat's page rotation tool. FileCast is useful when you don't have either installed.",
    ),
    "pdf-split": (
        "Other Ways to Split a PDF",
        "You can also split a PDF using Preview on Mac (drag pages out of the thumbnail sidebar into a new document), or Adobe Acrobat's Organize Pages tool. FileCast is useful when you don't have either installed.",
    ),
    "image-resize-compress": (
        "Other Ways to Resize or Compress Images",
        "You can also resize or compress images using your device's Preview or Photos app (File → Export, with a quality or size option), or a desktop tool like ImageOptim (Mac) or FileOptimizer (Windows). FileCast is useful when you don't have any of these installed.",
    ),
    # Build Action Plan PR 1: 10 Modification-type Developer tools (formatters,
    # validators, minifiers, a diff tool) that don't convert one format to
    # another, so none of them fit the {source}/{target} conversion phrasing
    # above even though several share an output_format with a conversion tool
    # already in that table (JSON/XML/HTML). Each gets its own id-keyed entry
    # here, phrased as an action, the same way the four pdf-* action tools do.
    "json-formatter": (
        "Other Ways to Format JSON",
        "You can also format JSON using your code editor's built-in \"Format Document\" command (most support JSON out of the box), or a command-line tool like jq (jq . file.json) or Python's python -m json.tool. FileCast is useful when you don't have either installed.",
    ),
    "json-validator": (
        "Other Ways to Validate JSON",
        "You can also validate JSON using your code editor's built-in linting (most flag malformed JSON as you type), or a command-line tool like jq or Python's python -m json.tool, which fails loudly on invalid input. FileCast is useful when you don't have either installed.",
    ),
    "json-minifier": (
        "Other Ways to Minify JSON",
        "You can also minify JSON using a command-line tool like jq -c, or as part of a JavaScript build pipeline (webpack, esbuild, etc.) that already minifies JSON imports. FileCast is useful for a quick, one-off minification without setting up a build.",
    ),
    "xml-formatter": (
        "Other Ways to Format XML",
        "You can also format XML using your code editor's built-in \"Format Document\" command, or a command-line tool like xmllint --format. FileCast is useful when you don't have either installed.",
    ),
    "xml-validator": (
        "Other Ways to Validate XML",
        "You can also validate XML using a command-line tool like xmllint --noout, or the W3C's online XML Validator. FileCast is useful when you don't have either installed.",
    ),
    "html-formatter": (
        "Other Ways to Format HTML",
        "You can also format HTML using your code editor's built-in \"Format Document\" command (often via the Prettier extension), or Prettier's own command-line tool. FileCast is useful when you don't have either installed.",
    ),
    "html-minifier": (
        "Other Ways to Minify HTML",
        "You can also minify HTML using the html-minifier-terser command-line tool, or as part of a build pipeline (webpack, Vite, etc.) that already minifies HTML output. FileCast is useful for a quick, one-off minification without setting up a build.",
    ),
    "yaml-validator": (
        "Other Ways to Validate YAML",
        "You can also validate YAML using the yamllint command-line tool, or Python's python -c \"import yaml, sys; yaml.safe_load(open(sys.argv[1]))\" sys.argv[1] filename, which raises an error on malformed input. FileCast is useful when you don't have either installed.",
    ),
    "css-js-minifier": (
        "Other Ways to Minify CSS or JavaScript",
        "You can also minify CSS or JavaScript using a build tool like esbuild, Terser (JS), or cssnano (CSS), or an IDE extension that minifies on save. FileCast is useful for a quick, one-off minification without setting up a build.",
    ),
    "json-diff": (
        "Other Ways to Diff JSON",
        "You can also diff JSON by formatting both files (e.g. with jq -S . file.json to sort keys) and comparing them with a regular text diff tool like diff or your code editor's built-in file comparison view. FileCast is useful for a quick, one-off comparison without formatting each file yourself first.",
    ),
    # Build Action Plan PR 2: 9 Conversion-type Developer tools that are still
    # bespoke enough (bidirectional, generator, or decode-only) that the
    # {source}/{target} conversion phrasing above doesn't fit any better than
    # it did for PR 1's Modification tools — each gets its own id-keyed entry
    # here, the same way.
    "base64-encode-decode": (
        "Other Ways to Encode or Decode Base64",
        "You can also encode or decode Base64 using your command line (base64 and base64 -d on Mac/Linux, or certutil -encode on Windows), or a short script in your language of choice — most have a built-in Base64 library. FileCast is useful for a quick, one-off conversion without opening a terminal.",
    ),
    "url-encode-decode": (
        "Other Ways to URL-Encode or Decode Text",
        "You can also URL-encode or decode text using your browser's developer console (encodeURIComponent()/decodeURIComponent()), or a short script in your language of choice. FileCast is useful for a quick, one-off conversion without opening dev tools.",
    ),
    "base64-to-image": (
        "Other Ways to Convert Base64 to an Image",
        "You can also convert Base64 to an image by saving the string to a text file and decoding it with a command-line tool like base64 -d, or by pasting a full data: URL directly into your browser's address bar to view it. FileCast is useful when you also want a live preview and a ready-to-download file in one step.",
    ),
    "html-to-text": (
        "Other Ways to Strip HTML Tags",
        "You can also strip HTML tags using a command-line tool like Python's html2text library, or by pasting into a plain-text editor that ignores markup on paste. FileCast is useful for a quick, one-off conversion without writing any code.",
    ),
    "json-to-typescript": (
        "Other Ways to Generate TypeScript from JSON",
        "You can also generate TypeScript types from JSON using a code editor extension, or the quicktype command-line tool. FileCast is useful for a quick, one-off conversion without installing anything.",
    ),
    "uuid-generator": (
        "Other Ways to Generate a UUID",
        "You can also generate a UUID using your command line (uuidgen on Mac/Linux, or [guid]::NewGuid() in PowerShell), or a one-line snippet in most programming languages' standard library. FileCast is useful when you need several at once without opening a terminal.",
    ),
    "number-base-converter": (
        "Other Ways to Convert Number Bases",
        "You can also convert between number bases using your calculator app's programmer mode, or a quick command in your language's REPL (Python's bin(), hex(), and oct(), for example). FileCast is useful for a quick, one-off conversion without switching apps.",
    ),
    "unix-timestamp-converter": (
        "Other Ways to Convert a Unix Timestamp",
        "You can also convert a Unix timestamp using your command line (for example, date -d @1700000000 on Linux), or a quick snippet in your language of choice. FileCast is useful for a quick, one-off conversion with both directions in one place.",
    ),
    "jwt-decoder": (
        "Other Ways to Decode a JWT",
        "You can also decode a JWT using jwt.io, or a short script using your language's Base64 library — the header and payload are just Base64url-encoded JSON. FileCast is useful for a quick, one-off decode without pasting a token into a third-party site tied to a specific vendor.",
    ),
    # Build Action Plan PR 3: CSV/XML/YAML conversions reuse the {source}/
    # {target}-templated CSV/XML/YAML entries above via output_format —
    # only the 4 bespoke tools below (a new output format, XLSX, plus 3
    # generators with no "convert X to Y" framing) need their own entry.
    "XLSX": (
        "Other Ways to Convert {source} to Excel",
        "You can also convert {source} to Excel by opening it in Excel or Google Sheets directly (both read CSV natively) and saving or exporting as XLSX. FileCast is useful when you want the .xlsx file itself without opening a spreadsheet app.",
    ),
    "hash-generator": (
        "Other Ways to Generate a Hash",
        "You can also generate a hash using your command line (sha256sum or md5sum on Mac/Linux, or Get-FileHash in PowerShell), or a short script using your language's built-in hashing library. FileCast is useful for a quick hash of pasted text without opening a terminal.",
    ),
    "barcode-generator": (
        "Other Ways to Generate a Barcode",
        "You can also generate a Code 128 barcode using a desktop label-printing app, or a short script using a barcode library in your language of choice. FileCast is useful for a quick, one-off barcode without installing anything.",
    ),
    "qr-code-generator": (
        "Other Ways to Generate a QR Code",
        "You can also generate a QR code using your phone's built-in QR creation tools (where available), or a short script using a QR library in your language of choice. FileCast is useful for a quick, one-off QR code without installing anything.",
    ),
    # Build Action Plan PR 4: 10 PDF page-modification tools, all PDF->PDF
    # (Modification-type, not conversions), so each gets its own action-phrased
    # entry the same way pdf-compress/merge/rotate/split do above rather than
    # the {source}/{target} "PDF" conversion entry, which is for tools that
    # convert a *different* source format into PDF.
    "pdf-protect": (
        "Other Ways to Password-Protect a PDF",
        "You can also add a password to a PDF using Adobe Acrobat's Protect tool, or Preview on Mac (File → Export as PDF, then check Encrypt and set a password). FileCast is useful when you don't have either installed.",
    ),
    "pdf-watermark": (
        "Other Ways to Add a Watermark to a PDF",
        "You can also add a watermark using Adobe Acrobat's Watermark tool, or Microsoft Word's Design → Watermark option if you still have the original document. FileCast is useful when you only have the PDF, not the source file.",
    ),
    "pdf-page-numbers": (
        "Other Ways to Add Page Numbers to a PDF",
        "You can also add page numbers using Adobe Acrobat's Header & Footer tool, or your word processor's built-in page numbering before exporting to PDF. FileCast is useful when you only have the PDF.",
    ),
    "pdf-crop": (
        "Other Ways to Crop a PDF",
        "You can also crop a PDF's margins using Adobe Acrobat's Crop Pages tool, or by re-exporting from the original document with smaller margins. FileCast is useful when you don't have either option available.",
    ),
    "pdf-flatten": (
        "Other Ways to Flatten a PDF",
        "You can also flatten a PDF's form fields using Adobe Acrobat's Flatten Fields tool, or by printing the filled form to a virtual PDF printer. FileCast is useful when you don't have Acrobat installed.",
    ),
    "pdf-to-pdfa": (
        "Other Ways to Convert PDF to PDF/A",
        "You can also convert a PDF to PDF/A using Adobe Acrobat Pro's \"Save As Other → Archive PDF\" tool, or LibreOffice's Export As → PDF/A option. FileCast is useful for quick PDF/A metadata tagging without either installed — for full ISO 19005 compliance verification, a dedicated validator like veraPDF is still the authoritative check.",
    ),
    "pdf-extract-pages": (
        "Other Ways to Extract Pages from a PDF",
        "You can also extract pages using Preview on Mac (drag page thumbnails into a new document), or Adobe Acrobat's Organize Pages tool. FileCast is useful when you don't have either installed.",
    ),
    "pdf-remove-pages": (
        "Other Ways to Remove Pages from a PDF",
        "You can also remove pages using Preview on Mac (select thumbnails and press Delete), or Adobe Acrobat's Organize Pages tool. FileCast is useful when you don't have either installed.",
    ),
    "pdf-organize": (
        "Other Ways to Reorder PDF Pages",
        "You can also reorder pages using Preview on Mac (drag thumbnails into a new order), or Adobe Acrobat's Organize Pages tool. FileCast is useful when you don't have either installed.",
    ),
    "pdf-unlock": (
        "Other Ways to Remove a PDF Password",
        "You can also remove a PDF password using Adobe Acrobat (open with the password, then Protect → Remove Security), or Preview on Mac (open with the password, then File → Export as PDF without checking Encrypt). FileCast is useful when you don't have either installed.",
    ),
}

ALTERNATIVES_GROUP_OVERRIDES = {
    "html-to-pdf": "browser-print-to-pdf",
    "image-to-pdf": "browser-print-to-pdf",
    "pdf-compress": "pdf-compress",
    "pdf-merge": "pdf-merge",
    "pdf-rotate": "pdf-rotate",
    "pdf-split": "pdf-split",
    "image-compress": "image-resize-compress",
    "image-resize": "image-resize-compress",
    "bulk-image-compress": "image-resize-compress",
    "json-formatter": "json-formatter",
    "json-validator": "json-validator",
    "json-minifier": "json-minifier",
    "xml-formatter": "xml-formatter",
    "xml-validator": "xml-validator",
    "html-formatter": "html-formatter",
    "html-minifier": "html-minifier",
    "yaml-validator": "yaml-validator",
    "css-js-minifier": "css-js-minifier",
    "json-diff": "json-diff",
    "base64-encode-decode": "base64-encode-decode",
    "url-encode-decode": "url-encode-decode",
    "base64-to-image": "base64-to-image",
    "html-to-text": "html-to-text",
    "json-to-typescript": "json-to-typescript",
    "uuid-generator": "uuid-generator",
    "number-base-converter": "number-base-converter",
    "unix-timestamp-converter": "unix-timestamp-converter",
    "jwt-decoder": "jwt-decoder",
    "hash-generator": "hash-generator",
    "barcode-generator": "barcode-generator",
    "qr-code-generator": "qr-code-generator",
    "pdf-protect": "pdf-protect",
    "pdf-watermark": "pdf-watermark",
    "pdf-page-numbers": "pdf-page-numbers",
    "pdf-crop": "pdf-crop",
    "pdf-flatten": "pdf-flatten",
    "pdf-to-pdfa": "pdf-to-pdfa",
    "pdf-extract-pages": "pdf-extract-pages",
    "pdf-remove-pages": "pdf-remove-pages",
    "pdf-organize": "pdf-organize",
    "pdf-unlock": "pdf-unlock",
}


def load_alternatives(tools: list[dict]):
    """Mutate each tool dict: add 'alternatives_html', a short "Other Ways
    to..." section (O2 report §5.8/§13 #19). See the module comment above
    ALTERNATIVES for the grouping rationale. `tool["alternatives_html"]` is
    plain literal HTML built from strings this file owns (never from tool
    YAML content), so no markdown/escaping pass is needed before rendering it
    with `|safe`, matching content_html's own already-rendered-HTML contract.
    """
    for tool in tools:
        group = ALTERNATIVES_GROUP_OVERRIDES.get(tool["id"], tool.get("output_format"))
        entry = ALTERNATIVES.get(group)
        if not entry:
            tool["alternatives_html"] = ""
            continue
        heading_tmpl, sentence_tmpl = entry
        fmt = {
            "source": tool.get("input_format", ""),
            "target": tool.get("output_format", ""),
        }
        tool["alternatives_html"] = (
            f"<h2>{heading_tmpl.format(**fmt)}</h2>\n<p>{sentence_tmpl.format(**fmt)}</p>"
        )


# ---------------------------------------------------------------------------
# Step 7: Resolve related tools
# ---------------------------------------------------------------------------


def resolve_related_tools(tools: list[dict]):
    """Filter out related_tools IDs that don't exist in the tool set.

    Stores lightweight copies (id, name, slug, meta, category, type) to avoid
    circular references when templates serialize tool data to JSON.
    """
    tool_map = {t["id"]: t for t in tools}
    RELATED_FIELDS = (
        "id",
        "name",
        "slug",
        "meta",
        "category",
        "type",
        "input_format",
        "output_format",
    )
    for tool in tools:
        raw = tool.get("related_tools", []) or []
        resolved = []
        for tid in raw:
            if tid in tool_map:
                resolved.append(
                    {k: tool_map[tid][k] for k in RELATED_FIELDS if k in tool_map[tid]}
                )
        tool["related_tools_resolved"] = resolved

        reverse_id = tool.get("reverse_tool")
        if reverse_id and reverse_id in tool_map:
            rt = tool_map[reverse_id]
            tool["reverse_tool_resolved"] = {
                k: rt[k] for k in RELATED_FIELDS if k in rt
            }
            target_reverse = tool_map[reverse_id].get("reverse_tool")
            if target_reverse != tool["id"]:
                print(
                    f"  [warn] {tool['id']}: reverse_tool '{reverse_id}' does not point back (has '{target_reverse}')"
                )
        elif reverse_id:
            print(f"  [warn] {tool['id']}: reverse_tool '{reverse_id}' not found")
            tool["reverse_tool_resolved"] = None
        else:
            tool["reverse_tool_resolved"] = None


# ---------------------------------------------------------------------------
# Emit dist/tool-data.json for the homepage/404 client search (ledger P8)
# ---------------------------------------------------------------------------


def write_tool_data(tools: list[dict]):
    """Write ``dist/tool-data.json`` for the homepage/404 client search.

    Written **straight to DIST**, never through ``process_assets()`` (which runs
    JS through ``rjsmin`` and would corrupt the JSON — ledger P8). Ordered by the
    already-applied ``sort_order`` so search suggestions surface prioritized
    tools first; admin-disabled tools are already excluded upstream by
    ``apply_tool_overrides()``. The consumer (``nav.js``) lands in Phase 3.
    """
    records = [
        {
            "id": t["id"],
            "name": t["name"],
            # Match build.py's slug convention elsewhere (render/sitemap) so a
            # slug-less YAML tool never KeyErrors the build.
            "slug": t.get("slug", f"/convert/{t['id']}"),
            "input_format": t.get("input_format"),
            "output_format": t.get("output_format"),
            "category": t.get("category"),
            "tagline": t.get("tagline", ""),
            # Per-tool upload cap, already normalised (and admin-overridden) by
            # this point. The account page derives its "Max upload" stat from
            # these rather than hardcoding a number that drifts from the YAML.
            "max_file_size_bytes": t.get("max_file_size_bytes"),
        }
        for t in tools
    ]
    (DIST / "tool-data.json").write_text(json.dumps(records), encoding="utf-8")
    print("  [ok] tool-data.json")


# ---------------------------------------------------------------------------
# Emit dist/images/og/*.png — Open Graph / Twitter share images (P1 §7)
# ---------------------------------------------------------------------------
#
# Rendered at build time via Pillow — no CairoSVG/SVG-rasterizer dependency,
# no network font fetch, no OS font dependency:
# ``ImageFont.load_default(size=...)`` (Pillow >= 10.1) ships an embedded
# scalable font inside the ``pillow`` wheel itself, so this is exactly as
# portable as every other build step (works identically on the ubuntu-latest
# CI runner in deploy.yml and on a contributor's machine, unlike relying on a
# system font that may or may not be installed there). Benchmarked at ~26ms
# per image for the full set (34 tools + 3 categories + home + one shared
# default = 39 renders, ~1s total) — not worth caching further.
#
# One image per tool/category id, one for the homepage, and ONE shared
# ``default.png`` for every other page (privacy, terms, about, contact, 404,
# offline, account) — those get it "for free" via base.html's og_image block
# default, with no per-template edit.

OG_SIZE = (1200, 630)
OG_BG = (24, 24, 27)  # --color-bg (dark-mode value)
OG_BLUE = (37, 99, 235)  # --brand-blue
OG_GREEN = (16, 185, 129)  # --brand-green
OG_WHITE = (255, 255, 255)
OG_MUTED = (161, 161, 170)  # --color-text-muted (dark-mode value)
OG_MARGIN = 80


def _og_font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.load_default(size=size)


def _og_wrap(
    draw: ImageDraw.ImageDraw, text: str, font, max_width: int, max_lines: int
) -> list[str]:
    """Greedy word-wrap into at most `max_lines`; ellipsises the last line if
    `text` still doesn't fit. Always makes progress even on a single
    over-wide word (forces it onto its own line rather than looping)."""
    words = text.split()
    lines: list[str] = []
    current = ""
    i = 0
    while i < len(words) and len(lines) < max_lines:
        candidate = f"{current} {words[i]}".strip()
        if not current or draw.textlength(candidate, font=font) <= max_width:
            current = candidate
            i += 1
        else:
            lines.append(current)
            current = ""
    if current:
        lines.append(current)
    if i < len(words):  # ran out of lines before words
        last = lines[-1] if lines else ""
        while last and draw.textlength(last + "…", font=font) > max_width:
            last = last[:-1].rstrip()
        lines = lines[:-1] + [last + "…"] if lines else ["…"]
    return lines


def _render_og_image(headline: str, subtitle: str) -> bytes:
    """Render one 1200x630 branded PNG for `headline`/`subtitle`."""
    img = Image.new("RGB", OG_SIZE, OG_BG)
    draw = ImageDraw.Draw(img)

    # Logo mark — mirrors the inline SVG in base.html's header.
    draw.rounded_rectangle(
        (OG_MARGIN, 72, OG_MARGIN + 40, 192), radius=10, fill=OG_BLUE
    )
    draw.polygon(
        [(OG_MARGIN + 70, 102), (OG_MARGIN + 110, 132), (OG_MARGIN + 70, 162)],
        fill=OG_WHITE,
    )
    draw.rounded_rectangle(
        (OG_MARGIN + 120, 72, OG_MARGIN + 160, 192), radius=10, fill=OG_GREEN
    )
    draw.text((OG_MARGIN + 178, 105), "FileCast", font=_og_font(46), fill=OG_WHITE)

    headline_font = _og_font(64)
    subtitle_font = _og_font(32)
    max_width = OG_SIZE[0] - 2 * OG_MARGIN

    y = 300
    for line in _og_wrap(draw, headline, headline_font, max_width, max_lines=2):
        draw.text((OG_MARGIN, y), line, font=headline_font, fill=OG_WHITE)
        y += 78

    y += 20
    for line in _og_wrap(draw, subtitle, subtitle_font, max_width, max_lines=1):
        draw.text((OG_MARGIN, y), line, font=subtitle_font, fill=OG_MUTED)

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def generate_og_images(
    tools: list[dict], categories_with_tools: dict, site_config: dict
):
    """Write ``dist/images/og/{home,default,<tool id>,<category id>}.png``.

    Templates reference these by a predictable path built from context they
    already have (tool id / category id) — see base.html's ``og_image`` block
    default and each of home/tool*/category's override — so no build-time
    id-to-path mapping needs to reach Jinja.
    """
    out_dir = DIST / "images" / "og"
    out_dir.mkdir(parents=True, exist_ok=True)

    # ASCII punctuation only in text drawn onto these images: Pillow's bundled
    # default font (see _og_font's docstring) has no glyph for an em-dash,
    # arrow, or bullet — each silently falls back to the SAME "missing glyph"
    # tofu box (verified: all three measure identically wide, unlike every
    # real glyph tried), not an exception, so this would ship broken-looking
    # cards with no build error. Doesn't apply to the *_alt text below, which
    # is real HTML the browser's own font renders.
    (out_dir / "home.png").write_bytes(
        _render_og_image(
            "Free Online File Converter",
            f"{len(tools)} Free Tools - No Sign-up - No Limits",
        )
    )

    for tool in tools:
        headline = f"{tool.get('input_format', '')} to {tool.get('output_format', '')}"
        subtitle = (
            "Free & Secure | FileCast"
            if tool.get("type") == "server-side"
            else "Free, No Upload | FileCast"
        )
        (out_dir / f"{tool['id']}.png").write_bytes(
            _render_og_image(headline, subtitle)
        )

    for cat_id, cat_data in categories_with_tools.items():
        headline = f"{len(cat_data['tools'])} Free {cat_data['name']} Tools"
        (out_dir / f"{cat_id}.png").write_bytes(
            _render_og_image(headline, "No Sign-up - No Limits - filecast.org")
        )

    (out_dir / "default.png").write_bytes(
        _render_og_image(
            site_config.get("site", {}).get("name", "FileCast"),
            "Free, Private File Conversion - No Sign-up Needed",
        )
    )
    print(f"  [ok] {2 + len(tools) + len(categories_with_tools)} og images")


# ---------------------------------------------------------------------------
# Steps 8-12: Process and copy static assets
# ---------------------------------------------------------------------------


def process_assets() -> dict:
    """Copy, minify, hash, and SRI all static assets.

    Returns an asset_map:
        {
            "css/style.css": {"path": "css/style.a1b2c3d4.css", "sri": "sha384-..."},
            "js/shared.js": {"path": "js/shared.e5f6g7h8.js", "sri": "sha384-..."},
            ...
        }
    """
    asset_map = {}

    # --- Fonts (self-hosted Inter, P1 §5) --- must run before CSS: style.css
    # references the placeholder path below, and we rewrite it to the
    # content-hashed output before compressing.
    font_placeholder_map: dict[str, str] = {}
    fonts_src = STATIC_DIR / "fonts"
    if fonts_src.exists():
        for font_file in fonts_src.glob("*.woff2"):
            content_bytes = font_file.read_bytes()
            h = file_hash(content_bytes)
            hashed_name = f"{font_file.stem}.{h}{font_file.suffix}"
            out_path = DIST / "fonts" / hashed_name
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(content_bytes)
            rel_key = f"fonts/{font_file.name}"
            asset_map[rel_key] = {
                "path": f"fonts/{hashed_name}",
                "sri": sri_hash(content_bytes),
            }
            # No SRI attribute exists for @font-face — sri is computed for
            # asset_map consistency only, nothing consumes it for fonts.
            font_placeholder_map[f"/{rel_key}"] = f"/fonts/{hashed_name}"

    # --- CSS ---
    css_src = STATIC_DIR / "css"
    if css_src.exists():
        for css_file in css_src.glob("*.css"):
            raw = css_file.read_text(encoding="utf-8")
            for placeholder, hashed_url in font_placeholder_map.items():
                raw = raw.replace(placeholder, hashed_url)
            minified = csscompressor.compress(raw)
            content_bytes = minified.encode("utf-8")
            h = file_hash(content_bytes)
            hashed_name = f"{css_file.stem}.{h}.css"
            out_path = DIST / "css" / hashed_name
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(content_bytes)
            rel_key = f"css/{css_file.name}"
            asset_map[rel_key] = {
                "path": f"css/{hashed_name}",
                "sri": sri_hash(content_bytes),
            }

    # --- JS (our code) ---
    js_src = STATIC_DIR / "js"
    if js_src.exists():
        for js_file in js_src.rglob("*.js"):
            raw = js_file.read_text(encoding="utf-8")
            minified = rjsmin.jsmin(raw)
            content_bytes = minified.encode("utf-8")
            h = file_hash(content_bytes)
            rel = js_file.relative_to(STATIC_DIR / "js")
            hashed_name = f"{rel.stem}.{h}{rel.suffix}"
            out_rel = Path("js") / rel.parent / hashed_name
            out_path = DIST / out_rel
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(content_bytes)
            rel_key = f"js/{rel.as_posix()}"
            asset_map[rel_key] = {
                "path": out_rel.as_posix(),
                "sri": sri_hash(content_bytes),
            }

    # --- Third-party JS libs (already minified, just hash + SRI) ---
    lib_src = STATIC_DIR / "lib"
    if lib_src.exists():
        for lib_file in lib_src.rglob("*.js"):
            content_bytes = lib_file.read_bytes()
            h = file_hash(content_bytes)
            rel = lib_file.relative_to(STATIC_DIR / "lib")
            hashed_name = f"{rel.stem}.{h}{rel.suffix}"
            out_rel = Path("lib") / rel.parent / hashed_name
            out_path = DIST / out_rel
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(content_bytes)
            rel_key = f"lib/{rel.as_posix()}"
            asset_map[rel_key] = {
                "path": out_rel.as_posix(),
                "sri": sri_hash(content_bytes),
            }

    # --- Images/SVGs ---
    img_src = STATIC_DIR / "images"
    if img_src.exists():
        img_dst = DIST / "images"
        shutil.copytree(img_src, img_dst, dirs_exist_ok=True)

    # --- Favicon to root ---
    favicon_src = ASSETS_DIR / "favicon.svg"
    if favicon_src.exists():
        shutil.copy2(favicon_src, DIST / "favicon.svg")

    # --- Copy logo SVGs to dist/images/ for templates ---
    for logo in ["logo-light.svg", "logo-dark.svg", "icon.svg"]:
        src = ASSETS_DIR / logo
        if src.exists():
            dst = DIST / "images" / logo
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)

    # --- PWA/apple-touch icons (P2 §19) — rendered once from assets/icon.svg,
    # committed as static PNGs (no SVG rasterizer as a build dependency), same
    # pattern as the logo SVGs just above. manifest.json (generate_manifest())
    # references the two PWA sizes by this same /images/ path.
    for icon in ["icon-192.png", "icon-512.png", "apple-touch-icon.png"]:
        src = ASSETS_DIR / icon
        if src.exists():
            dst = DIST / "images" / icon
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)

    return asset_map


# ---------------------------------------------------------------------------
# Step 13: Set up Jinja2 environment
# ---------------------------------------------------------------------------


def create_jinja_env(
    site_config: dict, asset_map: dict, categories_with_tools: dict
) -> jinja2.Environment:
    env = jinja2.Environment(
        loader=jinja2.FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=True,
        undefined=jinja2.StrictUndefined,
    )
    env.filters["format_bytes"] = format_bytes_filter
    env.globals["site"] = site_config.get("site", {})
    env.globals["adsense"] = site_config.get("adsense", {})
    # Precomputed so base.html's loader block and generate_headers()'s CSP branch
    # cannot drift apart — they are the two halves of the §1.1 invariant.
    env.globals["adsense_live"] = adsense_is_live(site_config)
    env.globals["ga4"] = site_config.get("ga4", {})
    env.globals["sentry"] = site_config.get("sentry", {})
    api_config = site_config.get("api", {})
    api_url_override = os.environ.get("API_URL")
    if api_url_override:
        api_config["base_url"] = api_url_override.rstrip("/")
    env.globals["api"] = api_config
    # Cloudflare Web Analytics: a build-time env var, not a DB-backed
    # site_settings flag like ga4/sentry/adsense above — see base.html's
    # comment on the beacon <script> for why (absent in CI/local builds is
    # load-bearing, not incidental). Folded into site_config the same way
    # API_URL is, so generate_headers() (called after this, same site_config
    # object) picks it up too without a second env read.
    site_config["cloudflare_analytics"] = {
        "token": os.environ.get("CLOUDFLARE_BEACON_TOKEN", "")
    }
    env.globals["cloudflare_analytics"] = site_config["cloudflare_analytics"]
    env.globals["assets"] = asset_map
    env.globals["nav_categories"] = categories_with_tools
    # id → display name, so the admin panel can label tool categories exactly as
    # the site does (e.g. developer-tools → "Developer Tools"), not by guessing
    # from the slug. Injected into the admin config island.
    env.globals["category_names"] = {
        cid: cdata.get("name") for cid, cdata in categories_with_tools.items()
    }
    env.globals["build_date"] = date.today().isoformat()
    return env


# ---------------------------------------------------------------------------
# Step 14: Render pages
# ---------------------------------------------------------------------------


def render_page(
    env: jinja2.Environment, template_name: str, out_path: Path, **ctx
) -> bool:
    """Render a template to a file inside dist/. Returns False if template missing."""
    try:
        tmpl = env.get_template(template_name)
    except jinja2.TemplateNotFound:
        print(f"  [skip] Template not found: {template_name}")
        return False
    html = tmpl.render(**ctx)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")
    return True


def render_all_pages(
    env: jinja2.Environment, tools: list[dict], categories_with_tools: dict
):
    # Homepage
    if render_page(
        env,
        "home.html",
        DIST / "index.html",
        categories=categories_with_tools,
        tools=tools,
    ):
        print("  [ok] index.html")

    # Tool pages
    for tool in tools:
        template_name = "tool.html"
        ui = tool.get("ui_type", "standard")
        if ui == "text-input":
            template_name = "tool-text.html"
        elif ui == "multi-file":
            template_name = "tool-multi.html"
        elif ui == "text-diff":
            template_name = "tool-diff.html"

        slug = tool.get("slug", f"/convert/{tool['id']}").strip("/")
        out_path = DIST / slug / "index.html"
        cat_id = tool.get("category", "")
        category = categories_with_tools.get(cat_id, {})
        if render_page(env, template_name, out_path, tool=tool, category=category):
            print(f"  [ok] {slug}/index.html")

    # Category pages
    for _cat_id, cat_data in categories_with_tools.items():
        slug = cat_data["slug"]
        out_path = DIST / slug / "index.html"
        if render_page(env, "category.html", out_path, category=cat_data):
            print(f"  [ok] {slug}/index.html")

    # Privacy page
    if render_page(env, "privacy.html", DIST / "privacy" / "index.html"):
        print("  [ok] privacy/index.html")

    # Terms page
    if render_page(env, "terms.html", DIST / "terms" / "index.html"):
        print("  [ok] terms/index.html")

    # About page
    if render_page(env, "about.html", DIST / "about" / "index.html"):
        print("  [ok] about/index.html")

    # Contact page
    if render_page(env, "contact.html", DIST / "contact" / "index.html"):
        print("  [ok] contact/index.html")

    # 404 page
    if render_page(env, "404.html", DIST / "404.html", tools=tools):
        print("  [ok] 404.html")

    # Offline fallback (P3 §25) — sw.js's navigation handler serves this from
    # cache when a page fails to load with no network and nothing else is
    # cached for that URL.
    if render_page(env, "offline.html", DIST / "offline.html"):
        print("  [ok] offline.html")

    # Admin panel shell (SPA logic is Phase 4). Standalone template; reads only
    # Jinja globals (api/assets/site), so no extra context (StrictUndefined-safe).
    if render_page(env, "admin.html", DIST / "admin" / "index.html"):
        print("  [ok] admin/index.html")

    # Account page shell (JS-populated content is Phase 5). Extends base.html.
    if render_page(env, "account.html", DIST / "account" / "index.html"):
        print("  [ok] account/index.html")


# ---------------------------------------------------------------------------
# Step 15: Generate sitemap.xml
# ---------------------------------------------------------------------------


def _sitemap_page_path(segment: str) -> Path:
    """Map a sitemap URL's path segment (no leading/trailing slash) to the
    rendered file render_all_pages() wrote it to, so its content can be hashed."""
    return DIST / "index.html" if not segment else DIST / segment / "index.html"


# Elements that embed live DB state independent of a page's actual content —
# the homepage trust badge (totals.conversions_display, an exact unbucketed
# count that moves on nearly every build) and a tool page's baked rating tally
# (apply_rating_aggregates, which moves on every vote). Stripped before hashing
# so the sitemap's lastmod signal tracks real content changes, not counter
# churn between deploys. The first pattern is scoped to the "Files Converted"
# badge specifically (via the negative lookahead + literal anchor) — home.html
# has three OTHER static `hero__badge` spans ("N Free Tools", "Sign-up
# optional", "No Limits") that must NOT be stripped, or a real copy edit to one
# of those would leave the hash unchanged and silently suppress lastmod.
_HASH_VOLATILE_PATTERNS = (
    re.compile(
        r'<span class="hero__badge">(?:(?!</span>).)*?Files Converted</span>', re.S
    ),
    re.compile(r'<script type="application/json" id="tool-ratings">.*?</script>', re.S),
)


def _hash_file(path: Path) -> str | None:
    try:
        html = path.read_text(encoding="utf-8")
    except OSError:
        return None
    for pattern in _HASH_VOLATILE_PATTERNS:
        html = pattern.sub("", html)
    return hashlib.sha256(html.encode("utf-8")).hexdigest()


# Sidecar comment sitemap.xml carries per-<url> so the NEXT build's
# _fetch_previous_sitemap() can recover this build's content hash for that URL.
# Ignored by XSD validation (comments aren't elements) — see generate_sitemap().
_SITEMAP_HASH_COMMENT_RE = re.compile(r"<!--\s*hash:([0-9a-f]{64})\s*-->")


@functools.cache
def _fetch_previous_sitemap(base: str) -> str | None:
    """Best-effort GET of the currently-published sitemap.xml.

    dist/ never survives between build.py invocations (clean_dist() wipes it
    every run, and CI starts every deploy from a fresh checkout), so the
    deployed site itself is the only durable record of "what did we last
    publish." Returns None on ANY failure — unreachable, non-200, timeout,
    first-ever deploy — same P10 posture as this file's DB touchpoints; a miss
    just means every URL's lastmod falls back to today (the pre-#25 behavior).

    Cached per (process, base) — ``--watch`` calls build() on every save
    (0.5s poll loop), and without this a live HTTP round-trip would land on
    every single local edit instead of once per dev session.
    """
    try:
        with urllib.request.urlopen(f"{base}/sitemap.xml", timeout=5) as resp:
            if resp.status != 200:
                return None
            return resp.read().decode("utf-8")
    except Exception as e:  # noqa: BLE001 — intentional catch-all (ledger P10)
        print(
            f"  [sitemap] previous sitemap.xml unavailable ({type(e).__name__}); "
            f"lastmod defaults to today for every URL"
        )
        return None


def _parse_previous_lastmods(xml_text: str | None) -> dict:
    if not xml_text:
        return {}
    result = {}
    for block in re.finditer(r"<url>(.*?)</url>", xml_text, re.S):
        b = block.group(1)
        loc_m = re.search(r"<loc>(.*?)</loc>", b)
        lastmod_m = re.search(r"<lastmod>(.*?)</lastmod>", b)
        hash_m = _SITEMAP_HASH_COMMENT_RE.search(b)
        if loc_m and lastmod_m and hash_m:
            result[loc_m.group(1)] = {
                "hash": hash_m.group(1),
                "lastmod": lastmod_m.group(1),
            }
    return result


def generate_sitemap(site_config: dict, tools: list[dict], categories_with_tools: dict):
    base = (
        site_config.get("site", {}).get("base_url", "https://filecast.org").rstrip("/")
    )
    today = date.today().isoformat()
    urls = []

    urls.append(
        {"loc": f"{base}/", "segment": "", "priority": "1.0", "changefreq": "weekly"}
    )

    for tool in tools:
        slug = tool.get("slug", f"/convert/{tool['id']}").strip("/")
        urls.append(
            {
                "loc": f"{base}/{slug}/",
                "segment": slug,
                "priority": "0.8",
                "changefreq": "weekly",
            }
        )

    for cat_data in categories_with_tools.values():
        slug = cat_data["slug"]
        urls.append(
            {
                "loc": f"{base}/{slug}/",
                "segment": slug,
                "priority": "0.6",
                "changefreq": "weekly",
            }
        )

    # (segment, priority, changefreq) — info pages monthly, legal pages yearly
    # (O2 report §13 #25).
    for segment, priority, changefreq in (
        ("privacy", "0.3", "yearly"),
        ("terms", "0.3", "yearly"),
        ("about", "0.4", "monthly"),
        ("contact", "0.3", "monthly"),
    ):
        urls.append(
            {
                "loc": f"{base}/{segment}/",
                "segment": segment,
                "priority": priority,
                "changefreq": changefreq,
            }
        )

    # lastmod only advances when a URL's rendered content actually changed
    # since the last build (not on every build) — compare each page's fresh
    # content hash against the hash the currently-published sitemap.xml carries
    # for that URL (in a comment, alongside its own lastmod). A new URL, one
    # whose rendered file is missing/unreadable, or a miss on the previous
    # sitemap fetch always gets today's date.
    previous = _parse_previous_lastmods(_fetch_previous_sitemap(base))

    lines = ['<?xml version="1.0" encoding="UTF-8"?>']
    lines.append('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    for u in urls:
        content_hash = _hash_file(_sitemap_page_path(u["segment"]))
        prev_entry = previous.get(u["loc"])
        if (
            content_hash is not None
            and prev_entry
            and prev_entry.get("hash") == content_hash
        ):
            lastmod = prev_entry["lastmod"]
        else:
            lastmod = today

        lines.append("  <url>")
        lines.append(f"    <loc>{u['loc']}</loc>")
        lines.append(f"    <lastmod>{lastmod}</lastmod>")
        if content_hash:
            lines.append(f"    <!-- hash:{content_hash} -->")
        lines.append(f"    <changefreq>{u['changefreq']}</changefreq>")
        lines.append(f"    <priority>{u['priority']}</priority>")
        lines.append("  </url>")
    lines.append("</urlset>")

    (DIST / "sitemap.xml").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("  [ok] sitemap.xml")


# ---------------------------------------------------------------------------
# Step 16: Generate robots.txt
# ---------------------------------------------------------------------------


def generate_robots(site_config: dict):
    base = (
        site_config.get("site", {}).get("base_url", "https://filecast.org").rstrip("/")
    )
    # Exclude the admin panel and account pages from crawling (Phase 2). The
    # sitemap already omits them (it only enumerates home/tools/categories/static
    # pages) — do NOT add them there.
    content = (
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /admin/\n"
        "Disallow: /account/\n"
        # Only reachable as sw.js's offline fallback (P3 §25) — never linked
        # to and not in the sitemap; nothing for a crawler to index there.
        "Disallow: /offline.html\n"
        f"\nSitemap: {base}/sitemap.xml\n"
    )
    (DIST / "robots.txt").write_text(content, encoding="utf-8")
    print("  [ok] robots.txt")


# ---------------------------------------------------------------------------
# Step 16b: Generate manifest.json (P2 §19 — PWA basics)
# ---------------------------------------------------------------------------


def generate_manifest(site_config: dict):
    """Write dist/manifest.json. Icons themselves are static PNGs copied to
    dist/images/ by process_assets() (rendered once from assets/icon.svg,
    committed rather than rasterized at build time — no SVG rasterizer is a
    build dependency here, matching favicon.svg/logo-*.svg's existing pattern
    of committed, build-time-copied static assets).
    """
    site = site_config.get("site", {}) or {}
    manifest = {
        "name": f"{site.get('name', 'FileCast')} — {site.get('tagline', '')}".rstrip(
            " —"
        ),
        "short_name": site.get("name", "FileCast"),
        "description": site.get("description", ""),
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        # Matches --brand-blue / the icon's white background (style.css,
        # assets/icon.svg) — not independently themeable via site_settings,
        # same as the other structural/brand fields build.py owns directly.
        "theme_color": "#2563EB",
        "background_color": "#FFFFFF",
        "icons": [
            {"src": "/images/icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "/images/icon-512.png", "sizes": "512x512", "type": "image/png"},
        ],
    }
    (DIST / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    print("  [ok] manifest.json")


# ---------------------------------------------------------------------------
# Step 16c: Generate sw.js (P3 §25 — service worker for offline support)
# ---------------------------------------------------------------------------

# Written directly (not copied verbatim from static/) and unhashed, unlike
# every other JS file process_assets() emits — a service worker's URL must
# stay stable across deploys (the browser re-fetches THIS EXACT URL on every
# navigation to check for a byte-level diff; a content-hashed filename would
# register a brand-new, unrelated worker on every build instead of updating
# the existing one). CACHE_VERSION is the only thing that changes between
# builds, so it's a template substitution rather than a literal in the
# source — bumping it on every build is what makes the old caches actually
# get dropped in `activate` below instead of accumulating forever.
#
# Deliberately runtime-caching, not a build-time precache manifest: baking a
# list of today's content-hashed CSS/JS URLs into the worker would go stale
# the moment the NEXT build ships (those exact filenames stop existing), and
# keeping such a list in sync would mean regenerating and reinstalling the
# worker on every single deploy just to avoid caching one 404. Caching each
# asset/page the first time it's actually requested sidesteps that entirely
# and still delivers what the report actually asked for: local tool pages
# work offline once visited once.
SW_TEMPLATE = """// Auto-generated by build.py's generate_service_worker() — edit there, not
// here; this exact file is overwritten on every build.
'use strict';

var CACHE_VERSION = '__CACHE_VERSION__';
var STATIC_CACHE = 'filecast-static-' + CACHE_VERSION;
var PAGE_CACHE = 'filecast-pages-' + CACHE_VERSION;
var OFFLINE_URL = '/offline.html';

// Cache-first prefixes: every response under these is content-hashed and
// immutable (build.py/process_assets), so there is never a staleness
// question — once cached, it's cached for good under THIS cache name, and
// CACHE_VERSION rotating on the next deploy is what retires it.
var STATIC_PREFIXES = ['/css/', '/js/', '/lib/', '/fonts/', '/images/'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then(function (cache) {
        return cache.addAll(['/', OFFLINE_URL, '/manifest.json']);
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return (
                key.indexOf('filecast-') === 0 &&
                key !== STATIC_CACHE &&
                key !== PAGE_CACHE
              );
            })
            .map(function (key) {
              return caches.delete(key);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

function isStaticAsset(pathname) {
  return STATIC_PREFIXES.some(function (prefix) {
    return pathname.indexOf(prefix) === 0;
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  // Only GET is cacheable; POST (conversions, ratings, auth) must always
  // hit the network untouched.
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  // Never intercept cross-origin requests (api.filecast.org, Sentry's CDN,
  // GTM, AdSense) — those are either not meant to be cached (the API) or
  // are third-party-owned responses this worker has no business storing.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Network-first for pages: a visitor who's online always gets the
    // current page, and every successful navigation opportunistically
    // caches itself so it's available offline next time (report's "cache
    // local tool pages on first visit"). Only on a network failure do we
    // fall back to whatever's cached, then to the generic offline page.
    event.respondWith(
      fetch(request)
        .then(function (response) {
          // Never cache an error response as if it were the real page — a
          // transient 5xx would otherwise get served from cache on every
          // subsequent visit until CACHE_VERSION next rotates.
          if (response.ok) {
            var copy = response.clone();
            // Tied to the worker's lifetime via waitUntil — without this the
            // write is a detached promise the browser is free to abandon the
            // moment respondWith's own promise settles (right after `return
            // response` below), which on a memory-pressured mobile browser
            // can mean the page silently never gets cached at all.
            event.waitUntil(
              caches.open(PAGE_CACHE).then(function (cache) {
                return cache.put(request, copy);
              })
            );
          }
          return response;
        })
        .catch(function () {
          return caches.match(request).then(function (cached) {
            return cached || caches.match(OFFLINE_URL);
          });
        })
    );
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      caches.match(request).then(function (cached) {
        if (cached) return cached;
        return fetch(request).then(function (response) {
          if (response.ok) {
            var copy = response.clone();
            event.waitUntil(
              caches.open(STATIC_CACHE).then(function (cache) {
                return cache.put(request, copy);
              })
            );
          }
          return response;
        });
      })
    );
  }
});
"""


def generate_service_worker(build_id: str):
    """Write dist/sw.js. See SW_TEMPLATE's own comment for why this is
    written directly rather than routed through process_assets() like every
    other JS file."""
    content = SW_TEMPLATE.replace("__CACHE_VERSION__", build_id)
    (DIST / "sw.js").write_text(content, encoding="utf-8")
    print("  [ok] sw.js")


# ---------------------------------------------------------------------------
# Step 17: Generate _headers (Cloudflare Pages)
# ---------------------------------------------------------------------------


def adsense_is_live(site_config: dict) -> bool:
    """True when AdSense is enabled AND configured well enough for at least one
    unit to actually render.

    🔴 This is the SINGLE source of truth for that question, deliberately. The
    CSP branch below and the loader block in ``base.html`` (via the
    ``adsense_live`` Jinja global) must agree on it, or enabling AdSense widens
    the CSP for Google's origins while nothing renders — a real, if small,
    attack-surface increase bought for zero inventory, with nothing erroring or
    warning anywhere. That is the §1.1 failure this phase exists to close, and a
    half-configured overlay (enabled, no publisher or no slot id) is exactly how
    it happens.

    ``ad_slot()`` narrows this further per slot: a slot whose own id is blank
    renders nothing even when the other one does. That is a refinement, not a
    disagreement — it can only ever render fewer units than this predicate
    allows, never more.
    """
    ads = site_config.get("adsense", {}) or {}
    slots = ads.get("slots", {}) or {}
    return bool(
        ads.get("enabled")
        and ads.get("publisher_id")
        and (slots.get("leaderboard") or slots.get("in_content"))
    )


def generate_headers(site_config: dict):
    # Derived from site-config.yaml rather than hardcoded, so a new environment
    # is a config edit rather than a code edit — and so connect-src can never
    # name a different origin from the one the pages actually call. This runs
    # AFTER create_jinja_env(), which is where an API_URL env override is folded
    # into site_config["api"], so the override reaches the CSP too.
    api_url = site_config.get("api", {}).get("base_url", "").rstrip("/")
    # NOT `adsense.enabled` alone — see adsense_is_live()'s docstring. The
    # templates render units only when a publisher id and a slot id are present,
    # so gating the origins on anything weaker opens them with nothing to fill.
    adsense_enabled = adsense_is_live(site_config)
    ga4_enabled = site_config.get("ga4", {}).get("enabled", False)
    sentry_enabled = site_config.get("sentry", {}).get("enabled", False)
    # Not a DB-backed flag like the two above — see create_jinja_env()'s
    # comment on where this token comes from (build-time env var, absent in
    # CI/local builds on purpose).
    cf_analytics_enabled = bool(
        site_config.get("cloudflare_analytics", {}).get("token")
    )

    # script-src is NEVER touched here (ledger P6/P7) — no inline script is added.
    script_src = "'self'"
    # connect-src already allows the API origin (data API shares it, F15). Add the
    # Google OAuth token/authorize hosts for Phase 5. img-src gains Google avatars
    # (Phase 5); style-src/font-src gain Google Fonts for the Inter face (Phase 3).
    connect_src = " ".join(
        # A config with no api.base_url must not emit a stray empty token.
        p
        for p in (
            "'self'",
            api_url,
            "https://accounts.google.com",
            "https://oauth2.googleapis.com",
        )
        if p
    )
    # Inter is self-hosted (P1 §5) — no fonts.googleapis.com/fonts.gstatic.com
    # origin is loaded anymore, so neither belongs here.
    #
    # 'unsafe-inline' dropped from style-src itself (P2 §14 — closes the CSS
    # injection vector: an attacker who can inject markup can no longer smuggle
    # in a <style> block or a static style="" attribute for a selector-based
    # exfiltration trick). Every REMAINING inline style in the codebase is a
    # dynamic one shared*.js/server-upload.js/admin/dashboard.js drive via
    # `element.style.x = …` (progress bar width, an admin stat-bar fill) —
    # ads.js's own show/hide switched to classList and needs no exception —
    # style-src-attr is the CSP3 sub-directive that governs JS-driven style
    # ATTRIBUTE mutations specifically (both `style=""` in markup and the CSSOM
    # `.style` API), separate from style-src's own element/`<style>`-block
    # scope. Granting 'unsafe-inline' there only, instead of on style-src
    # itself, still blocks the actual named vector.
    #
    # ⚠ CAVEAT, not fully verified cross-browser: Chrome and Firefox support
    # style-src-attr; WebKit/Safari (as of this writing) does not and falls
    # back to enforcing style-src for attribute styles too — on Safari this
    # style-src (without 'unsafe-inline') would block the progress-bar/ad-slot/
    # admin-meter style mutations above. No live Safari CSP-violation check has
    # been run against a deploy preview (same caveat class as the AdSense CSP
    # branch below — §7.2). If that turns out to matter in practice, the actual
    # fix is moving the progress bar to a native <progress> element (its `value`
    # attribute isn't a style mutation at all, so no CSP directive applies) —
    # not re-adding 'unsafe-inline' to style-src.
    style_src = "'self'"
    style_src_attr = "'unsafe-inline'"
    font_src = "'self'"
    img_src = "'self' data: blob: https://lh3.googleusercontent.com"
    frame_src = "'none'"

    # ⚠ UNVERIFIED — SPECULATIVE, NOT MEASURED (Phase 9 §3.3, still open).
    #
    # This branch was written in Phase 2 against Google's documentation and has
    # never been exercised against a live ad serve. AdSense is not approved yet,
    # so there is no real publisher id to measure with, and no CI job can do it:
    # it needs a real ad response in a real browser with the CSP ENFORCED.
    #
    # It is very likely INSUFFICIENT. Ads render through frames and images from
    # hosts not listed here (tpc.googlesyndication.com and www.google.com are the
    # usual first two), and img-src/connect-src are untouched entirely. Do NOT
    # add origins on the strength of what the docs imply — an origin allowlisted
    # on a guess is a permanent widening bought with no evidence.
    #
    # Method when approval lands: deploy preview, real publisher id, toggle on,
    # tool page, CSP enforced, drive the console to zero violations adding ONE
    # origin at a time — then replace this comment with one saying it was
    # measured, and on what date. See §7.2 item 1.
    #
    # Hard constraint regardless of what the measurement shows: script-src never
    # gains 'unsafe-inline' and no inline <script> enters a built page. If ads
    # cannot render without inline script, stop and escalate — ads.js and the
    # external loader exist precisely to avoid that trade (P6/P7).
    if adsense_enabled:
        script_src += (
            " https://pagead2.googlesyndication.com https://www.googletagmanager.com"
        )
        frame_src = "https://googleads.g.doubleclick.net"
    if ga4_enabled:
        if "googletagmanager" not in script_src:
            script_src += " https://www.googletagmanager.com"
        connect_src += " https://www.google-analytics.com https://analytics.google.com"
    if sentry_enabled:
        script_src += " https://browser.sentry-cdn.com"
        # Derived from the actual DSN host rather than a hardcoded
        # "*.ingest.sentry.io" guess: Sentry's regional orgs (e.g. data
        # storage in the US) get DSNs on "*.ingest.us.sentry.io", a
        # different suffix a wildcard on the legacy non-regional domain
        # does not match — the browser silently drops every event with no
        # visible error, only a CSP violation in devtools. Matching the
        # real host, whatever region it is, avoids guessing at the pattern.
        sentry_dsn = site_config.get("sentry", {}).get("dsn", "")
        ingest_host = urlparse(sentry_dsn).hostname if sentry_dsn else None
        if ingest_host:
            connect_src += f" https://{ingest_host}"
    if cf_analytics_enabled:
        script_src += " https://static.cloudflareinsights.com"
        # Where the beacon posts RUM data (`/cdn-cgi/rum`).
        connect_src += " https://cloudflareinsights.com"

    csp = (
        f"default-src 'self'; "
        f"script-src {script_src}; "
        f"style-src {style_src}; "
        f"style-src-attr {style_src_attr}; "
        f"font-src {font_src}; "
        f"img-src {img_src}; "
        f"connect-src {connect_src}; "
        f"frame-src {frame_src}; "
        # Explicit rather than relying on the worker-src → script-src →
        # default-src fallback chain (P3 §25's sw.js registration) — CSP3
        # browser support for that fallback isn't universal, and script-src
        # above can grow third-party hosts (Sentry/GTM/AdSense) that have no
        # business being an allowed worker source. 'self' only, always.
        f"worker-src 'self'; "
        # No <base> tag anywhere in the codebase; pins it to 'self' regardless
        # so an injected one can never retarget every relative URL on the page
        # (script/link/form srcs included) to an attacker's origin.
        f"base-uri 'self'; "
        # No <form> tag anywhere in the codebase either (every submission is a
        # fetch/XHR, already governed by connect-src) — 'self' is defense in
        # depth against an injected form, not a grant any real form needs.
        f"form-action 'self'; "
        # Never legitimately loaded (no Flash/Java/etc. anywhere here); the
        # explicit 'none' is cheap insurance against a plugin-based vector.
        f"object-src 'none'"
    )

    lines = [
        "/*",
        f"  Content-Security-Policy: {csp}",
        "  X-Content-Type-Options: nosniff",
        "  X-Frame-Options: DENY",
        "  Referrer-Policy: strict-origin-when-cross-origin",
        # Without this, the first request to either domain can be intercepted
        # over plain HTTP before the redirect fires. `includeSubDomains` is
        # needed for `preload` eligibility; both domains are already HTTPS-only.
        "  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload",
        # A file converter has no reason to touch any of these browser APIs.
        "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()",
        # Cloudflare Pages adds `Access-Control-Allow-Origin: *` to every response
        # by default (undocumented in most places, confirmed on the Pages
        # community forum) — nothing in this codebase ever set it. `!` is Pages'
        # own syntax for detaching a header it would otherwise inject; a normal
        # `Access-Control-Allow-Origin: <value>` line here would just be a second
        # thing overriding the same default, not a removal of it. Static HTML has
        # no reason to be fetchable cross-origin at all; the API's own CORS policy
        # (api/middleware.py, origin-restricted) is unrelated and unaffected.
        "  ! Access-Control-Allow-Origin",
        "",
        "/css/*",
        "  Cache-Control: public, max-age=31536000, immutable",
        "",
        "/js/*",
        "  Cache-Control: public, max-age=31536000, immutable",
        "",
        "/lib/*",
        "  Cache-Control: public, max-age=31536000, immutable",
        "",
        # Self-hosted Inter (P1 §5) — filenames are content-hashed the same way
        # css/js are, so immutable + a 1-year max-age is safe: a font update
        # ships under a new filename, never reuses this one.
        "/fonts/*",
        "  Cache-Control: public, max-age=31536000, immutable",
        "",
        "/images/*",
        "  Cache-Control: public, max-age=86400",
        "",
        # write_tool_data() emits this straight to dist/ unhashed (never through
        # process_assets(), so it can't go `immutable` like css/js/fonts do), but
        # it only changes on deploy — bound staleness to 5 minutes instead of
        # falling through to no explicit Cache-Control at all.
        "/tool-data.json",
        "  Cache-Control: public, max-age=300",
        "",
    ]
    (DIST / "_headers").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("  [ok] _headers")


def generate_redirects(site_config: dict):
    """Write dist/_redirects: www.<domain> -> the apex, plus the old
    /document-tools/ category path -> its renamed /document-conversion/ URL,
    and the old /data-conversion/ category path -> its renamed
    /developer-tools/ URL, all 301, every path.

    Cloudflare Pages reads this file the same way it reads _headers. Both
    filecast.org and www.filecast.org are attached as custom domains on the
    same Pages project and currently serve identical content — this is what
    makes one of them canonical instead of two indexable copies of every page.

    Both category redirects (O2 report §4.1/§13 #11; Build Action Plan Phase 0)
    are literal paths, not derived from site_config["categories"] — that list
    only carries each category's CURRENT slug, which is exactly the thing
    these lines exist to redirect FROM. Each one stops mattering (and can be
    deleted) once its old path has fully dropped out of Google's index and any
    inbound links pointing at it.
    """
    base = (
        site_config.get("site", {}).get("base_url", "https://filecast.org").rstrip("/")
    )
    host = urlparse(base).netloc
    if not host:
        print(f"  [warn] site.base_url {base!r} has no host; skipping the www redirect")
    lines = []
    if host:
        lines.append(f"https://www.{host}/* {base}/:splat 301")
    lines.append("/document-tools/* /document-conversion/:splat 301")
    lines.append("/data-conversion/* /developer-tools/:splat 301")
    (DIST / "_redirects").write_text(
        "\n".join(lines) + ("\n" if lines else ""), encoding="utf-8"
    )
    print("  [ok] _redirects")


# ---------------------------------------------------------------------------
# Step 18: Local preview server
# ---------------------------------------------------------------------------


class CORSHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, format, *args):
        pass


def serve(port: int = 8000):
    os.chdir(DIST)
    handler = CORSHandler
    with http.server.HTTPServer(("", port), handler) as httpd:
        print(f"\nServing dist/ at http://localhost:{port}")
        print("Press Ctrl+C to stop.\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


# ---------------------------------------------------------------------------
# Step 19: Watch mode (file watcher + live reload)
# ---------------------------------------------------------------------------

LIVE_RELOAD_SNIPPET = (
    b"<script>(function(){"
    b"var es=new EventSource('/__reload');"
    b"es.onmessage=function(){location.reload();};"
    b"es.onerror=function(){setTimeout(function(){location.reload();},1000);};"
    b"})()</script>"
)


class LiveReloadHandler(http.server.SimpleHTTPRequestHandler):
    """Serves dist/ files and an SSE endpoint for live reload."""

    _reload_event = None  # set by watch()

    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    def do_GET(self):
        if self.path == "/__reload":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            try:
                while True:
                    self.__class__._reload_event.wait()
                    self.__class__._reload_event.clear()
                    self.wfile.write(b"data: reload\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            return

        # For HTML files, inject the live-reload script before </body>
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            path = os.path.join(path, "index.html")
        if path.endswith(".html") and os.path.isfile(path):
            self._serve_html(path, 200)
            return

        # Check if the file exists for non-HTML requests
        raw_path = self.translate_path(self.path)
        if not os.path.exists(raw_path):
            four04 = os.path.join(os.getcwd(), "404.html")
            if os.path.isfile(four04):
                self._serve_html(four04, 404)
                return

        super().do_GET()

    def _serve_html(self, filepath, status):
        with open(filepath, "rb") as f:
            content = f.read()
        content = content.replace(b"</body>", LIVE_RELOAD_SNIPPET + b"\n</body>")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, format, *args):
        pass


def watch(port: int = 8000):
    """Watch source files for changes, rebuild, and trigger browser reload."""
    import contextlib
    import io
    import threading
    import time

    reload_event = threading.Event()
    LiveReloadHandler._reload_event = reload_event

    watch_dirs = [TEMPLATES_DIR, TOOLS_DIR, STATIC_DIR, ROOT / "content"]
    watch_files = [ROOT / "site-config.yaml"]

    def get_mtimes():
        mtimes = {}
        for d in watch_dirs:
            if d.exists():
                for f in d.rglob("*"):
                    if f.is_file():
                        mtimes[str(f)] = f.stat().st_mtime
        for f in watch_files:
            if f.exists():
                mtimes[str(f)] = f.stat().st_mtime
        return mtimes

    build()

    os.chdir(DIST)
    httpd = http.server.ThreadingHTTPServer(("", port), LiveReloadHandler)
    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()

    print(f"\n🔄 Watching for changes... (http://localhost:{port})")
    print("   Edit templates, CSS, JS, YAML, or content → auto-rebuild + reload")
    print("   Press Ctrl+C to stop.\n")

    prev_mtimes = get_mtimes()

    try:
        while True:
            time.sleep(0.5)
            curr_mtimes = get_mtimes()
            if curr_mtimes != prev_mtimes:
                changed = set(curr_mtimes.keys()) ^ set(prev_mtimes.keys())
                for k in set(curr_mtimes.keys()) & set(prev_mtimes.keys()):
                    if curr_mtimes[k] != prev_mtimes[k]:
                        changed.add(k)
                names = [os.path.basename(c) for c in changed]
                print(f"  [change] {', '.join(names[:5])}")
                prev_mtimes = curr_mtimes
                try:
                    with contextlib.redirect_stdout(io.StringIO()):
                        build()
                    os.chdir(DIST)
                    reload_event.set()
                    print("  [rebuilt] ✓")
                except Exception as e:
                    print(f"  [error] Build failed: {e}")
    except KeyboardInterrupt:
        print("\nStopped.")
        httpd.shutdown()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def build():
    print("FileCast build starting...\n")

    # 1. Clean
    print("[1/11] Cleaning dist/")
    clean_dist()

    # 2. Load config, then overlay the admin Site Settings (graceful fallback to
    # YAML). Merged HERE — before create_jinja_env() and generate_headers() — so
    # the templates and the CSP read one merged dict and never disagree about
    # which integrations are on (P10; all-or-nothing overlay).
    print("[2/11] Loading site-config.yaml")
    site_config = load_site_config()
    site_config = apply_site_settings(site_config, fetch_site_settings())

    # 3-4. Load tools, then overlay DB state (graceful fallback to YAML) and
    # apply the global sort_order upstream of all rendering (P9/D1). Disabled
    # tools are dropped BEFORE resolve_related_tools() so no dangling links remain.
    print("[3/11] Discovering tools")
    tools = load_tools()
    tools = apply_tool_overrides(tools, fetch_tool_overrides())  # may DROP disabled
    tools = sort_tools(tools)
    # Bake the ratings aggregate onto each tool (raw counts only — the threshold
    # is computed client-side). Independent of the overlay read: either can
    # degrade on its own without failing the build (P10).
    tools = apply_rating_aggregates(tools, fetch_rating_aggregates())
    print(f"       Found {len(tools)} tool(s)")

    # 5. Group by category
    print("[4/11] Grouping tools by category")
    categories = site_config.get("categories", [])
    categories_with_tools = group_tools_by_category(tools, categories)
    active_cats = list(categories_with_tools.keys())
    print(f"       Active categories: {active_cats if active_cats else '(none yet)'}")

    # 6. Load content
    print("[5/11] Loading content markdown")
    load_tool_content(tools)
    load_alternatives(tools)

    # 7. Resolve related tools
    print("[6/11] Resolving related tools")
    resolve_related_tools(tools)

    # 8-12. Process assets
    print("[7/11] Processing static assets")
    asset_map = process_assets()
    for key, info in asset_map.items():
        print(f"       {key} → {info['path']}")

    # Emit tool-data.json straight to dist/ (never through process_assets/rjsmin,
    # P8); ordered by sort_order, disabled tools already excluded.
    write_tool_data(tools)

    # Open Graph / Twitter share images (P1 §7) — one per tool/category id,
    # one for the homepage, one shared default for every other page.
    print("[8/11] Generating Open Graph images")
    generate_og_images(tools, categories_with_tools, site_config)

    # 13. Jinja2 environment
    print("[9/11] Setting up Jinja2")
    env = create_jinja_env(site_config, asset_map, categories_with_tools)

    # Footer "Popular Tools" row (O2 report §5.7/§13 #18). Computed from the
    # already-overridden/sorted `tools` list, so a DB-disabled tool among the
    # six is dropped the same way it's dropped everywhere else.
    env.globals["popular_tools"] = select_popular_tools(tools)

    # Site-wide totals for the homepage trust counter. Always defined (so the
    # StrictUndefined template guard is a plain `is not none` check); the
    # thousands-separated display string is formatted here in Python so the
    # template stays dumb (R12).
    conversions_total = fetch_total_conversions()
    env.globals["totals"] = {
        "conversions": conversions_total,
        "conversions_display": (
            f"{conversions_total:,}" if conversions_total is not None else None
        ),
    }

    # 14. Render pages
    print("[10/11] Rendering pages")
    render_all_pages(env, tools, categories_with_tools)

    # 15-19. Generate support files
    print(
        "[11/11] Generating sitemap, robots.txt, manifest.json, sw.js, "
        "_headers, _redirects"
    )
    generate_sitemap(site_config, tools, categories_with_tools)
    generate_robots(site_config)
    generate_manifest(site_config)
    # Second-resolution, not date.today() — CACHE_VERSION must actually change
    # on every build (see generate_service_worker()'s docstring), and two
    # deploys on the same calendar day would otherwise produce byte-identical
    # sw.js, which the browser's update check treats as "nothing changed" and
    # never re-activates.
    generate_service_worker(datetime.now().strftime("%Y-%m-%dT%H-%M-%S"))
    generate_headers(site_config)
    generate_redirects(site_config)

    print(f"\nBuild complete. Output: {DIST}/")


def main():
    parser = argparse.ArgumentParser(description="FileCast static site generator")
    parser.add_argument(
        "--serve", action="store_true", help="Start local preview server after build"
    )
    parser.add_argument(
        "--watch",
        action="store_true",
        help="Watch for changes, auto-rebuild + live reload",
    )
    parser.add_argument(
        "--port", type=int, default=8000, help="Port for preview server (default: 8000)"
    )
    args = parser.parse_args()

    if args.watch:
        watch(args.port)
    else:
        build()
        if args.serve:
            serve(args.port)


if __name__ == "__main__":
    main()
