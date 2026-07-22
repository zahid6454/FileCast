"""correct the false site_description (P15 / ledger §9)

The shipped description asserted an absolute that does not hold:

    "Convert files instantly in your browser. Free, fast, and private —
     your files never leave your device."

Six of the 34 tools are ``type: server-side`` (docx-to-pdf, pptx-to-pdf,
xlsx-to-pdf, html-to-pdf, pdf-compress, pdf-to-docx) and do upload the file to
the API. This field feeds the meta description and the JSON-LD payload, so the
false claim reaches search results and social cards.

Fixing ``site-config.yaml`` alone is not enough: since Phase 7 the field is
also stored in ``site_settings`` (id=1) and ``build.py`` deep-merges the DB row
*on top of* the YAML, so the DB wins. ``seed.py`` won't repair it either — it
only inserts when the row is absent. Hence this data migration.

**Guarded on purpose.** The ``WHERE`` clause matches the exact false string, so
the update is a no-op on any environment where an admin has already changed the
description. Admin-owned content is only overwritten when it is still holding
the known-bad text.

``site_tagline`` is deliberately left alone: "Free File Conversion — Your Files
Stay Yours" is true for server-side tools too (the file is converted and
deleted immediately, never retained or looked at) and it is the home page
``<h1>``.

Revision ID: 0004_honest_site_description
Revises: 0003_site_settings
Create Date: 2026-07-22 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0004_honest_site_description'
down_revision: Union[str, None] = '0003_site_settings'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Kept as module constants so the guard and the downgrade can't drift apart.
# The dashes are em-dashes (U+2014), matching site-config.yaml exactly.
OLD_DESCRIPTION = (
    "Convert files instantly in your browser. Free, fast, and private "
    "— your files never leave your device."
)
NEW_DESCRIPTION = (
    "Most tools run entirely in your browser — nothing is uploaded. "
    "The few server-side tools convert and delete your file immediately."
)


def _swap(before: str, after: str) -> None:
    """Rewrite the singleton's description only if it still holds `before`."""
    op.execute(
        sa.text(
            "UPDATE site_settings SET site_description = :after "
            "WHERE id = 1 AND site_description = :before"
        ).bindparams(after=after, before=before)
    )


def upgrade() -> None:
    _swap(OLD_DESCRIPTION, NEW_DESCRIPTION)


def downgrade() -> None:
    # Symmetric and equally guarded: restores the old text only where this
    # migration is what put the new text there.
    _swap(NEW_DESCRIPTION, OLD_DESCRIPTION)
