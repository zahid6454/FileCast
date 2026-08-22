"""Phase 2 build-system tests.

Drives ``build.py`` (repo root) against the shared test Postgres from conftest.
Covers: the DB tool-state overlay, graceful fallback (DB down / empty table),
the global ``sort_order`` applied upstream of render (P9/D1), ``tool-data.json``
(written straight to dist/, excludes disabled tools), the CSP additions
(``script-src`` untouched), robots/sitemap exclusions, and a full-build snapshot
that also exercises StrictUndefined-safe rendering of admin/account.
"""

import json
import re
import sys
from datetime import date
from pathlib import Path

import pytest

# build.py lives at the repo root (api/tests/test_build.py → parents[2]).
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data.db import sync_session  # noqa: E402
from data.models import Conversion, Rating, SiteSetting, Tool  # noqa: E402

import build  # noqa: E402

# conftest sets DATABASE_URL → the test DB before importing data.*, so build.py's
# lazy ``from data.db import sync_session`` binds to the same test engine.

# Captured before the autouse fixture below ever patches build._fetch_previous_
# sitemap, so the one test that exercises the REAL function (its own
# graceful-degrade behavior) can still reach it.
_REAL_FETCH_PREVIOUS_SITEMAP = build._fetch_previous_sitemap


@pytest.fixture(autouse=True)
def _no_live_sitemap_fetch(monkeypatch):
    """generate_sitemap() best-effort GETs the currently-published sitemap.xml
    to diff lastmod against (O2 report §13 #25) — without this, every build.py
    call in this file would fire a real HTTP request at the live site. Default
    to "unreachable" (matches a fresh/offline environment, i.e. every URL gets
    today's date); tests exercising the lastmod-comparison logic itself
    override this per-test with a canned previous sitemap.xml.
    """
    monkeypatch.setattr(build, "_fetch_previous_sitemap", lambda base: None)


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
# fetch_site_settings — DB read + graceful fallback + all-or-nothing (P10)
# --------------------------------------------------------------------------- #


def _seed_site_settings(**kw) -> None:
    base = dict(
        id=1,
        site_name="Custom Name",
        site_tagline="Custom Tagline",
        site_description="Custom description.",
        adsense_enabled=False,
        ga4_enabled=False,
        sentry_enabled=False,
    )
    base.update(kw)
    with sync_session() as s:
        s.add(SiteSetting(**base))


def test_fetch_site_settings_reads_db():
    _seed_site_settings(
        ga4_enabled=True,
        ga4_measurement_id="G-ABCD1234",
        adsense_slot_leaderboard="1234567890",
    )
    ov = build.fetch_site_settings()
    assert ov["site"]["name"] == "Custom Name"
    assert ov["site"]["tagline"] == "Custom Tagline"
    assert ov["ga4"] == {"enabled": True, "measurement_id": "G-ABCD1234"}
    assert ov["adsense"]["slots"]["leaderboard"] == "1234567890"
    # nullable fields coalesce to "" so they match the YAML string convention.
    assert ov["adsense"]["publisher_id"] == ""
    assert ov["sentry"] == {"enabled": False, "dsn": ""}


def test_fetch_site_settings_no_row_returns_empty():
    # No singleton row degrades to {} (pure-YAML path), never a crash.
    assert build.fetch_site_settings() == {}


def test_fetch_site_settings_graceful_when_db_down(monkeypatch):
    import data.db as ddb

    def boom():
        raise RuntimeError("connection refused")

    monkeypatch.setattr(ddb, "sync_session", boom)
    # Must swallow the failure and degrade to YAML-only (P10/R4), not raise.
    assert build.fetch_site_settings() == {}


def test_apply_site_settings_empty_overlay_is_noop():
    cfg = {"site": {"name": "FileCast", "base_url": "https://filecast.org"}}
    out = build.apply_site_settings(cfg, {})
    assert out == {"site": {"name": "FileCast", "base_url": "https://filecast.org"}}


def test_apply_site_settings_preserves_structural_fields():
    # The overlay carries only display/integration keys; base_url and the unused
    # footer slot are YAML-only and must survive the merge.
    cfg = {
        "site": {"name": "FileCast", "base_url": "https://filecast.org"},
        "adsense": {"enabled": False, "slots": {"in_content": "", "footer": ""}},
    }
    overlay = build.apply_site_settings(
        cfg,
        {
            "site": {"name": "Renamed"},
            "adsense": {"enabled": True, "slots": {"in_content": "999"}},
        },
    )
    assert overlay["site"]["name"] == "Renamed"
    assert overlay["site"]["base_url"] == "https://filecast.org"  # preserved
    assert overlay["adsense"]["enabled"] is True
    assert overlay["adsense"]["slots"]["in_content"] == "999"
    assert overlay["adsense"]["slots"]["footer"] == ""  # structural, preserved


def test_site_settings_merge_is_all_or_nothing(monkeypatch):
    # A failed read yields {} → the merge is a no-op → pure YAML. Never a subset
    # of the overlay's keys.
    import data.db as ddb

    monkeypatch.setattr(
        ddb, "sync_session", lambda: (_ for _ in ()).throw(RuntimeError("boom"))
    )
    cfg = {"site": {"name": "FileCast"}, "ga4": {"enabled": False}}
    out = build.apply_site_settings(dict(cfg), build.fetch_site_settings())
    assert out == cfg  # whole, not half


def _csp_from_build(built) -> str:
    line = next(
        ln
        for ln in (built / "_headers").read_text(encoding="utf-8").splitlines()
        if "Content-Security-Policy" in ln
    )
    return line


def test_full_build_no_db_emits_all_off(tmp_path, monkeypatch):
    # No site_settings row (the CI-with-no-data posture) ⇒ all integrations off:
    # script-src stays at its wasm-only baseline (see build.py's
    # generate_headers()) and no gtag/adsense host leaks in.
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    csp = _csp_from_build(tmp_path)
    assert "script-src 'self' 'wasm-unsafe-eval';" in csp
    assert "googletagmanager" not in csp
    assert "googlesyndication" not in csp
    home = (tmp_path / "index.html").read_text(encoding="utf-8")
    assert "FileCast" in home  # YAML-seeded copy renders


def test_full_build_no_cloudflare_token_omits_beacon(tmp_path, monkeypatch):
    # The default/CI/local-build posture (no CLOUDFLARE_BEACON_TOKEN env var):
    # no beacon anywhere in the output. Load-bearing, not incidental — the
    # beacon's CORS response only allows the real filecast.org origin, so
    # firing it against a test server (e.g. Playwright's 127.0.0.1) throws a
    # console error several e2e specs assert against (zero console errors).
    monkeypatch.setattr(build, "DIST", tmp_path)
    monkeypatch.delenv("CLOUDFLARE_BEACON_TOKEN", raising=False)
    build.build()
    home = (tmp_path / "index.html").read_text(encoding="utf-8")
    assert "cloudflareinsights" not in home
    assert "cloudflareinsights" not in _csp_from_build(tmp_path)


def test_full_build_cloudflare_token_renders_beacon(tmp_path, monkeypatch):
    # Regression coverage for the actual bug this integration exists to fix:
    # the previous mechanism (Cloudflare's automatic edge injection) silently
    # stopped reaching real visitors, with nothing catching it except a
    # manual curl. Asserts the built HTML actually contains the beacon
    # script and token, not just that the CSP would allow it if it existed.
    monkeypatch.setattr(build, "DIST", tmp_path)
    monkeypatch.setenv("CLOUDFLARE_BEACON_TOKEN", "test-token-123")
    build.build()
    home = (tmp_path / "index.html").read_text(encoding="utf-8")
    assert "static.cloudflareinsights.com/beacon.min.js" in home
    assert "test-token-123" in home
    csp = _csp_from_build(tmp_path)
    assert "https://static.cloudflareinsights.com" in csp
    assert "https://cloudflareinsights.com" in csp


def test_headers_api_origin_follows_site_config(tmp_path, monkeypatch):
    # §5 item 5: connect-src derives the API origin from site_config instead of
    # a hardcoded literal, so a new environment is a config edit — and so the
    # CSP can never name a different origin from the one the pages call.
    # generate_headers() runs after create_jinja_env(), which folds the API_URL
    # override into site_config, so the override reaches the CSP too.
    monkeypatch.setattr(build, "DIST", tmp_path)
    monkeypatch.setenv("API_URL", "https://api.staging.example/")
    build.build()
    csp = _csp_from_build(tmp_path)
    assert "connect-src 'self' https://api.staging.example " in csp
    assert "api.filecast.org" not in csp
    # The pages must agree with the header — that is the whole point.
    home = (tmp_path / "index.html").read_text(encoding="utf-8")
    assert "https://api.staging.example" in home


def test_full_build_overlay_bakes_ga4(tmp_path, monkeypatch):
    # An all-off YAML + a DB row enabling GA4 ⇒ the CSP gains the GTM host and the
    # gtag URL is baked. Proves the overlay reaches BOTH the CSP and templates.
    _seed_site_settings(ga4_enabled=True, ga4_measurement_id="G-TESTBUILD")
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    csp = _csp_from_build(tmp_path)
    assert "https://www.googletagmanager.com" in csp
    home = (tmp_path / "index.html").read_text(encoding="utf-8")
    assert "G-TESTBUILD" in home
    # gtag.js must never be an eager <script src> — only consent.js may request
    # it, and only once a visitor has consented (see the consent-gate tests).
    assert '<script async src="https://www.googletagmanager.com/gtag/js' not in home


def test_full_build_overlay_bakes_sentry_with_pinned_cdn_version(tmp_path, monkeypatch):
    # Sentry's CDN 403s on floating major-version aliases ("8.x"/"9.x"/"latest")
    # — verified live, an exact version like the one baked in base.html 200s
    # while those aliases don't. The failure mode is silent (script tag just
    # never loads, no console error naming CSP or config), so this asserts the
    # baked tag names a real dotted version, not a bare-major alias, to catch a
    # regression back to a floating tag before it ships.
    _seed_site_settings(
        sentry_enabled=True,
        sentry_dsn="https://abc123@o4511862654894081.ingest.us.sentry.io/456",
    )
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    home = (tmp_path / "index.html").read_text(encoding="utf-8")
    assert re.search(r"browser\.sentry-cdn\.com/\d+\.\d+\.\d+/bundle\.min\.js", home)
    assert "sentry-cdn.com/8.x/" not in home
    assert "sentry-cdn.com/9.x/" not in home
    assert "sentry-cdn.com/latest/" not in home
    # P2 §15 — SRI on the pinned Sentry bundle (only self-hosted assets carried
    # `integrity` before this; the exact-version pin above is what makes a
    # stable hash possible for a third-party script at all).
    sentry_tag = re.search(r'<script src="https://browser\.sentry-cdn\.com[^>]*>', home)
    assert sentry_tag and 'integrity="sha384-' in sentry_tag.group(0)


