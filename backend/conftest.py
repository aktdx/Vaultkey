"""
Pytest configuration and shared fixtures for VaultKey backend tests.
"""
import os
import pytest

# Set env vars at module level — before any app import — so database.py,
# storage.py, etc. see the test values when they first execute.
os.environ.setdefault("JWT_SECRET",           "test_jwt_secret_key_for_testing_only_not_production")
os.environ.setdefault("DATABASE_URL",         "sqlite:///:memory:")
os.environ.setdefault("R2_ACCOUNT_ID",        "test_account")
os.environ.setdefault("R2_BUCKET_NAME",       "test_bucket")
os.environ.setdefault("R2_ACCESS_KEY_ID",     "test_key")
os.environ.setdefault("R2_SECRET_ACCESS_KEY", "test_secret")

from app.database import Base, engine  # noqa: E402 — must come after env setup


@pytest.fixture(scope="session", autouse=True)
def create_tables():
    """Create all SQLite tables once per test session."""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)
