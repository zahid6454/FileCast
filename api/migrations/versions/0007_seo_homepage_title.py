"""homepage title tag targets a searchable keyword (O2 SEO report §13 #5)

``site_tagline`` feeds the homepage ``<title>`` (and, via base.html's
fallback, ``og:title`` on any page that doesn't override it) as
``"{site_name} — {site_tagline}"``. The shipped tagline, "Free File
Conversion — Your Files Stay Yours", has zero search volume — nobody
searches for that phrase, so the title tag was carrying no keyword signal
for the page Google treats as the site's most important. See
O2-FileCast-SEO-Report.md §4.5.

Same landmine as 0004_honest_site_description: since Phase 7 this field is
also stored in ``site_settings`` (id=1) and ``build.py`` deep-merges the DB
row *on top of* the YAML, so editing site-config.yaml alone is a no-op on
any environment that already has a settings row (i.e. production). Hence
this data migration, guarded the same way 0004 is — the ``WHERE`` clause
only matches the exact prior string, so an admin who has already
customized the tagline keeps their own copy.

Revision ID: 0007_seo_homepage_title
Revises: 0006_password_auth
Create Date: 2026-08-10 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0007_seo_homepage_title'
down_revision: Union[str, None] = '0006_password_auth'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Kept as module constants so the guard and the downgrade can't drift apart.
# The em-dash matches site-config.yaml exactly.
OLD_TAGLINE = "Free File Conversion — Your Files Stay Yours"
NEW_TAGLINE = "Free Online File Converter | PDF, Image & Data Tools"


def _swap(before: str, after: str) -> None:
    # updated_at is bumped explicitly — see 0004's docstring on why raw Core
    # SQL doesn't trigger the model's onupdate=func.now().
    op.execute(
        sa.text(
            "UPDATE site_settings SET site_tagline = :after, updated_at = now() "
            "WHERE id = 1 AND site_tagline = :before"
        ).bindparams(after=after, before=before)
    )


def upgrade() -> None:
    _swap(OLD_TAGLINE, NEW_TAGLINE)


def downgrade() -> None:
    _swap(NEW_TAGLINE, OLD_TAGLINE)
