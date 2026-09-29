"""
Pytest configuration and shared fixtures for VaultKey backend tests.
"""
import os
import pytest

# Set env vars at module level — before any app import — so database.py,
# storage.py, etc. see the test values when they first execute.
os.environ.setdefault("JWT_SECRET",           "test_jwt_secret_key_for_testing_only_not_production")
os.environ.setdefault("DATABASE_URL",         "sqlite:///:memory:")
os.environ.setdefault("R2_ACCOUNT_ID",        "testaccount")
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


import io
from app import storage as _storage_mod
import app.routes.files as _files_routes
import app.routes.access as _access_routes

_IN_MEMORY_R2 = {}

class _MockStreamingBody:
    def __init__(self, data: bytes):
        self._data = data
        self._io = io.BytesIO(data)
        self.closed = False

    def iter_chunks(self, chunk_size=1024*1024):
        while True:
            chunk = self._io.read(chunk_size)
            if not chunk:
                break
            yield chunk

    def read(self, amt=None):
        return self._io.read(amt)

    def close(self):
        self.closed = True

def _mock_upload_fileobj(fileobj, key, content_type="application/octet-stream"):
    pos = fileobj.tell()
    _IN_MEMORY_R2[key] = fileobj.read()
    fileobj.seek(pos)

def _mock_open_body(key: str):
    if key not in _IN_MEMORY_R2:
        # Default mock content if not found
        return _MockStreamingBody(b"DUMMY_CIPHERTEXT_BYTES")
    return _MockStreamingBody(_IN_MEMORY_R2[key])

def _mock_delete_file(key: str):
    _IN_MEMORY_R2.pop(key, None)

_storage_mod.upload_file = lambda key, fileobj, content_type="application/octet-stream": _mock_upload_fileobj(fileobj, key, content_type)
_storage_mod.upload_file_streaming = lambda key, fileobj, content_type="application/octet-stream": _mock_upload_fileobj(fileobj, key, content_type)
_storage_mod._open_body = _mock_open_body
_storage_mod.delete_file = _mock_delete_file
_files_routes.upload_file_streaming = _storage_mod.upload_file_streaming
_files_routes.delete_file = _storage_mod.delete_file
_access_routes._open_body = _storage_mod._open_body

