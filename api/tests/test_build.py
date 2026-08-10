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
    # script-src stays literally 'self' and no gtag/adsense host leaks in.
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    csp = _csp_from_build(tmp_path)
    assert "script-src 'self';" in csp
    assert "googletagmanager" not in csp
    assert "googlesyndication" not in csp
    home = (tmp_path / "index.html").read_text(encoding="utf-8")
    assert "FileCast" in home  # YAML-seeded copy renders


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
    # untouched — script-src stays literally 'self', no vendor host leaks in. This
    # is the launch posture (a seeded but unconfigured site), distinct from no-row.
    _seed_site_settings(site_name="Present But Off")
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    csp = _csp_from_build(tmp_path)
    assert "script-src 'self';" in csp
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
    # script-src that is literally 'self'.
    _seed_site_settings(site_name="Present But Off")
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.build()
    assert "script-src 'self';" in _csp_from_build(tmp_path)
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
    assert "script-src 'self';" in csp
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
    assert "script-src 'self';" in csp  # exactly 'self', no new hosts


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
    assert "Disallow: /account/" in robots
    # P3 §25 — offline.html is sw.js's fallback target only, never linked to.
    assert "Disallow: /offline.html" in robots


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
    assert 'href="/document-tools/"' in not_found
    assert 'href="/image-conversion/"' in not_found
    assert 'href="/data-conversion/"' in not_found
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
        == "https://www.filecast.org/* https://filecast.org/:splat 301"
    )


def test_generate_redirects_default_base_url(tmp_path, monkeypatch):
    # No site.base_url in config ⇒ falls back to the same default the rest of
    # build.py uses, never a crash or an empty file.
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_redirects({})
    redirects = (tmp_path / "_redirects").read_text(encoding="utf-8")
    assert "www.filecast.org" in redirects


def test_generate_redirects_schemeless_base_url_warns_and_writes_nothing(
    tmp_path, monkeypatch, capsys
):
    # A base_url with no scheme (e.g. "filecast.org" instead of
    # "https://filecast.org") makes urlparse().netloc empty — must not crash
    # or silently ship an empty file with no explanation.
    monkeypatch.setattr(build, "DIST", tmp_path)
    build.generate_redirects({"site": {"base_url": "filecast.org"}})
    redirects = (tmp_path / "_redirects").read_text(encoding="utf-8")
    assert redirects == ""
    assert "no host" in capsys.readouterr().out


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


# --------------------------------------------------------------------------- #
# SEO Phase 1 — homepage foundation fixes (O2 report §13 #4-#6)
# --------------------------------------------------------------------------- #


def test_homepage_h1_is_plain_and_unlinked(built):
    home = (built / "index.html").read_text(encoding="utf-8")
    assert '<h1 class="hero__title">Free Online File Converter</h1>' in home
    # The old H1 wrapped its text in a link to /privacy/, making the page's
    # primary heading double as navigation — must never carry an <a> again.
    h1 = home.split('<h1 class="hero__title">')[1].split("</h1>")[0]
    assert "<a" not in h1
    # The privacy link survives, just relocated to the tagline below the H1.
    assert '<p class="hero__subtitle"><a href="/privacy/"' in home


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
