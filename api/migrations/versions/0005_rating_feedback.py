"""rating feedback (P2 §18)

Revision ID: 0005_rating_feedback
Revises: 0004_honest_site_description
Create Date: 2026-08-09 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0005_rating_feedback'
down_revision: Union[str, None] = '0004_honest_site_description'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('rating_feedback',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tool_id', sa.String(), nullable=False),
    sa.Column('feedback_text', sa.Text(), nullable=False),
    sa.Column('user_agent', sa.String(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_rating_feedback'))
    )
    op.create_index('ix_rating_feedback_tool_id', 'rating_feedback', ['tool_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_rating_feedback_tool_id', table_name='rating_feedback')
    op.drop_table('rating_feedback')
