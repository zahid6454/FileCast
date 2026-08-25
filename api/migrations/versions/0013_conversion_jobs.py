"""conversion jobs

Adds ``conversion_jobs`` — async server-side conversion job metadata
(STRESS_TEST_PHASE3_PLAN.md Part A). Job bytes live in the shared
``job_results`` Docker volume, never in this table.

Revision ID: 0013_conversion_jobs
Revises: 0012_conversion_unique_visitors
Create Date: 2026-08-25 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0013_conversion_jobs'
down_revision: Union[str, None] = '0012_conversion_unique_visitors'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'conversion_jobs',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('tool_id', sa.String(), nullable=False),
        sa.Column('status', sa.String(), nullable=False, server_default='queued'),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column(
            'options', postgresql.JSONB(), nullable=False, server_default='{}'
        ),
        sa.Column('original_filename', sa.String(), nullable=False),
        sa.Column('output_filename', sa.String(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('error_type', sa.String(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('downloaded_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_conversion_jobs_status', 'conversion_jobs', ['status'])
    op.create_index(
        'ix_conversion_jobs_created_at', 'conversion_jobs', ['created_at']
    )


def downgrade() -> None:
    op.drop_index('ix_conversion_jobs_created_at', table_name='conversion_jobs')
    op.drop_index('ix_conversion_jobs_status', table_name='conversion_jobs')
    op.drop_table('conversion_jobs')
