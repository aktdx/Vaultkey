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
# Firebase vars — empty strings so firebase_service skips initialization
os.environ.setdefault("FIREBASE_PROJECT_ID",          "")
os.environ.setdefault("FIREBASE_SERVICE_ACCOUNT_JSON", "")

from sqlalchemy import create_engine          # noqa: E402
from sqlalchemy.pool import StaticPool        # noqa: E402
from app.database import Base                 # noqa: E402
import app.database as _db                    # noqa: E402

# Replace the engine with one that uses StaticPool + check_same_thread=False
# so all threads (including TestClient's worker thread) share a single
# in-memory SQLite connection.  Without this, each thread gets its own
# empty in-memory DB and "no such table" errors appear.
_test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_db.engine = _test_engine
_db.SessionLocal = _db.SessionLocal.__class__(
    autocommit=False, autoflush=False, bind=_test_engine
)
# Rebuild SessionLocal properly
from sqlalchemy.orm import sessionmaker       # noqa: E402
_db.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_test_engine)


@pytest.fixture(scope="session", autouse=True)
def create_tables():
    """Create all SQLite tables once per test session."""
    Base.metadata.create_all(bind=_test_engine)
    yield
    Base.metadata.drop_all(bind=_test_engine)
