"""contact page messages

Adds the ``messages`` table backing the contact page's title+body form
(anonymous or attributed to a signed-in user via ``user_id``). Retained,
never purged — see the ``Message`` model docstring.

Revision ID: 0009_messages
Revises: 0008_seo_homepage_description
Create Date: 2026-08-21 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0009_messages'
down_revision: Union[str, None] = '0008_seo_homepage_description'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('messages',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('title', sa.String(), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('email', sa.String(), nullable=True),
    sa.Column('user_id', sa.String(), nullable=True),
    sa.Column('user_agent', sa.String(), nullable=True),
    sa.Column('status', sa.String(), nullable=False, server_default='new'),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_messages_user_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_messages'))
    )
    op.create_index('ix_messages_created_at', 'messages', ['created_at'], unique=False)
    op.create_index('ix_messages_status', 'messages', ['status'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_messages_status', table_name='messages')
    op.drop_index('ix_messages_created_at', table_name='messages')
    op.drop_table('messages')
