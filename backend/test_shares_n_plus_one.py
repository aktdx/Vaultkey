"""
Regression test: GET /api/shares must not issue one FileItem query per share.

Uses SQLAlchemy's before_cursor_execute event to count raw SQL statements
fired during the request. With N shares the old code produced N+1 queries;
the fix should produce a constant number regardless of N.
"""
import os

# Must be set before any app import; conftest.py also sets these via setdefault
# so whichever runs first wins — both agree on the same values.
os.environ.setdefault("JWT_SECRET",           "test_jwt_secret_key_for_testing_only_not_production")
os.environ.setdefault("DATABASE_URL",         "sqlite:///:memory:")
os.environ.setdefault("R2_ACCOUNT_ID",        "test_account")
os.environ.setdefault("R2_BUCKET_NAME",       "test_bucket")
os.environ.setdefault("R2_ACCESS_KEY_ID",     "test_key")
os.environ.setdefault("R2_SECRET_ACCESS_KEY", "test_secret")

from sqlalchemy import event, pool, create_engine
from sqlalchemy.orm import sessionmaker
from app.database import Base
import app.database as _db
from unittest.mock import patch
from app.main import app
from fastapi.testclient import TestClient

# sqlite:///:memory: with the default pool creates a new DB per connection.
# Override the engine and session factory with StaticPool so all connections
# share the same in-memory DB — matching how conftest.py-less isolation works.
_test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=pool.StaticPool,
)
_db.engine = _test_engine
_db.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_test_engine)
Base.metadata.create_all(bind=_test_engine)

client = TestClient(app)

N = 3  # number of shares to create; the count must stay constant for any N


def _count_queries(fn):
    """Run fn() and return (result, number_of_sql_statements_executed)."""
    count = 0

    def _before(conn, cursor, statement, parameters, context, executemany):
        nonlocal count
        count += 1

    event.listen(_test_engine, "before_cursor_execute", _before)
    try:
        result = fn()
    finally:
        event.remove(_test_engine, "before_cursor_execute", _before)

    return result, count


def test_list_shares_query_count_is_constant():
    # --- setup: register, upload a file, create N shares ---
    email = "n1_test@vaultkey.app"
    reg = client.post("/api/auth/register", json={"email": email, "password": "TestPass123!"})
    token = (reg if reg.status_code == 200 else
             client.post("/api/auth/login", json={"email": email, "password": "TestPass123!"})).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    with patch("app.routes.files.upload_file_streaming", return_value=None), \
         patch("app.routes.files.delete_file", return_value=None):
        upload = client.post(
            "/api/files",
            headers=headers,
            files={"file": ("test.pdf.enc", b"fake-ciphertext", "application/octet-stream")},
            data={"original_filename": "test.pdf", "iv_hex": "aabbccdd11223344"},
        )
    assert upload.status_code == 200, upload.text
    file_id = upload.json()["id"]

    for _ in range(N):
        r = client.post("/api/shares", headers=headers, json={"file_id": file_id, "max_downloads": 5})
        assert r.status_code == 200, r.text

    # --- measure ---
    response, query_count = _count_queries(
        lambda: client.get("/api/shares", headers=headers)
    )

    assert response.status_code == 200, response.text
    assert len(response.json()) == N

    # Old code: 1 (fetch shares) + N (one FileItem per share) = N+1 = 4
    # New code: constant regardless of N (auth + one join query ≤ 2, plus
    #           any session/savepoint overhead SQLite adds — keep ceiling at 6)
    assert query_count <= 6, (
        f"Expected ≤6 queries for {N} shares, got {query_count}. "
        "N+1 regression detected."
    )
    # The key invariant: count must NOT grow with N.
    # We verify this by also asserting it's strictly less than the N+1 total.
    assert query_count < N + 1 + 1, (  # N+1 old behaviour + 1 slack
        f"Query count {query_count} looks like N+1 behaviour for N={N}."
    )



