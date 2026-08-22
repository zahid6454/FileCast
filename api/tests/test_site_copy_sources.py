"""The site tagline and description each have two sources of truth — keep them honest.

``site.tagline`` and ``site.description`` live in **both** ``site-config.yaml``
and the ``site_settings`` row (id=1), and ``build.py`` deep-merges the DB row
*on top of* the YAML. That asymmetry is what let the false "your files never
leave your device" claim survive a copy pass: the YAML was the obvious place to
look, the DB silently won, and nothing warned about it.

Each data migration that has ever corrected one of these fields
(``0004_honest_site_description``, ``0007_seo_homepage_title``,
``0008_seo_homepage_description``, ``0010_seo_tool_count_refresh``) carries
its own copy of the replacement string so it can guard on the exact prior
value. That gives us *three* copies of the same sentence (YAML, migration,
and whatever is in the DB) per edit. These tests pin the two that live in the
repo together — specifically, that the CURRENT YAML value matches the NEWEST
migration to touch that field — so a future edit to one without the other is
a test failure rather than a silent divergence that only shows up in
production meta tags. Older, superseded migrations (0004's description fix,
and now 0008's, superseded by 0010's tool-count refresh) keep their own
self-contained tests below, pinned to their own historical constants — those
never change regardless of what ships later.

Deliberately no DB access — this is a source-consistency check, and it should
fail fast in CI without a Postgres round trip.
"""

import importlib.util
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
SITE_CONFIG = ROOT / "site-config.yaml"
VERSIONS = ROOT / "api" / "migrations" / "versions"
MIGRATION = VERSIONS / "0004_honest_site_description.py"  # historical, description
MIGRATION_TAGLINE = VERSIONS / "0007_seo_homepage_title.py"  # current, tagline
MIGRATION_DESCRIPTION_0008 = (
    VERSIONS / "0008_seo_homepage_description.py"
)  # historical, description (superseded by 0010's tool-count refresh)
MIGRATION_DESCRIPTION = (
    VERSIONS / "0010_seo_tool_count_refresh.py"
)  # current, description

# Claims that are false for the six ``type: server-side`` tools *unless* the
# sentence carrying them is scoped to a subset of tools.
#
# A bare substring ban would be wrong: §9's own approved wording is "Most tools
# run entirely in your browser — nothing is uploaded", so the phrase is fine —
# the qualifier is what makes it true. What must never ship is the claim as an
# unqualified promise about the whole site or a whole category.
ABSOLUTE_CLAIMS = (
    "never leave your device",
    "nothing is uploaded",
    "processing happens in your browser",
    "files never leave",
)

# A sentence containing one of these is making a claim about *some* tools.
SCOPING_QUALIFIERS = ("most", "some", "many", "a few", "these tools", "client-side")


def _sentences(text: str):
    """Split on sentence terminators. Em-dashes deliberately do NOT split — in
    §9's construction the qualifier and the claim share one sentence across an
    em-dash, and that is exactly the scoping we want to credit."""
    out, buf = [], ""
    for ch in text:
        buf += ch
        if ch in ".!?":
            out.append(buf)
            buf = ""
    if buf.strip():
        out.append(buf)
    return out


def assert_claims_are_scoped(text: str, where: str):
    for sentence in _sentences(text.lower()):
        for claim in ABSOLUTE_CLAIMS:
            if claim in sentence and not any(q in sentence for q in SCOPING_QUALIFIERS):
                raise AssertionError(
                    f"{where} asserts {claim!r} without scoping it to a subset "
                    f"of tools, which is false for the six server-side tools.\n"
                    f"  sentence: {sentence.strip()!r}\n"
                    f'  fix: qualify it, e.g. "Most tools run entirely in '
                    f'your browser — nothing is uploaded."'
                )


def _load_migration(path: Path = MIGRATION):
    """Import a migration module (by path) without running Alembic."""
    module_name = f"_{path.stem}"
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    # Alembic's ``op`` proxy is import-safe outside a migration context; only
    # calling it requires one, and we only read module constants.
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def site_config():
    with open(SITE_CONFIG, encoding="utf-8") as f:
        return yaml.safe_load(f)


def test_tagline_migration_matches_site_config(site_config):
    """The YAML and the newest tagline migration must ship the *same* string.

    If they drift, a fresh environment (seeded from YAML) and an existing one
    (corrected by the migration) render different title tags for the same
    site — the exact failure mode that is invisible until someone diffs two
    deployments.
    """
    m = _load_migration(MIGRATION_TAGLINE)
    assert site_config["site"]["tagline"] == m.NEW_TAGLINE