def test_sentry_and_analytics_load_via_defer_in_document_order(tmp_path, monkeypatch):
    # P1 §6, entangled with P3 §26 — `defer` (not `async`) on BOTH tags is
    # load-bearing, not a style choice. analytics.js's `Sentry.init()` call is
    # guarded (`window.Sentry && typeof window.Sentry.init === 'function'`)
    # and no-ops silently if the SDK isn't ready yet — the exact failure mode
    # PR #32 spent real debugging time diagnosing. `defer` scripts run in
    # DOCUMENT ORDER after parsing regardless of download speed; `async`
    # scripts run in download-finish order. Verified empirically (outside this
    # suite, via Playwright against artificially-delayed responses) that
    # `async` on both tags lets the small, same-origin analytics.js execute
    # BEFORE Sentry's third-party bundle finishes loading — this test pins the
    # static contract (defer, not async, in document order) so a future
    # "simplification" back to async is caught here instead of live in
    # production with zero error output.
    _seed_site_settings(
        ga4_enabled=True,
        ga4_measurement_id="G-TESTBUILD",
        sentry_enabled=True,
        sentry_dsn="https://abc123@o4511862654894081.ingest.us.sentry.io/456",
    )
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    home = (tmp_path / "index.html").read_text(encoding="utf-8")

    sentry_tag = re.search(
        r'<script src="https://browser\.sentry-cdn\.com[^>]*></script>', home
    )
    analytics_tag = re.search(r'<script src="/js/analytics\.[^>]*></script>', home)
    assert sentry_tag, home
    assert analytics_tag, home

    for tag, label in ((sentry_tag, "sentry"), (analytics_tag, "analytics.js")):
        assert re.search(
            r"\bdefer\b", tag.group(0)
        ), f"{label} tag missing defer: {tag.group(0)}"
        assert not re.search(
            r"\basync\b", tag.group(0)
        ), f"{label} tag must not be async: {tag.group(0)}"

    # defer preserves document order — the SDK tag must appear first, or the
    # guard in analytics.js has nothing to depend on.
    assert sentry_tag.start() < analytics_tag.start()
    # Both data attributes land on the SAME (analytics.js) tag, confirming this
    # isn't accidentally matching some other script.
    assert 'data-ga4-id="G-TESTBUILD"' in analytics_tag.group(0)
    assert "data-sentry-dsn=" in analytics_tag.group(0)


def test_full_build_all_off_row_keeps_script_src(tmp_path, monkeypatch):
    # §3.6: with the overlay row PRESENT but all integrations off, the CSP must be
    # untouched — script-src stays at its wasm-only baseline, no vendor host
    # leaks in. This is the launch posture (a seeded but unconfigured site),
    # distinct from no-row.
    _seed_site_settings(site_name="Present But Off")
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    csp = _csp_from_build(tmp_path)
    assert "script-src 'self' 'wasm-unsafe-eval';" in csp
    assert "googletagmanager" not in csp
    assert "googlesyndication" not in csp
    assert "sentry-cdn" not in csp


def test_full_build_overlay_bakes_site_copy(tmp_path, monkeypatch):
    # The three copy fields overlay the site: block and reach the templates with
    # NO template change — tagline lands in <title>, description in <meta>.
    _seed_site_settings(
        site_name="Overlaid Name",
        site_tagline="Overlaid Tagline",
        site_description="Overlaid description text.",
    )
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    home = (tmp_path / "index.html").read_text(encoding="utf-8")
    assert "<title>Overlaid Name — Overlaid Tagline</title>" in home
    assert "Overlaid description text." in home


def test_full_build_site_name_html_is_escaped(tmp_path, monkeypatch):
    # Injection guard, defence in depth: even though site_name is admin-only and
    # length-capped, a value containing markup must render escaped (Jinja
    # autoescape), never as a live tag that breaks out of the JSON-LD <script>.
    _seed_site_settings(site_name="</script><script>alert(1)</script>")
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    home = (tmp_path / "index.html").read_text(encoding="utf-8")
    assert "<script>alert(1)</script>" not in home  # no live injected tag
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in home  # escaped instead


# --------------------------------------------------------------------------- #
# Ad slots — one page per ui_type (Phase 9 §2.1)
#
# The all-off build tests above assert only on the CSP and index.html and never
# open a tool page, which is exactly how the §1.2 defect shipped: `tool.html`
# guarded its slots and the other two templates did not, so 11 of 34 tool pages
# rendered two permanently blank ~90px reservations with AdSense OFF. These
# assert on a built page of EACH ui_type so divergence between the three
# templates fails a test instead of shipping silently.
# --------------------------------------------------------------------------- #

# ui_type → a concrete built tool page. Keep one entry per template.
TOOL_PAGES = {
    "standard": "convert/pdf-to-jpg",  # tool.html
    "text-input": "convert/csv-to-json",  # tool-text.html
    "multi-file": "convert/pdf-merge",  # tool-multi.html
}


def _tool_page(built, slug: str) -> str:
    return (built / slug / "index.html").read_text(encoding="utf-8")


def test_full_build_all_off_row_renders_no_ad_slots(tmp_path, monkeypatch):
    # §2: with the overlay row present and AdSense off, NO tool page of ANY
    # ui_type may ship a reserved `.ad-slot` box. Asserting on all three
    # templates is the point — testing only the 23 `standard` tools is what
    # left the other 11 unverified.
    _seed_site_settings(site_name="Present But Off")
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    for ui_type, slug in TOOL_PAGES.items():
        html = _tool_page(tmp_path, slug)
        assert 'class="ad-slot' not in html, f"{ui_type} ({slug}) ships a blank ad slot"


def test_full_build_no_db_renders_no_ad_slots(tmp_path, monkeypatch):
    # Same invariant on the no-row (pure-YAML) path, where `adsense.enabled`
    # comes from site-config.yaml rather than the overlay.
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    for ui_type, slug in TOOL_PAGES.items():
        html = _tool_page(tmp_path, slug)
        assert 'class="ad-slot' not in html, f"{ui_type} ({slug}) ships a blank ad slot"


def test_full_build_all_off_row_renders_no_adsense(tmp_path, monkeypatch):
    # §3.4: off means off end-to-end — no unit markup, no vendor loader, and a
    # script-src at its wasm-only baseline.
    _seed_site_settings(site_name="Present But Off")
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    assert "script-src 'self' 'wasm-unsafe-eval';" in _csp_from_build(tmp_path)
    for slug in TOOL_PAGES.values():
        html = _tool_page(tmp_path, slug)
        assert "adsbygoogle" not in html
        assert "googlesyndication" not in html


# A publisher id / slot ids matching the validation in site_settings.py
# (^ca-pub-\d{16}$ and ^\d+$). Anything outside those shapes is rejected by the
# API, so the templates only ever see values of this form.
_PUB = "ca-pub-1234567890123456"
ADS_ON = dict(
    adsense_enabled=True,
    adsense_publisher_id=_PUB,
    adsense_slot_leaderboard="1111111111",
    adsense_slot_in_content="2222222222",
)


def test_full_build_ads_on_renders_units_on_all_three_templates(tmp_path, monkeypatch):
    # §3.4, the ads-ON surface. This belongs in pytest and NOT in Playwright:
    # the `test` job has Postgres, so a seeded overlay is real here, whereas the
    # js-test dist has no database and is permanently ads-off — an ads-on
    # Playwright assertion would pass vacuously (§1.4).
    #
    # Asserted on one page of EACH ui_type, per §8: covering only the 23
    # `standard` tools is exactly how the §1.2 defect stayed invisible, and it
    # would recur in the opposite direction (units on tool.html only).
    _seed_site_settings(**ADS_ON)
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()

    for ui_type, slug in TOOL_PAGES.items():
        html = _tool_page(tmp_path, slug)
        ctx = f"{ui_type} ({slug})"
        assert html.count('class="adsbygoogle"') == 2, ctx
        assert html.count('data-ad-client="ca-pub-1234567890123456"') == 2, ctx
        assert 'data-ad-slot="1111111111"' in html, ctx
        assert 'data-ad-slot="2222222222"' in html, ctx
        # §4.1: the modifier classes the scoped min-heights key off. Without
        # them a 280px rectangle renders in a 90px reservation.
        assert 'class="ad-slot ad-slot--leaderboard"' in html, ctx
        assert 'class="ad-slot ad-slot--in-content"' in html, ctx
        # The vendor loader + the self-hosted pusher, both external (P6/P7).
        assert "pagead2.googlesyndication.com/pagead/js/adsbygoogle.js" in html, ctx
        # §8: ads.js MUST be deferred. Non-deferred it runs before the <ins>
        # elements exist, finds zero units and silently pushes nothing — no
        # error, no ads. SRI'd and crossorigin like every other module here.
        loader = re.search(r"<script src=\"/js/ads\.[0-9a-f]+\.js\"[^>]*>", html)
        assert loader, ctx
        assert " defer" in loader.group(0), loader.group(0)
        assert "integrity=" in loader.group(0), loader.group(0)

    csp = _csp_from_build(tmp_path)
    assert "https://pagead2.googlesyndication.com" in csp
    assert "frame-src https://googleads.g.doubleclick.net" in csp
    # The whole point of ads.js: enabling ads must never buy inline script.
    assert "'unsafe-inline'" not in csp.split("script-src")[1].split(";")[0]


def test_full_build_ads_on_leaves_adless_pages_alone(tmp_path, monkeypatch):
    # All six slots live in the three tool templates. The homepage and static
    # pages carry no inventory, so they must not contact Google's ad server
    # either — §7.2 item 1's "confirm no leakage", pinned in CI.
    _seed_site_settings(**ADS_ON)
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    for page in ("index.html", "about/index.html", "privacy/index.html"):
        html = (tmp_path / page).read_text(encoding="utf-8")
        assert "adsbygoogle" not in html, page


