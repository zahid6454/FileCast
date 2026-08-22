"""homepage meta description tool count is stale again (34 -> 99)

``site_description`` feeds the homepage ``<meta name="description">`` (and,
via base.html's fallback, ``og:description`` on any page that doesn't
override it) and the homepage's ``WebSite`` JSON-LD. 0008 corrected the copy
to describe the product instead of only the privacy model, and cited "34
tools" — accurate at the time, but the Build Action Plan (PRs #50-79) nearly
tripled the catalogue to 99 tools without anyone revisiting this sentence,
the same drift 0008 itself fixed relative to 0004. This migration only
updates the number; the rest of 0008's wording (the P15 "most tools"
qualifier, the format examples) still holds and is left untouched.

Same landmine as 0004/0007/0008: since Phase 7 this field is also stored in
``site_settings`` (id=1) and ``build.py`` deep-merges the DB row *on top of*
the YAML, so editing site-config.yaml alone is a no-op on any environment
that already has a settings row. Hence this data migration, guarded the same
way — the ``WHERE`` clause only matches the exact prior string (0008's own
replacement), so an admin who has since customized the description keeps
their own copy, and this is a no-op on any environment that never got 0008's
fix in the first place (nothing here assumes 0008 ran).

Revision ID: 0010_seo_tool_count_refresh
Revises: 0009_messages
Create Date: 2026-08-22 00:00:00.000001
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0010_seo_tool_count_refresh'
down_revision: Union[str, None] = '0009_messages'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Kept as module constants so the guard and the downgrade can't drift apart.
# OLD_DESCRIPTION is identical to 0008_seo_homepage_description.NEW_DESCRIPTION
# — duplicated rather than imported, matching that file's own note that these
# are pinned by tests, not by cross-module import (migrations stand alone).
OLD_DESCRIPTION = (
    "Convert documents, images, and data files for free — 34 tools, "
    "no sign-up, no limits. Most conversions happen in your browser. "
    "PDF, DOCX, PNG, JPG, CSV, JSON, and more."
)
NEW_DESCRIPTION = (
    "Convert documents, images, and data files for free — 99 tools, "
    "no sign-up, no limits. Most conversions happen in your browser. "
    "PDF, DOCX, PNG, JPG, CSV, JSON, and more."
)


def _swap(before: str, after: str) -> None:
    # updated_at is bumped explicitly — see 0004's docstring on why raw Core
    # SQL doesn't trigger the model's onupdate=func.now().
    op.execute(
        sa.text(
            "UPDATE site_settings SET site_description = :after, updated_at = now() "
            "WHERE id = 1 AND site_description = :before"
        ).bindparams(after=after, before=before)
    )


def upgrade() -> None:
    _swap(OLD_DESCRIPTION, NEW_DESCRIPTION)


def downgrade() -> None:
    _swap(NEW_DESCRIPTION, OLD_DESCRIPTION)
