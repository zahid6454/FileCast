"""homepage meta description describes the product, not just privacy (O2 SEO report §13 #6)

``site_description`` feeds the homepage ``<meta name="description">`` (and,
via base.html's fallback, ``og:description`` on any page that doesn't
override it) and the homepage's ``WebSite`` JSON-LD. The text 0004 shipped —
"Most tools run entirely in your browser — nothing is uploaded. The few
server-side tools convert and delete your file immediately." — is honest
(that migration's whole point) but describes the privacy *architecture*, not
the product: a searcher landing on this snippet has no idea FileCast
converts files, has 34 tools, or supports PDF/image/data formats. See
O2-FileCast-SEO-Report.md §4.4.

The new copy keeps 0004's P15 qualifier ("most tools", not an unqualified
"nothing is uploaded") — ``api/tests/test_site_copy_sources.py`` still
enforces that no absolute claim ships unscoped, this migration's target text
included.

Same landmine as 0004 and 0007_seo_homepage_title: since Phase 7 this field
is also stored in ``site_settings`` (id=1) and ``build.py`` deep-merges the
DB row *on top of* the YAML, so editing site-config.yaml alone is a no-op on
any environment that already has a settings row. Hence this data migration,
guarded the same way — the ``WHERE`` clause only matches the exact prior
string (0004's own replacement), so an admin who has since customized the
description keeps their own copy, and this is a no-op on any environment
that never got 0004's fix in the first place (nothing here assumes 0004 ran).

Revision ID: 0008_seo_homepage_description
Revises: 0007_seo_homepage_title
Create Date: 2026-08-10 00:00:00.000001
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0008_seo_homepage_description'
down_revision: Union[str, None] = '0007_seo_homepage_title'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Kept as module constants so the guard and the downgrade can't drift apart.
# Identical string to 0004_honest_site_description.NEW_DESCRIPTION — duplicated
# rather than imported, matching that file's own note that these are pinned by
# tests, not by cross-module import (migrations are meant to stand alone).
OLD_DESCRIPTION = (
    "Most tools run entirely in your browser — nothing is uploaded. "
    "The few server-side tools convert and delete your file immediately."
)
NEW_DESCRIPTION = (
    "Convert documents, images, and data files for free — 34 tools, "
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
