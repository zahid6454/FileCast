"""conversion unique visitors

Adds ``conversions.unique_visitors`` (distinct-fingerprint reach per
tool/day, alongside the existing ``count`` volume metric) and its dedup
ledger table ``conversion_visitors`` — reuses the daily-rotated fingerprint
already used for `ratings` dedup, existence-only (no usage content), purged
by the same retention job as `errors`/`user_conversions`.

Revision ID: 0012_conversion_unique_visitors
Revises: 0011_tool_featured_slot
Create Date: 2026-08-22 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0012_conversion_unique_visitors'
down_revision: Union[str, None] = '0011_tool_featured_slot'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'conversions',
        sa.Column('unique_visitors', sa.Integer(), nullable=False, server_default='0'),
    )

    op.create_table(
        'conversion_visitors',
        sa.Column('tool_id', sa.String(), primary_key=True),
        sa.Column('date', sa.Date(), primary_key=True),
        sa.Column('fingerprint', sa.String(), primary_key=True),
    )
    op.create_index(
        'ix_conversion_visitors_date', 'conversion_visitors', ['date']
    )


def downgrade() -> None:
    op.drop_index('ix_conversion_visitors_date', table_name='conversion_visitors')
    op.drop_table('conversion_visitors')
    op.drop_column('conversions', 'unique_visitors')
