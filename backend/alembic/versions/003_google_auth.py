"""google_auth

Revision ID: 003
Revises: 002
Create Date: 2026-09-28

Adds Firebase/Google authentication support to the users table:

  1. Makes hashed_password nullable — Google-only users have no password.
  2. Adds firebase_uid VARCHAR(128) UNIQUE NULLABLE — stores the Firebase UID
     for users authenticated via Google.

Existing email/password users are unaffected: their hashed_password remains
set and their firebase_uid remains NULL.
"""
from alembic import op
import sqlalchemy as sa


revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Make hashed_password nullable for Google-only users
    op.alter_column(
        'users',
        'hashed_password',
        existing_type=sa.String(length=255),
        nullable=True,
    )

    # Add firebase_uid column (unique, nullable, indexed)
    op.add_column(
        'users',
        sa.Column('firebase_uid', sa.String(length=128), nullable=True),
    )
    op.create_unique_constraint('uq_users_firebase_uid', 'users', ['firebase_uid'])
    op.create_index('ix_users_firebase_uid', 'users', ['firebase_uid'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_users_firebase_uid', table_name='users')
    op.drop_constraint('uq_users_firebase_uid', 'users', type_='unique')
    op.drop_column('users', 'firebase_uid')

    # Restore NOT NULL — note: any rows with NULL hashed_password will cause
    # this downgrade to fail on a live DB. Safe to run only on empty/dev DBs.
    op.alter_column(
        'users',
        'hashed_password',
        existing_type=sa.String(length=255),
        nullable=False,
    )