def test_description_migration_matches_site_config(site_config):
    """The YAML and the newest description migration must ship the *same*
    sentence, for the same reason as the tagline check above."""
    m = _load_migration(MIGRATION_DESCRIPTION)
    assert site_config["site"]["description"] == m.NEW_DESCRIPTION


def test_migration_0004_guard_value_is_not_the_new_value():
    """A guard of ``WHERE description = <new>`` would be a silent no-op."""
    m = _load_migration(MIGRATION)
    assert m.OLD_DESCRIPTION != m.NEW_DESCRIPTION


def test_migration_0007_guard_value_is_not_the_new_value():
    m = _load_migration(MIGRATION_TAGLINE)
    assert m.OLD_TAGLINE != m.NEW_TAGLINE


def test_migration_0008_guard_value_is_not_the_new_value():
    m = _load_migration(MIGRATION_DESCRIPTION_0008)
    assert m.OLD_DESCRIPTION != m.NEW_DESCRIPTION


def test_migration_0010_guard_value_is_not_the_new_value():
    m = _load_migration(MIGRATION_DESCRIPTION)
    assert m.OLD_DESCRIPTION != m.NEW_DESCRIPTION


def test_migration_0010_chains_from_0008s_output():
    """0010's guard must match what 0008 actually wrote, or the ``WHERE``
    clause silently no-ops on every environment that ran 0008 (i.e. all of
    them) — the same failure mode 0004->0008 already guards against via the
    site-config match above."""
    old = _load_migration(MIGRATION_DESCRIPTION_0008)
    new = _load_migration(MIGRATION_DESCRIPTION)
    assert new.OLD_DESCRIPTION == old.NEW_DESCRIPTION


def test_replacement_fits_the_api_length_cap(site_config):
    """``site_tagline``/``site_description`` are admin-editable and validated
    at ≤ 160 / ≤ 300 chars. A migration that writes a value the API would
    reject leaves the row in a state the admin panel cannot re-save.
    """
    from data.routers.site_settings import DESCRIPTION_MAX, TAGLINE_MAX

    assert len(site_config["site"]["tagline"]) <= TAGLINE_MAX
    assert len(site_config["site"]["description"]) <= DESCRIPTION_MAX

    tagline_migration = _load_migration(MIGRATION_TAGLINE)
    assert len(tagline_migration.NEW_TAGLINE) <= TAGLINE_MAX
    assert len(tagline_migration.OLD_TAGLINE) <= TAGLINE_MAX

    for path in (MIGRATION, MIGRATION_DESCRIPTION_0008, MIGRATION_DESCRIPTION):
        m = _load_migration(path)
        assert len(m.NEW_DESCRIPTION) <= DESCRIPTION_MAX
        assert len(m.OLD_DESCRIPTION) <= DESCRIPTION_MAX


def test_site_description_scopes_its_privacy_claim(site_config):
    """Site-wide copy must hold for the server-side tools too (P15).

    This field feeds the meta description and the JSON-LD payload, so an
    unscoped claim here reaches search results and social cards.
    """
    assert_claims_are_scoped(site_config["site"]["description"], "site.description")


def test_category_descriptions_scope_their_privacy_claims(site_config):
    """Category blurbs are promises about a whole category.

    Image and text are all-client-side *today*, so an absolute there is only
    accidentally true — it becomes a false public claim the moment a
    server-side tool joins the category, with nothing to catch it.
    """
    for category in site_config["categories"]:
        assert_claims_are_scoped(
            category.get("description", ""), f"category {category['id']!r}"
        )


def test_the_guard_actually_rejects_the_string_this_migration_removed():
    """Negative control.

    A scope check that passes everything is worse than none — it reads as
    coverage while asserting nothing. This pins that the exact sentence
    migration 0004 exists to delete is still caught.
    """
    m = _load_migration()
    with pytest.raises(AssertionError, match="never leave your device"):
        assert_claims_are_scoped(m.OLD_DESCRIPTION, "the pre-0004 description")

    # ...and that a properly scoped claim is accepted, so the guard isn't
    # simply banning the phrase outright.
    assert_claims_are_scoped(m.NEW_DESCRIPTION, "the post-0004 description")
