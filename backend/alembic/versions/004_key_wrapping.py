"""add_key_wrapping_to_shares

Revision ID: 004
Revises: 003
Create Date: 2026-09-29

Adds key wrapping columns to the shares table:
  1. wrapped_fek: encrypted File Encryption Key (hex or base64)
  2. kdf_salt: salt used for KEK derivation (hex)
  3. kdf_iterations: iteration count for PBKDF2 (e.g. 600,000)
  4. kdf_algorithm: KDF algorithm (e.g. PBKDF2-HMAC-SHA-256)
  5. wrapping_iv: initialization vector used to wrap the FEK (hex)

All columns are nullable to preserve compatibility with existing shares.
"""
from alembic import op
import sqlalchemy as sa


revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('shares', sa.Column('wrapped_fek', sa.String(), nullable=True))
    op.add_column('shares', sa.Column('kdf_salt', sa.String(length=128), nullable=True))
    op.add_column('shares', sa.Column('kdf_iterations', sa.Integer(), nullable=True))
    op.add_column('shares', sa.Column('kdf_algorithm', sa.String(length=64), nullable=True))
    op.add_column('shares', sa.Column('wrapping_iv', sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column('shares', 'wrapping_iv')
    op.drop_column('shares', 'kdf_algorithm')
    op.drop_column('shares', 'kdf_iterations')
    op.drop_column('shares', 'kdf_salt')
    op.drop_column('shares', 'wrapped_fek')
