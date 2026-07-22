"""site settings singleton (Phase 7)

Revision ID: 0003_site_settings
Revises: 0002_staff_grants
Create Date: 2026-07-22 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0003_site_settings'
down_revision: Union[str, None] = '0002_staff_grants'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('site_settings',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('site_name', sa.String(), nullable=False),
    sa.Column('site_tagline', sa.String(), nullable=False),
    sa.Column('site_description', sa.Text(), nullable=False),
    sa.Column('adsense_enabled', sa.Boolean(), nullable=False),
    sa.Column('adsense_publisher_id', sa.String(), nullable=True),
    sa.Column('adsense_slot_leaderboard', sa.String(), nullable=True),
    sa.Column('adsense_slot_in_content', sa.String(), nullable=True),
    sa.Column('ga4_enabled', sa.Boolean(), nullable=False),
    sa.Column('ga4_measurement_id', sa.String(), nullable=True),
    sa.Column('sentry_enabled', sa.Boolean(), nullable=False),
    sa.Column('sentry_dsn', sa.String(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_site_settings'))
    )


def downgrade() -> None:
    op.drop_table('site_settings')
