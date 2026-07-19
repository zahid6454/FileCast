"""staff grants (Phase 5.5)

Revision ID: 0002_staff_grants
Revises: 0001_initial
Create Date: 2026-07-19 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0002_staff_grants'
down_revision: Union[str, None] = '0001_initial'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('staff_grants',
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('email', sa.String(), nullable=False),
    sa.Column('role', sa.String(), nullable=False),
    sa.Column('granted_by', sa.String(), nullable=True),
    sa.Column('granted_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('consumed_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['granted_by'], ['users.id'], name=op.f('fk_staff_grants_granted_by_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_staff_grants')),
    sa.UniqueConstraint('email', name=op.f('uq_staff_grants_email'))
    )


def downgrade() -> None:
    op.drop_table('staff_grants')