def test_adsense_is_live_requires_enabled_publisher_and_a_slot():
    # The single predicate both the CSP branch and base.html's loader read.
    def cfg(**kw):
        base = {"enabled": True, "publisher_id": "ca-pub-1", "slots": {}}
        slots = kw.pop("slots", {"leaderboard": "1"})
        base.update(kw)
        base["slots"] = slots
        return {"adsense": base}

    assert build.adsense_is_live(cfg()) is True
    assert build.adsense_is_live(cfg(slots={"in_content": "2"})) is True
    assert build.adsense_is_live(cfg(enabled=False)) is False
    assert build.adsense_is_live(cfg(publisher_id="")) is False
    assert build.adsense_is_live(cfg(slots={})) is False
    assert (
        build.adsense_is_live(cfg(slots={"leaderboard": "", "in_content": ""})) is False
    )
    # Structurally absent config must not raise.
    assert build.adsense_is_live({}) is False
    assert build.adsense_is_live({"adsense": None}) is False
    assert build.adsense_is_live({"adsense": {"enabled": True, "slots": None}}) is False


@pytest.mark.parametrize(
    "adsense",
    [
        None,
        {},
        {"enabled": True, "publisher_id": "ca-pub-1", "slots": None},
        {"enabled": True, "publisher_id": "ca-pub-1"},
        {"enabled": True, "publisher_id": None, "slots": {"leaderboard": "1"}},
    ],
    ids=["adsense-none", "empty", "slots-none", "slots-absent", "publisher-none"],
)
def test_ad_slot_macro_tolerates_what_the_predicate_tolerates(adsense):
    # ad_slot() is called UNCONDITIONALLY from all three tool templates — the
    # guard is inside it — so any shape it cannot render must yield "" rather
    # than crash the build. adsense_is_live() returns False for all of these, so
    # the macro disagreeing with it is a build failure on a config the rest of
    # the system deliberately tolerates, and with ads OFF at that.
    #
    # `.get(k, default)` covers an ABSENT key, not a present-but-None value, and
    # `adsense:` / `slots:` with no children is valid YAML that parses to None.
    import jinja2

    env = jinja2.Environment(
        loader=jinja2.FileSystemLoader(str(build.TEMPLATES_DIR)),
        autoescape=True,
        undefined=jinja2.StrictUndefined,
    )
    tpl = env.from_string(
        "{% from '_macros.html' import ad_slot %}{{ ad_slot(ads, 'leaderboard') }}"
    )
    assert build.adsense_is_live({"adsense": adsense}) is False
    assert tpl.render(ads=adsense).strip() == ""


def test_half_configured_adsense_does_not_widen_the_csp(tmp_path, monkeypatch):
    # 🔴 §8: "enabling AdSense must not widen the CSP without rendering ads."
    # The template guard needs a publisher id AND a slot id; if the CSP branch
    # asked only for `enabled`, this overlay would open Google's origins for
    # inventory that never appears — an attack-surface increase bought for
    # nothing, with no error anywhere. The two conditions must agree.
    _seed_site_settings(
        adsense_enabled=True,
        adsense_publisher_id="ca-pub-1234567890123456",
    )
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    csp = _csp_from_build(tmp_path)
    assert "script-src 'self' 'wasm-unsafe-eval';" in csp
    assert "googlesyndication" not in csp
    assert "frame-src 'none'" in csp


@pytest.mark.parametrize(
    ("overlay", "expect_ads"),
    [
        ({}, False),  # all off
        ({"adsense_enabled": True}, False),  # toggle only
        ({"adsense_enabled": True, "adsense_publisher_id": _PUB}, False),  # no slot
        ({"adsense_slot_leaderboard": "1111111111"}, False),  # slot, not enabled
        ({"adsense_publisher_id": _PUB, "adsense_slot_leaderboard": "1"}, False),
        (ADS_ON, True),  # fully configured
    ],
)
def test_csp_ad_origins_appear_exactly_when_units_do(
    tmp_path, monkeypatch, overlay, expect_ads
):
    # The §8 invariant stated as an EQUIVALENCE rather than a one-way check:
    # across every overlay shape, ad origins are in the CSP if and only if a
    # built tool page actually carries units. Either direction is a bug — a CSP
    # opened for nothing (§1.1), or units whose origins are blocked.
    _seed_site_settings(**overlay)
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    has_origins = "googlesyndication" in _csp_from_build(tmp_path)
    has_units = "adsbygoogle" in _tool_page(tmp_path, TOOL_PAGES["standard"])
    assert has_origins == has_units, overlay
    assert has_units is expect_ads, overlay


def test_full_build_half_configured_adsense_renders_nothing(tmp_path, monkeypatch):
    # §8: enabled with a publisher id but no slot ids must render ZERO units —
    # an <ins data-ad-slot=""> fails opaquely at Google's end, with nothing in
    # the build or the page to say so.
    _seed_site_settings(
        adsense_enabled=True,
        adsense_publisher_id="ca-pub-1234567890123456",
    )
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    for ui_type, slug in TOOL_PAGES.items():
        html = _tool_page(tmp_path, slug)
        assert "adsbygoogle" not in html, f"{ui_type} ({slug})"
        assert 'class="ad-slot' not in html, f"{ui_type} ({slug})"


def test_full_build_one_slot_configured_renders_only_that_slot(tmp_path, monkeypatch):
    # The guard is per-slot, not per-page: a leaderboard id with no in-content
    # id yields exactly one unit, not two and not zero.
    _seed_site_settings(
        adsense_enabled=True,
        adsense_publisher_id="ca-pub-1234567890123456",
        adsense_slot_leaderboard="1111111111",
    )
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    for ui_type, slug in TOOL_PAGES.items():
        html = _tool_page(tmp_path, slug)
        assert html.count('class="adsbygoogle"') == 1, f"{ui_type} ({slug})"
        assert "ad-slot--leaderboard" in html
        assert "ad-slot--in-content" not in html


def test_built_css_reserves_each_slot_at_its_own_height(tmp_path, monkeypatch):
    # §4.1. Both units shared one 90px reservation, so the in-content rectangle
    # (280px) would shift the page ~190px on fill. Asserted on the BUILT sheet
    # on purpose: only static/css/style.css reaches dist, so a rule added to some
    # other stylesheet produces a clean diff, a green build and no behaviour
    # change (§8). Not hypothetical — a dead pre-Phase-3 `assets/style.css`
    # carrying a near-identical rule shadowed this one in greps until §5 deleted
    # it.
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    sheets = list((tmp_path / "css").glob("style.*.css"))
    assert len(sheets) == 1, sheets
    # process_assets() minifies, so match the minified form.
    css = sheets[0].read_text(encoding="utf-8")
    assert ".ad-slot--leaderboard{min-height:var(--ad-leaderboard-h)}" in css
    assert ".ad-slot--in-content{min-height:var(--ad-rectangle-h)}" in css
    # The base rule must carry no height of its own, or the leaderboard value
    # wins for both and the rectangle is back to under-reserving.
    base = re.search(r"\.ad-slot\{([^}]*)\}", css)
    assert base and "min-height" not in base.group(1), base


def test_full_build_no_inline_script_anywhere(tmp_path, monkeypatch):
    # P6/P7, with ads ON — the posture that most tempts an inline snippet, since
    # Google's documented per-unit push IS inline. A single inline unit push
    # would silently defeat `script-src 'self'` for the whole site.
    #
    # `<script type="application/json">` islands are data, not executable, and
    # are explicitly the CSP-safe pattern this codebase uses (#tool-config,
    # #filecast-config); JSON-LD likewise. Everything else must carry a src.
    _seed_site_settings(**ADS_ON)
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()

    offenders = []
    for path in tmp_path.rglob("*.html"):
        for tag in re.findall(r"<script\b[^>]*>", path.read_text(encoding="utf-8")):
            if " src=" in tag:
                continue
            if 'type="application/json"' in tag or 'type="application/ld+json"' in tag:
                continue
            offenders.append(f"{path.relative_to(tmp_path)}: {tag}")
    assert not offenders, "inline <script> in built pages:\n" + "\n".join(offenders)


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
        "max_file_size_bytes",
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
    # no adsense/ga4/sentry; api.base_url is where connect-src's API origin now
    # comes from (§5 item 5) instead of a literal in generate_headers().
    build.generate_headers({"api": {"base_url": "https://api.filecast.org"}})
    csp = _csp_line(tmp_path)
    # Inter is self-hosted (P1 §5) — Google Fonts is no longer an allowed
    # style-src/font-src origin.
    assert "font-src 'self'" in csp
    assert "fonts.gstatic.com" not in csp
    assert "fonts.googleapis.com" not in csp
    assert "https://lh3.googleusercontent.com" in csp  # img-src
    assert "https://accounts.google.com" in csp  # connect-src OAuth
    assert "https://oauth2.googleapis.com" in csp
    assert "https://api.filecast.org" in csp  # from site_config


def test_generate_headers_cloudflare_analytics_token_widens_csp(tmp_path, monkeypatch):
    # Both origins are required or the beacon is silently CSP-blocked — the
    # exact failure mode this integration replaced (Cloudflare's own
    # automatic injection was already failing silently, no error anywhere).
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_headers(
        {
            "api": {"base_url": "https://api.filecast.org"},
            "cloudflare_analytics": {"token": "abc123"},
        }
    )
    csp = _csp_line(tmp_path)
    assert (
        "https://static.cloudflareinsights.com"
        in csp.split("script-src")[1].split(";")[0]
    )
    assert "https://cloudflareinsights.com" in csp.split("connect-src")[1].split(";")[0]


