"""email/password auth — tombstone (P4 §37, reverted #39)

Revision ID: 0006_password_auth
Revises: 0005_rating_feedback
Create Date: 2026-08-10 00:00:00.000000

The email/password auth feature this revision originally added
(password_hash, email_verified, email_verify_token_hash,
email_verify_expires_at on users) was reverted in PR #39 before
reaching most environments. Production had already applied the
original 0006 and was walked back with `alembic downgrade
0005_rating_feedback`, after which the file was deleted outright
instead of replaced with a real down-migration.

That left the revision ID orphaned: any environment whose
alembic_version still pointed at '0006_password_auth' (a second
replica, a restore from a backup taken between the original PR #37
merge and the #39 revert, a developer's local DB) would fail
`alembic upgrade head` with "Can't locate revision identified by
'0006_password_auth'" — and the API container's CMD is `alembic
upgrade head && uvicorn ...`, so it wouldn't start.

This file restores the revision ID as a no-op so upgrade/downgrade
both resolve cleanly regardless of which side of the revert an
environment's alembic_version currently sits on. It intentionally
does NOT re-add the columns — the feature is gone for good.
"""
from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = '0006_password_auth'
down_revision: Union[str, None] = '0005_rating_feedback'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
