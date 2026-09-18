"""
Audit-log transaction boundary tests.

Verifies that after the log_event() refactor:
  1. Successful download: FILE_DOWNLOADED audit row and counter increment
     are in the same committed transaction (atomically consistent).
  2. Failed download (wrong password): PASSWORD_FAILED row is committed,
     download_count is unchanged.
  3. Revoked link: ACCESS_DENIED row is committed, HTTP 403 returned.
  4. Password failure on /authorize: PASSWORD_FAILED row is committed,
     HTTP 401 returned.
  5. Transaction rollback: if db.commit() raises after log_event() stages
     the row, both the business mutation and the AccessLog are absent.

Uses an in-memory SQLite DB (StaticPool) and mocked R2 so the tests run
offline without any live credentials — same pattern as test_streaming.py.

Run with:
  cd backend
  python -m pytest test_audit_transactions.py -v
"""

import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

# ── Override engine before importing app.main ─────────────────────────────────
# StaticPool ensures every thread (including FastAPI's threadpool workers)
# shares the same in-memory connection, so tables created by create_all are
# visible to request handlers. Same technique as test_streaming.py.
import app.database as _db_mod
_test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_db_mod.engine = _test_engine
_db_mod.SessionLocal = _db_mod.sessionmaker(autocommit=False, autoflush=False, bind=_test_engine)

from app.main import app  # noqa: E402 — must come after engine override
from app.database import Base
from app.models import AccessLog, ShareLink

Base.metadata.create_all(bind=_test_engine)

client = TestClient(app, raise_server_exceptions=False)

# Minimal fake StreamingBody — returned by the mocked _open_body so download
# requests reach 200 without touching R2.
_FAKE_BODY = MagicMock()
_FAKE_BODY.iter_chunks.return_value = iter([b"fake-ciphertext"])
_FAKE_BODY.close.return_value = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _db() -> Session:
    return _db_mod.SessionLocal()


def _auth_token(email: str = "audit_tx@vaultkey.app", password: str = "AuditTx!99") -> str:
    reg = client.post("/api/auth/register", json={"email": email, "password": password})
    if reg.status_code == 400:
        login = client.post("/api/auth/login", json={"email": email, "password": password})
        assert login.status_code == 200, login.text
        return login.json()["access_token"]
    assert reg.status_code == 200, reg.text
    return reg.json()["access_token"]


