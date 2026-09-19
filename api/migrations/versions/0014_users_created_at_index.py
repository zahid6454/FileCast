"""users created_at index

Adds ``ix_users_created_at`` — ADMIN-DASHBOARD-ANALYTICS-PLAN.md §7.2's new
"New signups" widget groups by ``User.created_at``; cheap to add now rather
than as a follow-up once the table is materially larger (today: 11 rows).

Revision ID: 0014_users_created_at_index
Revises: 0013_conversion_jobs
Create Date: 2026-09-19 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0014_users_created_at_index'
down_revision: Union[str, None] = '0013_conversion_jobs'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index('ix_users_created_at', 'users', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_users_created_at', table_name='users')
