"""tool homepage featured slot

Adds ``tools.featured_slot`` (1-4, nullable) — independent homepage curation
per category, decoupled from ``sort_order`` (which keeps driving the nav
dropdown + category page). Admin-panel redesign: homepage and dropdown used to
be forced into the same order because both read ``sort_order``; this lets an
admin pick which up-to-4 tools per category headline the homepage without
moving them in the browse order.

Deliberately NOT named ``homepage_order`` — that name is already live in
``seed.py``/tool YAML (``_within_category_key()``), where it only seeds
``sort_order``'s initial within-category position and has nothing to do with
what renders on the homepage template.

The backfill snapshots each category's current top-4 *enabled* tools (by
``sort_order``) into slots 1-4, one time, so the homepage isn't blank the
moment this ships — reproducing the exact positional rule the homepage used
before this migration (top 4 enabled tools per category, in ``sort_order``).
From here on, ``featured_slot`` is admin-set only; nothing recomputes it
automatically (``build.attach_homepage_tools()`` falls back to that same
positional rule only for a category with nothing slotted at all, e.g. the
no-DB build path — see its docstring).

Revision ID: 0011_tool_featured_slot
Revises: 0010_seo_tool_count_refresh
Create Date: 2026-08-22 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0011_tool_featured_slot'
down_revision: Union[str, None] = '0010_seo_tool_count_refresh'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tools', sa.Column('featured_slot', sa.Integer(), nullable=True))
    op.execute(
        sa.text(
            """
            WITH ranked AS (
                SELECT id, ROW_NUMBER() OVER (
                    PARTITION BY category ORDER BY sort_order
                ) AS rn
                FROM tools
                WHERE enabled = true AND category IS NOT NULL
            )
            UPDATE tools SET featured_slot = ranked.rn
            FROM ranked
            WHERE tools.id = ranked.id AND ranked.rn <= 4
            """
        )
    )


def downgrade() -> None:
    op.drop_column('tools', 'featured_slot')
