"""add tools.homepage_order (seed-managed display cache)

Revision ID: 0002_tool_homepage_order
Revises: 0001_initial
Create Date: 2026-07-14 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002_tool_homepage_order"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tools", sa.Column("homepage_order", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("tools", "homepage_order")
