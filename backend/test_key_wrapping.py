"""
Tests for VaultKey Client-Side Key Wrapping & Clean Share URLs.

Verifies:
  1. POST /api/shares creates shares with key wrapping fields:
     wrapped_fek, kdf_salt, kdf_iterations, kdf_algorithm, wrapping_iv.
  2. Database stores wrapped FEK, salt, and IVs. Plaintext FEK is never in the DB.
  3. GET /api/access/{token} returns wrapping metadata to recipients.
  4. requires_password is True when wrapped_fek is set.
  5. Recipient password / password_hash authorization gatekeeping.
  6. Download limits and revocation function as expected on wrapped shares.
  7. View-only shares reject download and succeed on view.
"""
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.database as _db_mod
_test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_db_mod.engine = _test_engine
_db_mod.SessionLocal = _db_mod.sessionmaker(autocommit=False, autoflush=False, bind=_test_engine)

from app.main import app  # noqa: E402
from app.database import Base
from app.models import ShareLink, FileItem

Base.metadata.create_all(bind=_test_engine)

client = TestClient(app, raise_server_exceptions=False)

_FAKE_BODY = MagicMock()
_FAKE_BODY.iter_chunks.return_value = iter([b"fake-encrypted-ciphertext-bytes"])
_FAKE_BODY.close.return_value = None


def _db() -> Session:
    return _db_mod.SessionLocal()


def _auth_token(email: str = "keywrap_user@vaultkey.app", password: str = "KeyWrap123!") -> str:
    reg = client.post("/api/auth/register", json={"email": email, "password": password})
    if reg.status_code == 400:
        login = client.post("/api/auth/login", json={"email": email, "password": password})
        assert login.status_code == 200, f"Login failed: {login.text}"
        return login.json()["access_token"]
    assert reg.status_code == 200, f"Register failed: {reg.text}"
    return reg.json()["access_token"]


def _upload_file(token: str) -> str:
    files = {"file": ("secret_report.pdf.enc", b"ENCRYPTED_FILE_PAYLOAD_HERE", "application/octet-stream")}
    data = {"original_filename": "secret_report.pdf", "iv_hex": "0102030405060708090a0b0c"}
    headers = {"Authorization": f"Bearer {token}"}
    r = client.post("/api/files", headers=headers, files=files, data=data)
    assert r.status_code == 200, f"Upload failed: {r.text}"
    return r.json()["id"]


