"""email/password auth (P4 §37)

Revision ID: 0006_password_auth
Revises: 0005_rating_feedback
Create Date: 2026-08-10 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0006_password_auth'
down_revision: Union[str, None] = '0005_rating_feedback'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('password_hash', sa.String(), nullable=True))
    op.add_column(
        'users',
        sa.Column(
            'email_verified',
            sa.Boolean(),
            server_default=sa.text('false'),
            nullable=False,
        ),
    )
    op.add_column(
        'users', sa.Column('email_verify_token_hash', sa.String(), nullable=True)
    )
    op.add_column(
        'users',
        sa.Column('email_verify_expires_at', sa.DateTime(timezone=True), nullable=True),
    )
    # Existing accounts are all Google OAuth today — Google already verifies
    # the email before upsert_google_user ever runs, so backfill them as
    # verified rather than leaving every pre-existing user at the new column's
    # False default.
    op.execute("UPDATE users SET email_verified = true")


def downgrade() -> None:
    op.drop_column('users', 'email_verify_expires_at')
    op.drop_column('users', 'email_verify_token_hash')
    op.drop_column('users', 'email_verified')
    op.drop_column('users', 'password_hash')