def _upload(token: str) -> str:
    r = client.post(
        "/api/files",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("audit.pdf.enc", b"x" * 32, "application/octet-stream")},
        data={"original_filename": "audit.pdf", "iv_hex": "aabbccddeeff00112233445566778899"},
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _share(token: str, file_id: str, **kwargs) -> dict:
    payload = {"file_id": file_id, "max_downloads": 3, "access_mode": "download", **kwargs}
    r = client.post("/api/shares", headers={"Authorization": f"Bearer {token}"}, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def _revoke(token: str, share_id: str) -> None:
    r = client.post(f"/api/shares/{share_id}/revoke", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text


def _latest_log(db: Session, share_id: str, event: str) -> AccessLog | None:
    return (
        db.query(AccessLog)
        .filter(AccessLog.share_id == share_id, AccessLog.event == event)
        .order_by(AccessLog.timestamp.desc())
        .first()
    )


def _share_id(token_str: str) -> str:
    from app.security import hash_share_token
    h = hash_share_token(token_str)
    db = _db()
    try:
        s = db.query(ShareLink).filter(ShareLink.token_hash == h).first()
        assert s, f"Share not found for token {token_str!r}"
        return s.id
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Test class
# ---------------------------------------------------------------------------

class TestAuditTransactions(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.jwt = _auth_token()
        cls.file_id = _upload(cls.jwt)

    # 1. Successful download: FILE_DOWNLOADED row and counter increment
    #    are both present after the request (atomically committed together).
    def test_01_successful_download_audit_and_counter_are_consistent(self):
        s = _share(self.jwt, self.file_id, max_downloads=2)
        sid = _share_id(s["token"])

        # _open_body is the only R2 call in the download path; mock it out.
        fake = MagicMock()
        fake.iter_chunks.return_value = iter([b"data"])
        fake.close.return_value = None
        with patch("app.routes.access._open_body", return_value=fake):
            resp = client.post(f"/api/access/{s['token']}/download", json={})
        self.assertEqual(resp.status_code, 200, resp.text)

        db = _db()
        try:
            log = _latest_log(db, sid, "FILE_DOWNLOADED")
            self.assertIsNotNone(log, "FILE_DOWNLOADED row must exist after successful download")
            self.assertEqual(log.status, "SUCCESS")

            share_row = db.query(ShareLink).filter(ShareLink.id == sid).first()
            self.assertEqual(share_row.download_count, 1, "download_count must be incremented")
        finally:
            db.close()

    # 2. Failed download (wrong password): PASSWORD_FAILED row committed,
    #    download_count unchanged.
    def test_02_wrong_password_on_download_logs_denial_count_unchanged(self):
        s = _share(self.jwt, self.file_id, password="correct!")
        sid = _share_id(s["token"])

        resp = client.post(f"/api/access/{s['token']}/download", json={"password": "wrong!"})
        self.assertEqual(resp.status_code, 401, resp.text)

        db = _db()
        try:
            log = _latest_log(db, sid, "PASSWORD_FAILED")
            self.assertIsNotNone(log, "PASSWORD_FAILED row must exist after wrong-password download")
            self.assertEqual(log.status, "FAILED")

            share_row = db.query(ShareLink).filter(ShareLink.id == sid).first()
            self.assertEqual(share_row.download_count, 0, "download_count must be unchanged on auth failure")
        finally:
            db.close()

    # 3. Revoked link: ACCESS_DENIED row committed, HTTP 403 returned.
    def test_03_revoked_link_logs_access_denied_returns_403(self):
        s = _share(self.jwt, self.file_id)
        _revoke(self.jwt, s["share_id"])
        sid = _share_id(s["token"])

        resp = client.post(f"/api/access/{s['token']}/download", json={})
        self.assertEqual(resp.status_code, 403, resp.text)

        db = _db()
        try:
            log = _latest_log(db, sid, "ACCESS_DENIED")
            self.assertIsNotNone(log, "ACCESS_DENIED row must exist after revoked-link attempt")
            self.assertEqual(log.status, "DENIED")
        finally:
            db.close()

    # 4. Password failure on /authorize: PASSWORD_FAILED row committed,
    #    HTTP 401 returned.
    def test_04_wrong_password_on_authorize_logs_password_failed_returns_401(self):
        s = _share(self.jwt, self.file_id, password="secret!")
        sid = _share_id(s["token"])

        resp = client.post(f"/api/access/{s['token']}/authorize", json={"password": "wrong!"})
        self.assertEqual(resp.status_code, 401, resp.text)

        db = _db()
        try:
            log = _latest_log(db, sid, "PASSWORD_FAILED")
            self.assertIsNotNone(log, "PASSWORD_FAILED row must exist after failed /authorize")
            self.assertEqual(log.status, "FAILED")
        finally:
            db.close()

    # 5. Transaction rollback: patch db.commit to raise inside the request.
    #    Both the counter mutation and the AccessLog must be absent — they
    #    were staged in the same transaction and rolled back together.
    #
    #    The commit that fails is the first one inside download_encrypted_file
    #    (counter + FILE_DOWNLOADED audit log). _open_body is never reached
    #    because it is called AFTER db.commit() in the handler, so no R2
    #    mock is needed here.
    def test_05_commit_failure_rolls_back_counter_and_audit_log(self):
        s = _share(self.jwt, self.file_id, max_downloads=5)
        sid = _share_id(s["token"])

        call_count = {"n": 0}
        real_commit = _db_mod.SessionLocal.class_.commit

        def failing_commit(self_session):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise RuntimeError("simulated commit failure")
            return real_commit(self_session)

        with patch.object(_db_mod.SessionLocal.class_, "commit", failing_commit):
            resp = client.post(f"/api/access/{s['token']}/download", json={})

        self.assertNotEqual(resp.status_code, 200, "Request must not succeed when commit raises")

        db = _db()
        try:
            share_row = db.query(ShareLink).filter(ShareLink.id == sid).first()
            self.assertEqual(share_row.download_count, 0, "download_count must be unchanged after rollback")

            log = _latest_log(db, sid, "FILE_DOWNLOADED")
            self.assertIsNone(log, "FILE_DOWNLOADED row must not exist after rollback")
        finally:
            db.close()