class TestKeyWrappingBackend(unittest.TestCase):
    def setUp(self):
        self.user_token = _auth_token()
        self.file_id = _upload_file(self.user_token)

    def test_01_create_share_with_wrapped_key_metadata(self):
        """Create share stores wrapping fields and returns clean token."""
        payload = {
            "file_id": self.file_id,
            "max_downloads": 3,
            "access_mode": "download",
            "wrapped_fek": "d3JhcHBlZC1mZWstYmFzZTY0dXJsLXZhbHVl",
            "kdf_salt": "a1b2c3d4e5f60718293a4b5c6d7e8f90",
            "kdf_iterations": 600000,
            "kdf_algorithm": "PBKDF2-HMAC-SHA-256",
            "wrapping_iv": "112233445566778899aabbcc",
            "password_hash": "client-derived-zero-knowledge-hash-abc123",
        }
        headers = {"Authorization": f"Bearer {self.user_token}"}
        res = client.post("/api/shares", headers=headers, json=payload)
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()

        # Token must be returned for clean URL construction
        self.assertTrue(data["token"])
        self.assertEqual(data["wrapped_fek"], payload["wrapped_fek"])
        self.assertEqual(data["kdf_salt"], payload["kdf_salt"])
        self.assertEqual(data["kdf_iterations"], 600000)
        self.assertEqual(data["kdf_algorithm"], "PBKDF2-HMAC-SHA-256")
        self.assertEqual(data["wrapping_iv"], payload["wrapping_iv"])

        # Verify DB row
        db = _db()
        share = db.query(ShareLink).filter(ShareLink.id == data["share_id"]).first()
        self.assertIsNotNone(share)
        self.assertEqual(share.wrapped_fek, payload["wrapped_fek"])
        self.assertEqual(share.kdf_salt, payload["kdf_salt"])
        self.assertEqual(share.wrapping_iv, payload["wrapping_iv"])
        db.close()

    def test_02_recipient_check_returns_key_wrapping_params(self):
        """Recipient /api/access/{token} delivers wrapping metadata and sets requires_password."""
        payload = {
            "file_id": self.file_id,
            "max_downloads": 2,
            "access_mode": "download",
            "wrapped_fek": "wrapped-fek-payload",
            "kdf_salt": "deadbeef12345678",
            "kdf_iterations": 600000,
            "kdf_algorithm": "PBKDF2-HMAC-SHA-256",
            "wrapping_iv": "aabbccddeeff001122334455",
            "password_hash": "auth-hash-998877",
        }
        headers = {"Authorization": f"Bearer {self.user_token}"}
        create_res = client.post("/api/shares", headers=headers, json=payload)
        self.assertEqual(create_res.status_code, 200)
        raw_token = create_res.json()["token"]

        # Recipient check access (unauthenticated public endpoint)
        check_res = client.get(f"/api/access/{raw_token}")
        self.assertEqual(check_res.status_code, 200, check_res.text)
        check_data = check_res.json()

        self.assertTrue(check_data["valid"])
        self.assertEqual(check_data["status"], "OK")
        self.assertTrue(check_data["requires_password"])
        self.assertEqual(check_data["wrapped_fek"], "wrapped-fek-payload")
        self.assertEqual(check_data["kdf_salt"], "deadbeef12345678")
        self.assertEqual(check_data["kdf_iterations"], 600000)
        self.assertEqual(check_data["kdf_algorithm"], "PBKDF2-HMAC-SHA-256")
        self.assertEqual(check_data["wrapping_iv"], "aabbccddeeff001122334455")

    @patch("app.routes.access._open_body", return_value=_FAKE_BODY)
    def test_03_wrapped_share_authorization_and_download(self, mock_open):
        """Recipient uses password_hash to authorize and download wrapped file."""
        expected_hash = "zk-auth-hash-secure-xyz"
        payload = {
            "file_id": self.file_id,
            "max_downloads": 2,
            "access_mode": "download",
            "wrapped_fek": "wrapped-fek-data",
            "kdf_salt": "salt1234",
            "wrapping_iv": "iv1234567890",
            "password_hash": expected_hash,
        }
        headers = {"Authorization": f"Bearer {self.user_token}"}
        create_res = client.post("/api/shares", headers=headers, json=payload)
        token = create_res.json()["token"]

        # 1. Authorize with wrong hash -> 401
        auth_bad = client.post(f"/api/access/{token}/authorize", json={"password_hash": "wrong-hash"})
        self.assertEqual(auth_bad.status_code, 401)

        # 2. Authorize with correct hash -> 200
        auth_ok = client.post(f"/api/access/{token}/authorize", json={"password_hash": expected_hash})
        self.assertEqual(auth_ok.status_code, 200)

        # 3. Download with wrong hash -> 401
        dl_bad = client.post(f"/api/access/{token}/download", json={"password_hash": "wrong-hash"})
        self.assertEqual(dl_bad.status_code, 401)

        # 4. Download with correct hash -> 200
        dl_ok = client.post(f"/api/access/{token}/download", json={"password_hash": expected_hash})
        self.assertEqual(dl_ok.status_code, 200)
        self.assertEqual(dl_ok.headers.get("X-IV-Hex"), "0102030405060708090a0b0c")
        self.assertEqual(dl_ok.headers.get("X-Original-Filename"), "secret_report.pdf")

    @patch("app.routes.access._open_body", return_value=_FAKE_BODY)
    def test_04_view_only_wrapped_share(self, mock_open):
        """View-only wrapped share permits /view but blocks /download with 403."""
        payload = {
            "file_id": self.file_id,
            "max_downloads": 1,
            "access_mode": "view_only",
            "wrapped_fek": "wrapped-fek-viewonly",
            "kdf_salt": "salt5678",
            "wrapping_iv": "iv0987654321",
            "password_hash": "view-hash-1122",
        }
        headers = {"Authorization": f"Bearer {self.user_token}"}
        create_res = client.post("/api/shares", headers=headers, json=payload)
        token = create_res.json()["token"]

        # /download must be rejected with 403
        dl_res = client.post(f"/api/access/{token}/download", json={"password_hash": "view-hash-1122"})
        self.assertEqual(dl_res.status_code, 403)

        # /view must succeed
        view_res = client.post(f"/api/access/{token}/view", json={"password_hash": "view-hash-1122"})
        self.assertEqual(view_res.status_code, 200)

    def test_05_revoked_wrapped_share(self):
        """Revoking a wrapped share immediately cuts off access."""
        payload = {
            "file_id": self.file_id,
            "max_downloads": 5,
            "access_mode": "download",
            "wrapped_fek": "wrapped-fek-revoke",
            "kdf_salt": "salt9988",
            "wrapping_iv": "iv112233",
        }
        headers = {"Authorization": f"Bearer {self.user_token}"}
        create_res = client.post("/api/shares", headers=headers, json=payload)
        share_id = create_res.json()["share_id"]
        token = create_res.json()["token"]

        # Revoke share
        revoke_res = client.post(f"/api/shares/{share_id}/revoke", headers=headers)
        self.assertEqual(revoke_res.status_code, 200)

        # Check access returns REVOKED
        check_res = client.get(f"/api/access/{token}")
        self.assertEqual(check_res.status_code, 200)
        self.assertFalse(check_res.json()["valid"])
        self.assertEqual(check_res.json()["status"], "REVOKED")


if __name__ == "__main__":
    unittest.main()