def test_generate_headers_cloudflare_analytics_absent_by_default(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_headers({"api": {"base_url": "https://api.filecast.org"}})
    assert "cloudflareinsights" not in _csp_line(tmp_path)


def test_generate_headers_permissions_policy_and_cors(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_headers({"api": {"base_url": "https://api.filecast.org"}})
    text = (tmp_path / "_headers").read_text(encoding="utf-8")
    assert (
        "Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()"
        in text
    )
    # P1 §8 — Cloudflare Pages injects `Access-Control-Allow-Origin: *` on
    # every response by default; `!` is Pages' syntax to detach a header it
    # would otherwise add. Nothing in this codebase should set the header
    # directly (that would just be a second thing to keep in sync).
    assert "! Access-Control-Allow-Origin" in text
    assert re.search(r"^  Access-Control-Allow-Origin:", text, re.MULTILINE) is None


def test_generate_headers_fonts_cache_rule(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_headers({"api": {"base_url": "https://api.filecast.org"}})
    text = (tmp_path / "_headers").read_text(encoding="utf-8")
    assert "/fonts/*" in text
    fonts_block = text.split("/fonts/*")[1].split("\n\n")[0]
    assert "Cache-Control: public, max-age=31536000, immutable" in fonts_block


def test_process_assets_hashes_font_and_rewrites_css(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "DIST", tmp_path)
    asset_map = build.process_assets()
    font_entry = asset_map.get("fonts/inter-latin.woff2")
    assert font_entry is not None
    assert re.match(r"fonts/inter-latin\.[0-9a-f]{8}\.woff2", font_entry["path"])
    hashed_font_file = tmp_path / font_entry["path"]
    assert hashed_font_file.exists()
    css_entry = asset_map["css/style.css"]
    css_text = (tmp_path / css_entry["path"]).read_text(encoding="utf-8")
    assert "/fonts/inter-latin.woff2" not in css_text  # placeholder must be rewritten
    assert font_entry["path"] in css_text


def test_generate_headers_without_api_base_url_emits_no_empty_token(
    tmp_path, monkeypatch
):
    # A config with no api section must not leave a stray double space (or worse,
    # a malformed directive) in connect-src.
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_headers({})
    csp = _csp_line(tmp_path)
    assert "connect-src 'self' https://accounts.google.com" in csp
    assert "  " not in csp.split("connect-src")[1]


def test_generate_headers_script_src_untouched(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_headers({})
    csp = _csp_line(tmp_path)
    # wasm-unsafe-eval only — no new hosts, no 'unsafe-inline'/'unsafe-eval'
    assert "script-src 'self' 'wasm-unsafe-eval';" in csp


def test_generate_headers_csp_tightened_directives(tmp_path, monkeypatch):
    # P2 §14 — style-src drops 'unsafe-inline' (moved to style-src-attr only),
    # and base-uri/form-action/object-src are added. Regression coverage for
    # the PR's highest-blast-radius change, which had none before this test.
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_headers({})
    csp = _csp_line(tmp_path)
    assert "style-src 'self';" in csp
    assert "'unsafe-inline'" not in csp.split("style-src-attr")[0]
    assert "style-src-attr 'unsafe-inline';" in csp
    assert "base-uri 'self';" in csp
    assert "form-action 'self';" in csp
    assert "object-src 'none'" in csp


def test_generate_headers_sentry_connect_src_matches_dsn_host(tmp_path, monkeypatch):
    # Regional Sentry orgs (e.g. US data storage) issue DSNs on
    # "*.ingest.us.sentry.io" — a wildcard on the legacy non-regional
    # "*.ingest.sentry.io" domain does not match that suffix, so the browser
    # silently drops every event via CSP with no application-visible error.
    # connect-src must derive the real host from the DSN, whatever region.
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_headers(
        {
            "sentry": {
                "enabled": True,
                "dsn": "https://abc123@o4511862654894081.ingest.us.sentry.io/456",
            }
        }
    )
    csp = _csp_line(tmp_path)
    assert "https://o4511862654894081.ingest.us.sentry.io" in csp
    assert "*.ingest.sentry.io" not in csp


def test_generate_robots_excludes_admin_account(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_robots({"site": {"base_url": "https://filecast.org"}})
    robots = (tmp_path / "robots.txt").read_text(encoding="utf-8")
    assert "Disallow: /admin/" in robots
    # account/ is deliberately crawlable so Google can see its own noindex
    # meta tag (Disallow would hide that tag from Googlebot entirely).
    assert "Disallow: /account/" not in robots
    # P3 §25 — offline.html is sw.js's fallback target only, never linked to.
    assert "Disallow: /offline.html" in robots


def test_generate_llms_txt_lists_tools_by_category(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "DIST", tmp_path)
    config = {"site": {"base_url": "https://filecast.org", "name": "FileCast"}}
    tools = [
        {
            "id": "avif-to-jpg",
            "name": "AVIF to JPG Converter",
            "slug": "/convert/avif-to-jpg",
            "category": "image-conversion",
            "tagline": "Open next-gen AVIF photos anywhere",
            "meta": {"description": "fallback description"},
        }
    ]
    categories = {
        "image-conversion": {
            "id": "image-conversion",
            "name": "Image Conversion",
            "slug": "image-conversion",
            "description": "Convert between image formats.",
            "tools": tools,
        }
    }
    build.generate_llms_txt(config, tools, categories)
    llms = (tmp_path / "llms.txt").read_text(encoding="utf-8")
    assert llms.startswith("# FileCast")
    assert "## Image Conversion" in llms
    assert (
        "- [AVIF to JPG Converter](https://filecast.org/convert/avif-to-jpg/): "
        "Open next-gen AVIF photos anywhere" in llms
    )
    assert "## Optional" in llms
    assert "https://filecast.org/privacy/" in llms


# --------------------------------------------------------------------------- #
# generate_service_worker — P3 §25 (offline support)
# --------------------------------------------------------------------------- #


def test_generate_service_worker_writes_unhashed_root_file(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_service_worker("2026-08-09")
    sw_path = tmp_path / "sw.js"
    assert sw_path.exists()
    content = sw_path.read_text(encoding="utf-8")
    assert "__CACHE_VERSION__" not in content  # placeholder must be substituted
    assert "'2026-08-09'" in content
    assert "addEventListener('fetch'" in content
    assert "addEventListener('install'" in content
    assert "addEventListener('activate'" in content


def test_generate_service_worker_never_intercepts_cross_origin(tmp_path, monkeypatch):
    # The API (api.filecast.org), Sentry's CDN, GTM, and AdSense must never be
    # cached or proxied by this worker.
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_service_worker("2026-08-09")
    content = (tmp_path / "sw.js").read_text(encoding="utf-8")
    assert "url.origin !== self.location.origin" in content


def test_generate_service_worker_only_handles_get(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_service_worker("2026-08-09")
    content = (tmp_path / "sw.js").read_text(encoding="utf-8")
    assert "request.method !== 'GET'" in content


def test_generate_service_worker_cache_writes_use_wait_until(tmp_path, monkeypatch):
    # PR #36 review — a cache.put() not kept alive by event.waitUntil is a
    # detached promise the browser can abandon the moment respondWith's own
    # promise settles (right after `return response`), silently dropping the
    # write on memory-pressured (mobile) browsers. Both the navigate and the
    # static-asset path must thread their cache write through waitUntil.
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_service_worker("2026-08-09")
    content = (tmp_path / "sw.js").read_text(encoding="utf-8")
    # install + activate each have one waitUntil; the fetch handler must add
    # two more (navigate path, static-asset path) — four total, not two.
    assert content.count("event.waitUntil(") == 4


def test_generate_service_worker_only_caches_ok_responses(tmp_path, monkeypatch):
    # PR #36 review — neither cache path checked response.ok, so a transient
    # same-origin 4xx/5xx (edge blip, deploy race) would get cached as if it
    # were the real content and keep being served until CACHE_VERSION next
    # rotates.
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_service_worker("2026-08-09")
    content = (tmp_path / "sw.js").read_text(encoding="utf-8")
    assert content.count("if (response.ok)") == 2


def test_generate_headers_worker_src(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_headers({})
    csp = _csp_line(tmp_path)
    assert "worker-src 'self';" in csp


def test_full_build_404_links_all_categories(tmp_path, monkeypatch):
    # P3 §29 — the 404 page must link every live category, not just show a
    # tool search. Sourced from nav_categories (a Jinja global), so this can
    # never drift out of sync with the site's actual category list.
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    not_found = (tmp_path / "404.html").read_text(encoding="utf-8")
    assert 'href="/document-conversion/"' in not_found
    assert 'href="/image-conversion/"' in not_found
    assert 'href="/developer-tools/"' in not_found
    assert 'id="hero-search"' in not_found  # search stays alongside the links


def test_full_build_renders_offline_page_and_sw(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    assert (tmp_path / "offline.html").exists()
    assert (tmp_path / "sw.js").exists()
    # sw.js must not be hashed the way css/js assets are.
    assert not list(tmp_path.glob("sw.*.js"))


def test_generate_sitemap_excludes_admin_account(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_sitemap(
        {"site": {"base_url": "https://filecast.org"}}, [_tool(id="a")], {}
    )
    sitemap = (tmp_path / "sitemap.xml").read_text(encoding="utf-8")
    assert "/admin/" not in sitemap
    assert "/account/" not in sitemap


def _sitemap_entry(sitemap_xml: str, loc: str) -> dict:
    """Pull the lastmod/changefreq/priority out of the <url> block for `loc`."""
    m = re.search(
        r"<url>\s*<loc>" + re.escape(loc) + r"</loc>(.*?)</url>", sitemap_xml, re.S
    )
    assert m, f"{loc} not found in sitemap"
    block = m.group(1)
    return {
        tag: re.search(rf"<{tag}>(.*?)</{tag}>", block).group(1)
        for tag in ("lastmod", "changefreq", "priority")
        if re.search(rf"<{tag}>(.*?)</{tag}>", block)
    }


def test_generate_sitemap_changefreq_by_page_type(tmp_path, monkeypatch):
    # O2 report §13 #25 — weekly for tool/category pages (and the homepage,
    # per §6.13), monthly for info pages, yearly for legal pages.
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_sitemap(
        {"site": {"base_url": "https://filecast.org"}},
        [_tool(id="a")],
        {"image-conversion": {"slug": "image-conversion"}},
    )
    sitemap = (tmp_path / "sitemap.xml").read_text(encoding="utf-8")
    assert _sitemap_entry(sitemap, "https://filecast.org/")["changefreq"] == "weekly"
    assert (
        _sitemap_entry(sitemap, "https://filecast.org/convert/png-to-jpg/")[
            "changefreq"
        ]
        == "weekly"
    )
    assert (
        _sitemap_entry(sitemap, "https://filecast.org/image-conversion/")["changefreq"]
        == "weekly"
    )
    assert (
        _sitemap_entry(sitemap, "https://filecast.org/about/")["changefreq"]
        == "monthly"
    )
    assert (
        _sitemap_entry(sitemap, "https://filecast.org/contact/")["changefreq"]
        == "monthly"
    )
    assert (
        _sitemap_entry(sitemap, "https://filecast.org/privacy/")["changefreq"]
        == "yearly"
    )
    assert (
        _sitemap_entry(sitemap, "https://filecast.org/terms/")["changefreq"] == "yearly"
    )


def test_generate_sitemap_lastmod_reuses_previous_when_content_unchanged(
    tmp_path, monkeypatch
):
    # dist/ never survives between build.py invocations (clean_dist() wipes it
    # every run, CI starts every deploy from a fresh checkout) — the durable
    # record is the sitemap.xml already published at base_url, which
    # generate_sitemap() re-fetches and diffs against. Simulated here by
    # feeding each build's own output back in as "what's currently live."
    monkeypatch.setattr(build, "DIST", tmp_path)
    tools = [_tool(id="a")]
    categories = {"image-conversion": {"slug": "image-conversion"}}
    config = {"site": {"base_url": "https://filecast.org"}}

    def render(home_body: str, tool_body: str, cat_body: str):
        build.clean_dist()  # mirrors the wipe every real build starts with
        (tmp_path / "index.html").write_text(home_body, encoding="utf-8")
        tool_dir = tmp_path / "convert" / "png-to-jpg"
        tool_dir.mkdir(parents=True)
        (tool_dir / "index.html").write_text(tool_body, encoding="utf-8")
        cat_dir = tmp_path / "image-conversion"
        cat_dir.mkdir(parents=True)
        (cat_dir / "index.html").write_text(cat_body, encoding="utf-8")

    # First "deploy": nothing published yet (the autouse fixture's default).
    render("home v1", "tool v1", "cat v1")
    build.generate_sitemap(config, tools, categories)
    sitemap_1 = (tmp_path / "sitemap.xml").read_text(encoding="utf-8")
    home_lastmod_1 = _sitemap_entry(sitemap_1, "https://filecast.org/")["lastmod"]
    tool_lastmod_1 = _sitemap_entry(
        sitemap_1, "https://filecast.org/convert/png-to-jpg/"
    )["lastmod"]
    cat_lastmod_1 = _sitemap_entry(sitemap_1, "https://filecast.org/image-conversion/")[
        "lastmod"
    ]

    # Second "deploy": fresh dist/, but the site now serves what the first
    # deploy published, and re-rendered content is byte-for-byte identical
    # (e.g. nothing in the DB/templates changed) — lastmod must not move.
    monkeypatch.setattr(build, "_fetch_previous_sitemap", lambda base: sitemap_1)
    render("home v1", "tool v1", "cat v1")
    build.generate_sitemap(config, tools, categories)
    sitemap_2 = (tmp_path / "sitemap.xml").read_text(encoding="utf-8")
    assert (
        _sitemap_entry(sitemap_2, "https://filecast.org/")["lastmod"] == home_lastmod_1
    )
    assert (
        _sitemap_entry(sitemap_2, "https://filecast.org/convert/png-to-jpg/")["lastmod"]
        == tool_lastmod_1
    )
    assert (
        _sitemap_entry(sitemap_2, "https://filecast.org/image-conversion/")["lastmod"]
        == cat_lastmod_1
    )

    # Third "deploy": only the tool page's rendered content changed since
    # what's published — only its lastmod should advance to today.
    today = date.today().isoformat()
    monkeypatch.setattr(build, "_fetch_previous_sitemap", lambda base: sitemap_2)
    render("home v1", "tool v2", "cat v1")
    build.generate_sitemap(config, tools, categories)
    sitemap_3 = (tmp_path / "sitemap.xml").read_text(encoding="utf-8")
    assert (
        _sitemap_entry(sitemap_3, "https://filecast.org/")["lastmod"] == home_lastmod_1
    )
    assert (
        _sitemap_entry(sitemap_3, "https://filecast.org/convert/png-to-jpg/")["lastmod"]
        == today
    )
    assert (
        _sitemap_entry(sitemap_3, "https://filecast.org/image-conversion/")["lastmod"]
        == cat_lastmod_1
    )


def _render_homepage_with_badges(dist: Path, counter: int, free_tools_label: str):
    # Mirrors home.html's actual shape: three STATIC hero__badge spans plus one
    # DB-sourced one, all sharing the same class — the exact ambiguity the
    # volatile-content regex has to resolve correctly.
    build.clean_dist()
    (dist / "index.html").write_text(
        "<html><body>"
        '<div class="hero__badges">'
        f'<span class="hero__badge">{free_tools_label}</span>'
        '<span class="hero__badge">Sign-up optional</span>'
        '<span class="hero__badge">No Limits</span>'
        "</div>"
        f'<span class="hero__badge">{counter}+ Files Converted</span>'
        "<p>Static homepage content</p>"
        "</body></html>",
        encoding="utf-8",
    )


def test_generate_sitemap_hash_ignores_live_homepage_counter(tmp_path, monkeypatch):
    # The homepage's hero badge embeds totals.conversions_display, an exact,
    # unbucketed live DB count that moves on nearly every build — it must not
    # make the homepage (priority 1.0) churn lastmod on every deploy the way
    # byte-exact hashing would.
    monkeypatch.setattr(build, "DIST", tmp_path)
    config = {"site": {"base_url": "https://filecast.org"}}

    _render_homepage_with_badges(tmp_path, 1000, "39 Free Tools")
    build.generate_sitemap(config, [], {})
    sitemap_1 = (tmp_path / "sitemap.xml").read_text(encoding="utf-8")
    lastmod_1 = _sitemap_entry(sitemap_1, "https://filecast.org/")["lastmod"]

    # Counter moved; nothing else on the page changed.
    _render_homepage_with_badges(tmp_path, 1042, "39 Free Tools")
    monkeypatch.setattr(build, "_fetch_previous_sitemap", lambda base: sitemap_1)
    build.generate_sitemap(config, [], {})
    sitemap_2 = (tmp_path / "sitemap.xml").read_text(encoding="utf-8")
    assert _sitemap_entry(sitemap_2, "https://filecast.org/")["lastmod"] == lastmod_1


def test_generate_sitemap_hash_still_reacts_to_static_badge_edits(
    tmp_path, monkeypatch
):
    # The volatile-content strip must be scoped to the "Files Converted" badge
    # specifically — a real copy edit to one of the three OTHER hero__badge
    # spans (same class, static text) is a genuine content change and must
    # still advance lastmod, not get silently swallowed by an over-broad strip.
    monkeypatch.setattr(build, "DIST", tmp_path)
    config = {"site": {"base_url": "https://filecast.org"}}

    _render_homepage_with_badges(tmp_path, 1000, "39 Free Tools")
    build.generate_sitemap(config, [], {})
    sitemap_1 = (tmp_path / "sitemap.xml").read_text(encoding="utf-8")

    # Only the static "N Free Tools" badge's text changed; counter unchanged.
    today = date.today().isoformat()
    _render_homepage_with_badges(tmp_path, 1000, "40 Free Tools")
    monkeypatch.setattr(build, "_fetch_previous_sitemap", lambda base: sitemap_1)
    build.generate_sitemap(config, [], {})
    sitemap_2 = (tmp_path / "sitemap.xml").read_text(encoding="utf-8")
    assert _sitemap_entry(sitemap_2, "https://filecast.org/")["lastmod"] == today


def test_generate_sitemap_hash_ignores_live_rating_counts(tmp_path, monkeypatch):
    # apply_rating_aggregates() bakes live yes/no vote tallies into the
    # #tool-ratings island — a vote landing between builds must not bump that
    # tool page's lastmod on its own.
    monkeypatch.setattr(build, "DIST", tmp_path)
    config = {"site": {"base_url": "https://filecast.org"}}
    tools = [_tool(id="a")]

    def render(yes: int, no: int):
        build.clean_dist()
        tool_dir = tmp_path / "convert" / "png-to-jpg"
        tool_dir.mkdir(parents=True)
        tool_dir.joinpath("index.html").write_text(
            "<html><body><p>Static tool content</p>"
            f'<script type="application/json" id="tool-ratings">'
            f'{{"yes": {yes}, "no": {no}}}</script>'
            "</body></html>",
            encoding="utf-8",
        )

    render(10, 2)
    build.generate_sitemap(config, tools, {})
    sitemap_1 = (tmp_path / "sitemap.xml").read_text(encoding="utf-8")
    lastmod_1 = _sitemap_entry(sitemap_1, "https://filecast.org/convert/png-to-jpg/")[
        "lastmod"
    ]

    render(11, 2)  # a vote came in; nothing else on the page changed
    monkeypatch.setattr(build, "_fetch_previous_sitemap", lambda base: sitemap_1)
    build.generate_sitemap(config, tools, {})
    sitemap_2 = (tmp_path / "sitemap.xml").read_text(encoding="utf-8")
    assert (
        _sitemap_entry(sitemap_2, "https://filecast.org/convert/png-to-jpg/")["lastmod"]
        == lastmod_1
    )


def test_fetch_previous_sitemap_degrades_on_any_failure(monkeypatch, capsys):
    # Same graceful-degrade posture as this file's DB touchpoints (P10) — an
    # unreachable/erroring live site must not crash the build, just fall back
    # to "no previous state" (every URL gets today's date). Unlike this file's
    # other P10 paths, a silent except-and-return-None here would mean a
    # persistently failing fetch regresses the build to "today" on every URL
    # forever with zero signal in the logs — so it must also print.
    def boom(*_args, **_kwargs):
        raise OSError("unreachable")

    monkeypatch.setattr(build.urllib.request, "urlopen", boom)
    _REAL_FETCH_PREVIOUS_SITEMAP.cache_clear()
    assert _REAL_FETCH_PREVIOUS_SITEMAP("https://filecast-degrade-test.example") is None
    assert "[sitemap] previous sitemap.xml unavailable" in capsys.readouterr().out


def test_fetch_previous_sitemap_caches_per_base(monkeypatch):
    # --watch calls build() (and therefore generate_sitemap()) on every saved
    # file (0.5s poll loop) — without caching, that's a live HTTP round-trip on
    # every local edit instead of once per dev session.
    calls = []

    class _FakeResponse:
        status = 200

        def read(self):
            return b"<urlset></urlset>"

        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            return False

    def fake_urlopen(url, timeout=None):
        calls.append(url)
        return _FakeResponse()

    monkeypatch.setattr(build.urllib.request, "urlopen", fake_urlopen)
    _REAL_FETCH_PREVIOUS_SITEMAP.cache_clear()
    _REAL_FETCH_PREVIOUS_SITEMAP("https://filecast-cache-test.example")
    _REAL_FETCH_PREVIOUS_SITEMAP("https://filecast-cache-test.example")
    assert len(calls) == 1


# --------------------------------------------------------------------------- #
# Cookie consent gate — GA4/AdSense vendor loaders are consent-gated rather
# than eagerly loaded (technical report §13, P0 item 2)
# --------------------------------------------------------------------------- #


def _consent_config(html):
    m = re.search(
        r'<script type="application/json" id="cookie-consent-config">\s*(\{.*?\})\s*</script>',
        html,
        re.S,
    )
    return json.loads(m.group(1)) if m else None


def test_full_build_all_off_renders_no_consent_gate(tmp_path, monkeypatch):
    # Nothing on the page could set a tracking cookie ⇒ no banner, no config
    # island, no consent.js — same "off means off end-to-end" posture as the
    # AdSense-off tests above.
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    home = (tmp_path / "index.html").read_text(encoding="utf-8")
    assert 'id="cookie-consent"' not in home
    assert 'id="cookie-consent-config"' not in home
    assert "js/consent." not in home


def test_full_build_ga4_on_renders_consent_gate_sitewide(tmp_path, monkeypatch):
    # GA4 loads on every page, so the banner and gate must too — checked on a
    # tool-less page (privacy) as well as the homepage/about, none of which
    # carry AdSense inventory.
    _seed_site_settings(ga4_enabled=True, ga4_measurement_id="G-CONSENT")
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    for page in ("index.html", "about/index.html", "privacy/index.html"):
        html = (tmp_path / page).read_text(encoding="utf-8")
        assert 'id="cookie-consent"' in html, page
        assert 'id="cookie-consent__accept"' in html, page
        assert 'id="cookie-consent__reject"' in html, page
        data = _consent_config(html)
        assert data == {
            "ga4_src": "https://www.googletagmanager.com/gtag/js?id=G-CONSENT",
            "adsense_src": None,
        }, page
        loader = re.search(r'<script src="/js/consent\.[0-9a-f]+\.js"[^>]*>', html)
        assert loader, page
        assert " defer" in loader.group(0), loader.group(0)
        assert "integrity=" in loader.group(0), loader.group(0)


def test_full_build_ads_on_gates_adsbygoogle_behind_consent(tmp_path, monkeypatch):
    # AdSense is scoped in too (not just GA4): the vendor URL rides in the
    # config island for consent.js to fetch later, never as a live <script src>.
    _seed_site_settings(**ADS_ON)
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    for slug in TOOL_PAGES.values():
        html = _tool_page(tmp_path, slug)
        data = _consent_config(html)
        assert data["ga4_src"] is None, slug
        assert data["adsense_src"] == (
            "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"
            "?client=ca-pub-1234567890123456"
        ), slug
        assert (
            '<script async src="https://pagead2.googlesyndication.com' not in html
        ), slug


def test_full_build_ads_on_leaves_adless_pages_without_a_consent_gate(
    tmp_path, monkeypatch
):
    # AdSense inventory lives only on tool pages, and GA4 is off in this test,
    # so the homepage/static pages have nothing to gate consent for either.
    _seed_site_settings(**ADS_ON)
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    for page in ("index.html", "about/index.html"):
        html = (tmp_path / page).read_text(encoding="utf-8")
        assert 'id="cookie-consent"' not in html, page


def test_generate_headers_includes_hsts(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_headers({})
    headers = (tmp_path / "_headers").read_text(encoding="utf-8")
    assert (
        "Strict-Transport-Security: max-age=31536000; includeSubDomains; preload"
        in headers
    )


def test_generate_redirects_www_to_apex(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_redirects({"site": {"base_url": "https://filecast.org"}})
    redirects = (tmp_path / "_redirects").read_text(encoding="utf-8")
    assert (
        redirects.strip()
        == "https://www.filecast.org/* https://filecast.org/:splat 301\n"
        "/document-tools/* /document-conversion/:splat 301\n"
        "/data-conversion/* /developer-tools/:splat 301"
    )


def test_generate_redirects_default_base_url(tmp_path, monkeypatch):
    # No site.base_url in config ⇒ falls back to the same default the rest of
    # build.py uses, never a crash or an empty file.
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_redirects({})
    redirects = (tmp_path / "_redirects").read_text(encoding="utf-8")
    assert "www.filecast.org" in redirects


def test_generate_redirects_schemeless_base_url_warns_and_skips_www_only(
    tmp_path, monkeypatch, capsys
):
    # A base_url with no scheme (e.g. "filecast.org" instead of
    # "https://filecast.org") makes urlparse().netloc empty — must not crash
    # or silently drop the (host-independent) category redirect below with no
    # explanation for the missing www line.
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_redirects({"site": {"base_url": "filecast.org"}})
    redirects = (tmp_path / "_redirects").read_text(encoding="utf-8")
    assert redirects == (
        "/document-tools/* /document-conversion/:splat 301\n"
        "/data-conversion/* /developer-tools/:splat 301\n"
    )
    assert "no host" in capsys.readouterr().out


def test_generate_redirects_document_tools_to_document_conversion(
    tmp_path, monkeypatch
):
    # O2 report §4.1/§13 #11 — the renamed category URL. Host-independent (a
    # literal path redirect), so it must be present regardless of base_url.
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_redirects({"site": {"base_url": "https://filecast.org"}})
    redirects = (tmp_path / "_redirects").read_text(encoding="utf-8")
    assert "/document-tools/* /document-conversion/:splat 301" in redirects


def test_generate_redirects_data_conversion_to_developer_tools(tmp_path, monkeypatch):
    # Build Action Plan Phase 0 — the data-conversion category was renamed to
    # developer-tools. Host-independent (a literal path redirect), so it must
    # be present regardless of base_url.
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_redirects({"site": {"base_url": "https://filecast.org"}})
    redirects = (tmp_path / "_redirects").read_text(encoding="utf-8")
    assert "/data-conversion/* /developer-tools/:splat 301" in redirects


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
    # All YAML tools (no overlay) — live count so this never goes stale the
    # moment a new tool YAML is added, mirroring how home.html's
    # "{{ tools|length }} Free Tools" computes its count at build time.
    assert len(records) == len(build.load_tools())

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

    # robots excludes admin/ but leaves account/ crawlable (so its own noindex
    # meta tag can take effect); sitemap must NOT list either.
    robots = (built / "robots.txt").read_text(encoding="utf-8")
    assert "Disallow: /admin/" in robots
    assert "Disallow: /account/" not in robots
    sitemap = (built / "sitemap.xml").read_text(encoding="utf-8")
    assert "/admin/" not in sitemap and "/account/" not in sitemap

    # llms.txt (GEO) mirrors sitemap's privacy scope — no admin/account leak —
    # and links a real tool page under its real category heading.
    llms = (built / "llms.txt").read_text(encoding="utf-8")
    assert "/admin/" not in llms and "/account/" not in llms
    assert "## Image Conversion" in llms
    assert "[PNG to JPG Converter](https://filecast.org/convert/png-to-jpg/)" in llms

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


# --------------------------------------------------------------------------- #
# SEO Phase 1 — homepage foundation fixes (O2 report §13 #4-#6)
# --------------------------------------------------------------------------- #


def test_homepage_h1_is_plain_and_unlinked(built):
    home = (built / "index.html").read_text(encoding="utf-8")
    # The H1's text content must stay exactly this string for SEO relevance,
    # even though it's split into two brand-color spans for visual weight.
    h1 = home.split('<h1 class="hero__title">')[1].split("</h1>")[0]
    assert re.sub(r"<[^>]+>", "", h1) == "Free Online File Converter"
    # The old H1 wrapped its text in a link to /privacy/, making the page's
    # primary heading double as navigation — must never carry an <a> again.
    assert "<a" not in h1
    # The privacy link survives, just relocated to the tagline below the H1.
    assert '<p class="hero__subtitle"><a href="/privacy/"' in home


def test_homepage_title_targets_a_searchable_keyword(built):
    home = (built / "index.html").read_text(encoding="utf-8")
    assert (
        "<title>FileCast — Free Online File Converter | PDF, Image "
        "&amp; Data Tools</title>" in home
    )
    # og:title inherits the same copy (home.html doesn't override the block),
    # so social shares match the SERP title.
    assert (
        'property="og:title" content="FileCast — Free Online File Converter '
        '| PDF, Image &amp; Data Tools"' in home
    )


def test_homepage_meta_description_describes_the_product(built):
    home = (built / "index.html").read_text(encoding="utf-8")
    assert (
        'name="description" content="Convert documents, images, and data '
        "files for free — 34 tools, no sign-up, no limits." in home
    )
    # og:description inherits the same copy (home.html doesn't override the
    # block), so social shares match the SERP snippet.
    assert (
        'property="og:description" content="Convert documents, images, and '
        "data files for free" in home
    )


# --------------------------------------------------------------------------- #
# Homepage hero redesign (R11) — two-column hero + How It Works folded in
# --------------------------------------------------------------------------- #


def test_homepage_how_it_works_step_copy(built):
    home = (built / "index.html").read_text(encoding="utf-8")
    # No other coverage touches this section's content — locks in the three
    # step captions so a future template edit can't silently drop or garble
    # one.
    assert "Drop your file in, or browse." in home
    assert "Most conversions run in your browser." in home
    assert "No watermarks, no waiting." in home


def test_homepage_search_placeholder_has_no_ellipsis(built):
    home = (built / "index.html").read_text(encoding="utf-8")
    assert 'placeholder="Search conversion tools (e.g. HEIC, PDF, JSON)"' in home


# --------------------------------------------------------------------------- #
# Homepage "view all" overflow tile — a card__ghost tile inside .card-grid
# (replaces the old text link trailing below the grid) linking to the
# category page, for any category with more than HOMEPAGE_CAP (4) enabled
# tools. Every real category currently exceeds 4, so only the "tile present"
# branch is exercised here; the "tile absent" branch (`remaining <= 0`) is a
# plain `tools[:4]` slice that can never underflow, verified by reading
# home.html rather than by seeding a synthetic small category.
# --------------------------------------------------------------------------- #


def test_homepage_view_all_tile_shows_remaining_count_and_links_to_category(built):
    home = (built / "index.html").read_text(encoding="utf-8")
    # document-conversion has more than 4 enabled tools today, so its section
    # must carry a ghost tile: the 5-column grid modifier, a link to the
    # category page, and an aria-label naming the category and its full tool
    # count (not the "+N" shown visually, which would read as a confusing
    # non-sequitur to a screen reader if left to the card's own text content).
    section = home.split('id="document-conversion"')[1].split("</section>")[0]
    assert "card-grid--has-more" in section

    tag = re.search(
        r'<a class="card card--ghost" href="(/document-conversion/)" '
        r'aria-label="View all Document Conversion \(\d+ tools\)">',
        section,
    )
    assert tag, section
    tile = section[tag.end() :].split("</a>")[0]
    assert re.search(r'card--ghost__count">\+\d+<', tile)


def test_homepage_view_all_tile_count_matches_hidden_tool_count(built):
    # The visible "+N" must equal (total enabled tools in the category) - 4,
    # not just "some positive number" — this is the number a user is being
    # promised will be on the category page.
    home = (built / "index.html").read_text(encoding="utf-8")
    section = home.split('id="image-conversion"')[1].split("</section>")[0]
    total = int(
        re.search(r"View all Image Conversion \((\d+) tools\)", section).group(1)
    )
    shown = int(re.search(r'card--ghost__count">\+(\d+)<', section).group(1))
    assert shown == total - 4


# --------------------------------------------------------------------------- #
# Open Graph share images (O2 report §13 #7)
# --------------------------------------------------------------------------- #


def test_og_images_written_for_every_page_kind(built):
    """One PNG per tool id and category id, plus home.png and one shared
    default.png. Coverage regression guard: a page kind that stops getting
    its own image would still build a green site with a broken/missing
    social card, since og:image itself never errors on a missing file."""
    og_dir = built / "images" / "og"
    files = {p.name for p in og_dir.glob("*.png")}

    assert "home.png" in files
    assert "default.png" in files

    tool_data = json.loads((built / "tool-data.json").read_text(encoding="utf-8"))
    for tool in tool_data:
        assert f"{tool['id']}.png" in files, tool["id"]

    # OG image filenames are keyed by category ID, not slug (see
    # test_category_og_image_keys_by_id_not_slug) — all three ids match their
    # slugs today, but the mechanism itself is id-keyed, not slug-keyed.
    for cat_id in ("document-conversion", "image-conversion", "developer-tools"):
        assert f"{cat_id}.png" in files, cat_id

    # No stray/orphaned images beyond what's expected: 34 tools + 3 categories
    # + home + default.
    assert len(files) == len(tool_data) + 3 + 2


def test_og_images_are_1200x630(built):
    from PIL import Image

    for name in (
        "home.png",
        "default.png",
        "png-to-jpg.png",
        "document-conversion.png",
    ):
        with Image.open(built / "images" / "og" / name) as img:
            assert img.size == (1200, 630), name


def test_og_image_tags_present_across_page_kinds(built):
    """Every page kind carries a complete, well-formed og:image block — not
    just the homepage. Covers all three tool ui_type templates (§8 of the
    ad-slot tests above is exactly this same "don't only check one template"
    lesson applied to OG images), a category page, and a plain static page
    that relies entirely on base.html's default (no per-template override)."""
    pages = {
        "home": built / "index.html",
        "tool-standard": built / "convert" / "pdf-to-jpg" / "index.html",
        "tool-text-input": built / "convert" / "csv-to-json" / "index.html",
        "tool-multi-file": built / "convert" / "pdf-merge" / "index.html",
        "category": built / "document-conversion" / "index.html",
        "static-default": built / "privacy" / "index.html",
    }
    for label, path in pages.items():
        html = path.read_text(encoding="utf-8")
        assert re.search(
            r'<meta property="og:image" content="https://filecast\.org/images/og/[\w-]+\.png">',
            html,
        ), label
        assert '<meta property="og:image:width" content="1200">' in html, label
        assert '<meta property="og:image:height" content="630">' in html, label
        assert re.search(r'<meta property="og:image:alt" content="[^"]+">', html), label


def test_og_type_present_across_page_kinds(built):
    """O2 report §5.4/§13 #14 flagged og:type as homepage-only. It's actually
    unconditional in base.html (outside every block), so this just pins that
    invariant across every page kind — a future per-template override
    ("website" for tools, say) would need to keep this passing too."""
    pages = {
        "home": built / "index.html",
        "tool-standard": built / "convert" / "pdf-to-jpg" / "index.html",
        "tool-text-input": built / "convert" / "csv-to-json" / "index.html",
        "tool-multi-file": built / "convert" / "pdf-merge" / "index.html",
        "category": built / "document-conversion" / "index.html",
        "static-default": built / "privacy" / "index.html",
    }
    for label, path in pages.items():
        html = path.read_text(encoding="utf-8")
        assert '<meta property="og:type" content="website">' in html, label


def test_tool_og_image_path_matches_tool_id_not_slug(built):
    # tool.slug is "/convert/png-to-jpg" (used for the URL); the OG image is
    # keyed by the shorter tool.id ("png-to-jpg") — same value here, but a
    # future tool whose slug diverges from its id must not silently 404 its
    # share image.
    page = (built / "convert" / "png-to-jpg" / "index.html").read_text(encoding="utf-8")
    assert 'content="https://filecast.org/images/og/png-to-jpg.png"' in page


def test_category_og_image_keys_by_id_not_slug(tmp_path, monkeypatch):
    # document-tools' id and slug used to diverge (O2 report §4.1/§13 #11
    # renamed the slug to /document-conversion/, but the id stayed
    # document-tools) — that was the real-world example proving
    # generate_og_images() keys off id, not slug. A later rename (Build
    # Action Plan Phase 0 follow-up) unified id and slug for every category,
    # so no real example of the divergence is left. Guards both halves of the
    # mechanism directly instead: generate_og_images() must name the file
    # after the category dict's KEY (its id), and category.html's og:image
    # block must read {{ category.id }}, never {{ category.slug }}.
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_og_images(
        tools=[],
        categories_with_tools={
            "fake-id": {
                "name": "Fake Category",
                "slug": "totally-different-slug",
                "tools": [],
            }
        },
        site_config={},
    )
    og_dir = tmp_path / "images" / "og"
    assert (og_dir / "fake-id.png").exists()
    assert not (og_dir / "totally-different-slug.png").exists()

    template_src = (build.TEMPLATES_DIR / "category.html").read_text(encoding="utf-8")
    assert "{{ category.id }}.png" in template_src


# --------------------------------------------------------------------------- #
# Twitter Card tags (O2 report §13 #8)
# --------------------------------------------------------------------------- #


def test_twitter_card_tags_mirror_og_tags_across_page_kinds(built):
    """twitter:title/description/image must equal the SAME page's og:title/
    og:description/og:image, not just be present — the report's own spec
    ("Values mirror the corresponding OG tags"). Checked on every page kind
    (home, all three tool ui_types, category, and a static page relying on
    base.html's default) so a template that overrides og_title/og_image
    without the mirrored twitter tag updating can't slip through unnoticed.
    """
    pages = {
        "home": built / "index.html",
        "tool-standard": built / "convert" / "pdf-to-jpg" / "index.html",
        "tool-text-input": built / "convert" / "csv-to-json" / "index.html",
        "tool-multi-file": built / "convert" / "pdf-merge" / "index.html",
        "category": built / "document-conversion" / "index.html",
        "static-default": built / "privacy" / "index.html",
    }
    for label, path in pages.items():
        html = path.read_text(encoding="utf-8")
        assert '<meta name="twitter:card" content="summary_large_image">' in html, label

        og_title = re.search(r'<meta property="og:title" content="([^"]*)">', html)
        og_description = re.search(
            r'<meta property="og:description" content="([^"]*)">', html
        )
        og_image = re.search(r'<meta property="og:image" content="([^"]*)">', html)
        assert og_title and og_description and og_image, label

        twitter_title = re.search(
            r'<meta name="twitter:title" content="([^"]*)">', html
        )
        twitter_description = re.search(
            r'<meta name="twitter:description" content="([^"]*)">', html
        )
        twitter_image = re.search(
            r'<meta name="twitter:image" content="([^"]*)">', html
        )
        assert twitter_title and twitter_description and twitter_image, label

        assert twitter_title.group(1) == og_title.group(1), label
        assert twitter_description.group(1) == og_description.group(1), label
        assert twitter_image.group(1) == og_image.group(1), label


def test_twitter_site_handle_omitted(built):
    # No FileCast Twitter/X account exists — twitter:site names one, and an
    # absent tag is valid (the card still renders); a placeholder/fake handle
    # would be worse than nothing.
    home = (built / "index.html").read_text(encoding="utf-8")
    assert 'name="twitter:site"' not in home


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


# --------------------------------------------------------------------------- #
# BreadcrumbList + WebApplication JSON-LD (O2 report §7.2/§7.3/§13 #15, #16)
# --------------------------------------------------------------------------- #


def _ldjson_blocks(html: str) -> list[dict]:
    return [
        json.loads(m)
        for m in re.findall(
            r'<script type="application/ld\+json">(.*?)</script>', html, re.S
        )
    ]


def test_breadcrumb_jsonld_present_across_page_kinds(built):
    """Every page kind that renders a visual breadcrumb gets a matching
    BreadcrumbList block: all three tool ui_type templates, plus category."""
    pages = {
        "tool-standard": built / "convert" / "pdf-to-jpg" / "index.html",
        "tool-text-input": built / "convert" / "csv-to-json" / "index.html",
        "tool-multi-file": built / "convert" / "pdf-merge" / "index.html",
        "category": built / "document-conversion" / "index.html",
    }
    for label, path in pages.items():
        html = path.read_text(encoding="utf-8")
        blocks = [b for b in _ldjson_blocks(html) if b.get("@type") == "BreadcrumbList"]
        assert len(blocks) == 1, label
        items = blocks[0]["itemListElement"]
        # Every ListItem but the last (the current page) is a real link;
        # positions are contiguous starting at 1 (schema.org requirement).
        for i, item in enumerate(items, start=1):
            assert item["@type"] == "ListItem", label
            assert item["position"] == i, label
            assert item["name"], label
        assert "item" not in items[-1], label  # current page, no self-link
        for item in items[:-1]:
            assert item["item"].startswith("https://filecast.org/"), label


def test_breadcrumb_jsonld_tool_page_includes_category_level(built):
    # Home > Image Conversion > PNG to JPG Converter — three levels, matching
    # the visual breadcrumb <nav> in the same template.
    html = (built / "convert" / "png-to-jpg" / "index.html").read_text(encoding="utf-8")
    blocks = [b for b in _ldjson_blocks(html) if b.get("@type") == "BreadcrumbList"]
    items = blocks[0]["itemListElement"]
    assert [i["name"] for i in items] == [
        "Home",
        "Image Conversion",
        "PNG to JPG Converter",
    ]
    assert items[1]["item"] == "https://filecast.org/image-conversion/"


def test_breadcrumb_jsonld_category_page_has_no_intermediate_level(built):
    # Home > Document Conversion — two levels; the category page IS the
    # intermediate level, so there's nothing to insert between it and Home.
    html = (built / "document-conversion" / "index.html").read_text(encoding="utf-8")
    blocks = [b for b in _ldjson_blocks(html) if b.get("@type") == "BreadcrumbList"]
    items = blocks[0]["itemListElement"]
    assert [i["name"] for i in items] == ["Home", "Document Conversion"]


def test_webapp_jsonld_present_across_tool_ui_types(built):
    pages = {
        "tool-standard": built / "convert" / "pdf-to-jpg" / "index.html",
        "tool-text-input": built / "convert" / "csv-to-json" / "index.html",
        "tool-multi-file": built / "convert" / "pdf-merge" / "index.html",
    }
    for label, path in pages.items():
        html = path.read_text(encoding="utf-8")
        blocks = [b for b in _ldjson_blocks(html) if b.get("@type") == "WebApplication"]
        assert len(blocks) == 1, label
        app = blocks[0]
        assert app["name"], label
        assert app["url"].startswith("https://filecast.org/convert/"), label
        assert app["applicationCategory"] == "UtilitiesApplication", label
        assert app["operatingSystem"] == "Any", label
        assert app["offers"] == {
            "@type": "Offer",
            "price": "0",
            "priceCurrency": "USD",
        }, label
        assert app["description"], label
        assert app["featureList"], label


def test_webapp_jsonld_feature_list_does_not_claim_no_upload_for_server_tools(built):
    # docx-to-pdf is server-side — it DOES upload the file (and deletes it
    # immediately). Baking "No upload" into structured data for it would be a
    # false privacy claim, same class of bug the OG image subtitle and
    # processing_pill() already guard against elsewhere (P15).
    html = (built / "convert" / "docx-to-pdf" / "index.html").read_text(
        encoding="utf-8"
    )
    blocks = [b for b in _ldjson_blocks(html) if b.get("@type") == "WebApplication"]
    assert "No upload" not in blocks[0]["featureList"]
    assert "Encrypted transfer" in blocks[0]["featureList"]


def test_webapp_jsonld_feature_list_claims_no_upload_for_client_tools(built):
    html = (built / "convert" / "png-to-jpg" / "index.html").read_text(encoding="utf-8")
    blocks = [b for b in _ldjson_blocks(html) if b.get("@type") == "WebApplication"]
    assert "No upload" in blocks[0]["featureList"]


# --------------------------------------------------------------------------- #
# Organization JSON-LD (O2 report §7.4/§13 #17)
# --------------------------------------------------------------------------- #


def test_organization_jsonld_on_homepage(built):
    html = (built / "index.html").read_text(encoding="utf-8")
    blocks = [b for b in _ldjson_blocks(html) if b.get("@type") == "Organization"]
    assert len(blocks) == 1
    org = blocks[0]
    assert org["name"] == "FileCast"
    assert org["url"] == "https://filecast.org/"
    assert org["logo"] == "https://filecast.org/favicon.svg"
    assert org["description"]


def test_organization_jsonld_omits_sameas(built):
    # No public social profile or repo link exists yet (the GitHub repo is
    # private — see contact.html's comment on why its own link was removed).
    # `sameAs` is optional in schema.org; a link that 404s would be worse
    # than omitting the field.
    html = (built / "index.html").read_text(encoding="utf-8")
    blocks = [b for b in _ldjson_blocks(html) if b.get("@type") == "Organization"]
    assert "sameAs" not in blocks[0]


def test_organization_jsonld_only_on_homepage(built):
    # Not every page needs its own Organization block — one per site is
    # standard practice; check a tool and a category page don't duplicate it.
    for path in (
        built / "convert" / "png-to-jpg" / "index.html",
        built / "document-conversion" / "index.html",
    ):
        html = path.read_text(encoding="utf-8")
        assert not [b for b in _ldjson_blocks(html) if b.get("@type") == "Organization"]


# --------------------------------------------------------------------------- #
# Internal linking (O2 report §5.7/§13 #18)
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "tool_a,tool_b",
    [
        ("docx-to-pdf", "pdf-to-docx"),
        ("html-to-markdown", "markdown-to-html"),
        ("csv-to-json", "json-to-csv"),
        ("xml-to-json", "json-to-xml"),
    ],
)
def test_reverse_tool_link_is_bidirectional(built, tool_a, tool_b):
    # Each pair must link to each other, not just one direction — the report's
    # own framing ("ensure every tool WITH a reverse counterpart has this
    # link") is symmetric by definition.
    page_a = (built / "convert" / tool_a / "index.html").read_text(encoding="utf-8")
    page_b = (built / "convert" / tool_b / "index.html").read_text(encoding="utf-8")
    assert f'href="/convert/{tool_b}/"' in page_a, f"{tool_a} -> {tool_b}"
    assert f'href="/convert/{tool_a}/"' in page_b, f"{tool_b} -> {tool_a}"


def test_footer_popular_tools_row_present_on_every_page_kind(built):
    pages = [
        built / "index.html",
        built / "convert" / "png-to-jpg" / "index.html",
        built / "document-conversion" / "index.html",
        built / "privacy" / "index.html",
    ]
    expected_hrefs = [
        "/convert/docx-to-pdf/",
        "/convert/png-to-jpg/",
        "/convert/heic-to-jpg/",
        "/convert/pdf-merge/",
        "/convert/pdf-compress/",
        "/convert/image-resize/",
    ]
    for path in pages:
        html = path.read_text(encoding="utf-8")
        assert "Popular Tools" in html, path
        for href in expected_hrefs:
            assert f'href="{href}"' in html, f"{path}: missing {href}"


def test_select_popular_tools_skips_missing_ids():
    # An admin-disabled (or renamed) tool among the six must shorten the row,
    # not crash the build (P10 — same posture as apply_tool_overrides()).
    tools = [
        {
            "id": "png-to-jpg",
            "name": "PNG to JPG Converter",
            "slug": "/convert/png-to-jpg",
        }
    ]
    result = build.select_popular_tools(tools)
    assert result == [
        {
            "id": "png-to-jpg",
            "name": "PNG to JPG Converter",
            "slug": "/convert/png-to-jpg",
        }
    ]


def test_cross_category_links_added_to_when_to_use_content(built):
    # O2 report §5.7 point 1's own example: a tool in one category linking to
    # a tool in another as a natural next step. image-to-pdf (image-conversion)
    # -> pdf-compress (document-conversion); pdf-to-jpg/pdf-to-png
    # (document-conversion) -> image-compress (image-conversion).
    #
    # pdf-compress is ALSO one of the six footer "Popular Tools" links, so a
    # bare href check on image-to-pdf's page wouldn't distinguish "the content
    # link was added" from "it's just in every page's footer" — pin the
    # actual added sentence instead. image-compress isn't a popular tool, so
    # the href check alone is unambiguous for the other two.
    page = (built / "convert" / "image-to-pdf" / "index.html").read_text(
        encoding="utf-8"
    )
    assert (
        '<a href="/convert/pdf-compress/">PDF Compressor</a> afterward to shrink it'
        in page
    )

    for tool_id in ("pdf-to-jpg", "pdf-to-png"):
        page = (built / "convert" / tool_id / "index.html").read_text(encoding="utf-8")
        assert 'href="/convert/image-compress/"' in page


# --------------------------------------------------------------------------- #
# "Alternatives" content block (O2 report §5.8/§13 #19)
# --------------------------------------------------------------------------- #

ALTERNATIVES_HEADING_RE = re.compile(r"<h2>Other Ways to [^<]+</h2>\s*<p>[^<]+</p>")


def test_alternatives_block_present_on_every_tool_page(built):
    tool_data = json.loads((built / "tool-data.json").read_text(encoding="utf-8"))
    for tool in tool_data:
        slug = tool["slug"].strip("/")
        page = (built / slug / "index.html").read_text(encoding="utf-8")
        assert ALTERNATIVES_HEADING_RE.search(page), tool["id"]


def test_alternatives_block_content_differs_by_group(built):
    # Not a single boilerplate string copy-pasted onto all 34 pages — the
    # shared-group snippets must actually differ by real-world alternative.
    pairs = {
        "png-to-jpg": "photo viewer",
        "docx-to-pdf": "Microsoft Word",
        "pdf-compress": "Compress PDF",
        "pdf-merge": "Combine Files",
        "csv-to-json": "script in your language",
        "html-to-pdf": "Print dialog",
    }
    for tool_id, must_contain in pairs.items():
        page = (built / "convert" / tool_id / "index.html").read_text(encoding="utf-8")
        assert must_contain in page, tool_id


def test_alternatives_pdf_action_tools_do_not_reuse_office_app_answer(built):
    # pdf-compress/merge/rotate/split are all PDF->PDF (no source document to
    # open in Word/Docs/LibreOffice) — must not get the docx-to-pdf-style
    # "Microsoft Word, PowerPoint, or Excel" answer.
    for tool_id in ("pdf-compress", "pdf-merge", "pdf-rotate", "pdf-split"):
        page = (built / "convert" / tool_id / "index.html").read_text(encoding="utf-8")
        assert "Microsoft Word, PowerPoint, or Excel" not in page


def test_load_alternatives_covers_every_tool(built):
    # Every shipped tool must resolve to a real ALTERNATIVES group — an
    # unmapped output_format would silently render an empty section
    # (load_alternatives()'s `if not entry` branch), not an error. Live count
    # so this never goes stale the moment a new tool YAML is added.
    tool_data = json.loads((built / "tool-data.json").read_text(encoding="utf-8"))
    assert len(tool_data) == len(build.load_tools())
    for tool in tool_data:
        slug = tool["slug"].strip("/")
        page = (built / slug / "index.html").read_text(encoding="utf-8")
        assert "<h2>Other Ways to" in page, tool["id"]


def test_alternatives_retemplated_groups_substitute_source():
    # DOCX/HTML/CSV/XML/YAML used to hardcode one specific source (e.g. the
    # YAML entry literally read "...Convert JSON to YAML") — harmless while
    # only one shipped tool targeted each format, but Prompts 3/5/6 add a
    # second tool sharing each of these targets (Build Action Plan Phase 0
    # "Two tests worth fixing here too"). Exercises load_alternatives()
    # directly with a source none of today's 34 tools use, so a future
    # regression back to a hardcoded string is caught immediately rather than
    # only once that second tool actually ships.
    cases = [
        ("DOCX", "Markdown"),
        ("HTML", "PDF"),
        ("CSV", "TSV"),
        ("XML", "CSV"),
        ("YAML", "XML"),
    ]
    tools = [
        {
            "id": f"fake-to-{group.lower()}",
            "input_format": source,
            "output_format": group,
        }
        for group, source in cases
    ]
    build.load_alternatives(tools)
    for tool, (group, source) in zip(tools, cases, strict=True):
        html = tool["alternatives_html"]
        assert f"Convert {source} to" in html, group
        assert html.count(source) >= 2, group  # heading AND sentence both substitute it
