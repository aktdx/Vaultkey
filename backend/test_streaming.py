"""
Streaming contract tests for VaultKey's /download and /view endpoints.

These tests assert that:
  - Both endpoints return a StreamingResponse (not a buffered Response)
  - The R2 body is iterated in 1 MB chunks
  - The R2 body is closed after successful streaming
  - The R2 body is closed after an iterator failure (e.g. client disconnect)
  - Storage errors (404, 502) surface as HTTP errors before streaming starts
  - All required response headers are present
  - Access-mode enforcement (VIEW_ONLY vs DOWNLOAD) is unchanged

Run with: pytest test_streaming.py -v
"""

import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

# Override the SQLite engine to use StaticPool so all threads (including
# FastAPI's threadpool workers) share one in-memory connection and see the
# schema created by create_all.
import app.database as _db_mod
_test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_db_mod.engine = _test_engine
_db_mod.SessionLocal = _db_mod.sessionmaker(autocommit=False, autoflush=False, bind=_test_engine)

from app.main import app  # noqa: E402 — must come after engine override
from app.database import Base, engine


# ---------------------------------------------------------------------------
# Shared helpers (same pattern as test_storage_threadpool.py)
# ---------------------------------------------------------------------------

def _make_client() -> TestClient:
    return TestClient(app, raise_server_exceptions=False)


def _register_and_login(client: TestClient, email: str) -> str:
    password = "Streaming999!"
    resp = client.post("/api/auth/register", json={"email": email, "password": password})
    if resp.status_code == 400:
        # Already registered — try login instead
        resp = client.post("/api/auth/login", json={"email": email, "password": password})
    if not resp.is_success:
        raise RuntimeError(f"auth failed {resp.status_code}: {resp.text}")
    return resp.json()["access_token"]


def _upload(client: TestClient, token: str) -> str:
    """Upload a tiny dummy ciphertext and return the file_id."""
    resp = client.post(
        "/api/files",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("test.pdf.enc", b"x" * 64, "application/octet-stream")},
        data={"original_filename": "test.pdf", "iv_hex": "aabbccddeeff00112233445566778899"},
    )
    resp.raise_for_status()
    return resp.json()["id"]


def _create_share(client: TestClient, token: str, file_id: str, access_mode: str = "download") -> str:
    """Create a share link and return the share token."""
    # max_downloads=0 with access_mode="download" triggers legacy view_only override
    # in the shares endpoint (shares.py line ~50). Use 10 for download shares.
    max_dl = 10 if access_mode == "download" else 0
    resp = client.post(
        "/api/shares",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "file_id": file_id,
            "expiration_hours": 24,
            "max_downloads": max_dl,
            "access_mode": access_mode,
        },
    )
    resp.raise_for_status()
    return resp.json()["token"]


def _make_fake_body(data: bytes = b"hello streaming world") -> MagicMock:
    """Return a mock boto3 StreamingBody that yields data via iter_chunks."""
    body = MagicMock()

    def iter_chunks(chunk_size):
        offset = 0
        while offset < len(data):
            yield data[offset:offset + chunk_size]
            offset += chunk_size

    body.iter_chunks.side_effect = iter_chunks
    body.read.return_value = data
    return body


# ---------------------------------------------------------------------------
# Tests: storage layer — _open_body and open_file_stream
# ---------------------------------------------------------------------------

class TestOpenBodyAndStream(unittest.TestCase):

    def test_open_body_returns_streaming_body(self):
        """_open_body returns the StreamingBody; does not call close."""
        import app.storage as storage_mod
        fake_body = MagicMock()
        with patch.object(storage_mod, "_get_client") as mock_client:
            mock_client.return_value.get_object.return_value = {"Body": fake_body}
            result = storage_mod._open_body("uploads/test.enc")
        self.assertIs(result, fake_body)
        fake_body.close.assert_not_called()

    def test_open_body_raises_404_for_missing_key(self):
        """_open_body raises HTTPException(404) for NoSuchKey."""
        import app.storage as storage_mod
        from botocore.exceptions import ClientError
        err = {"Error": {"Code": "NoSuchKey", "Message": "Not found"}}
        with patch.object(storage_mod, "_get_client") as mock_client:
            mock_client.return_value.get_object.side_effect = ClientError(err, "GetObject")
            with self.assertRaises(HTTPException) as ctx:
                storage_mod._open_body("uploads/missing.enc")
        self.assertEqual(ctx.exception.status_code, 404)

    def test_open_body_raises_502_for_storage_error(self):
        """_open_body raises HTTPException(502) for non-404 R2 errors."""
        import app.storage as storage_mod
        from botocore.exceptions import ClientError
        err = {"Error": {"Code": "InternalError", "Message": "oops"}}
        with patch.object(storage_mod, "_get_client") as mock_client:
            mock_client.return_value.get_object.side_effect = ClientError(err, "GetObject")
            with self.assertRaises(HTTPException) as ctx:
                storage_mod._open_body("uploads/broken.enc")
        self.assertEqual(ctx.exception.status_code, 502)

    def test_open_file_stream_closes_body_on_normal_exit(self):
        """open_file_stream closes the body on clean exit."""
        import app.storage as storage_mod
        fake_body = MagicMock()
        with patch.object(storage_mod, "_get_client") as mock_client:
            mock_client.return_value.get_object.return_value = {"Body": fake_body}
            with storage_mod.open_file_stream("uploads/test.enc"):
                pass
        fake_body.close.assert_called_once()

    def test_open_file_stream_closes_body_on_exception(self):
        """open_file_stream closes the body even when an exception is raised inside."""
        import app.storage as storage_mod
        fake_body = MagicMock()
        with patch.object(storage_mod, "_get_client") as mock_client:
            mock_client.return_value.get_object.return_value = {"Body": fake_body}
            with self.assertRaises(RuntimeError):
                with storage_mod.open_file_stream("uploads/test.enc"):
                    raise RuntimeError("something went wrong")
        fake_body.close.assert_called_once()


# ---------------------------------------------------------------------------
# Tests: /download endpoint streaming behaviour
# ---------------------------------------------------------------------------

class TestStreamingDownload(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        cls.client = _make_client()
        cls.auth_token = _register_and_login(cls.client, "stream_dl_test@vaultkey.app")
        with patch("app.routes.files.upload_file_streaming", return_value=None):
            with patch("app.routes.files.delete_file", return_value=None):
                cls.file_id = _upload(cls.client, cls.auth_token)
        cls.share_token = _create_share(cls.client, cls.auth_token, cls.file_id, "download")

    def setUp(self):
        self.client = self.__class__.client
        self.token = self.__class__.auth_token
        self.file_id = self.__class__.file_id
        # Fresh share token per test avoids the 5/minute rate limit bucket
        # being exhausted across multiple tests hitting the same endpoint.
        self.share_token = _create_share(self.client, self.token, self.file_id, "download")

    def _call_download(self, body=None):
        body = body or _make_fake_body(b"ciphertext payload")
        with patch("app.routes.access._open_body", return_value=body):
            resp = self.client.post(
                f"/api/access/{self.share_token}/download",
                json={"password": None},
            )
        return resp, body

    def test_response_status_200(self):
        resp, _ = self._call_download()
        self.assertEqual(resp.status_code, 200)

    def test_response_body_assembles_correctly(self):
        data = b"full ciphertext bytes for download"
        body = _make_fake_body(data)
        with patch("app.routes.access._open_body", return_value=body):
            resp = self.client.post(
                f"/api/access/{self.share_token}/download",
                json={"password": None},
            )
        self.assertEqual(resp.content, data)

    def test_chunk_size_is_1_mb(self):
        """iter_chunks is called with exactly 1 MiB (1 048 576 bytes)."""
        body = _make_fake_body(b"x" * 10)
        with patch("app.routes.access._open_body", return_value=body):
            self.client.post(
                f"/api/access/{self.share_token}/download",
                json={"password": None},
            )
        body.iter_chunks.assert_called_once_with(1 * 1024 * 1024)

    def test_body_closed_after_success(self):
        resp, body = self._call_download()
        self.assertEqual(resp.status_code, 200)
        body.close.assert_called_once()

    def test_header_x_iv_hex_present(self):
        resp, _ = self._call_download()
        self.assertIn("x-iv-hex", resp.headers)

    def test_header_x_original_filename_present(self):
        resp, _ = self._call_download()
        self.assertIn("x-original-filename", resp.headers)

    def test_header_x_mime_type_present(self):
        resp, _ = self._call_download()
        self.assertIn("x-mime-type", resp.headers)

    def test_header_content_disposition_is_attachment(self):
        resp, _ = self._call_download()
        self.assertIn("content-disposition", resp.headers)
        self.assertIn("attachment", resp.headers["content-disposition"])

    def test_view_only_token_rejected_with_403(self):
        view_token = _create_share(self.client, self.token, self.file_id, "view_only")
        resp = self.client.post(
            f"/api/access/{view_token}/download",
            json={"password": None},
        )
        self.assertEqual(resp.status_code, 403)

    def test_storage_404_surfaces_before_stream(self):
        with patch("app.routes.access._open_body",
                   side_effect=HTTPException(status_code=404, detail="missing")):
            resp = self.client.post(
                f"/api/access/{self.share_token}/download",
                json={"password": None},
            )
        self.assertEqual(resp.status_code, 404)

    def test_storage_502_surfaces_before_stream(self):
        with patch("app.routes.access._open_body",
                   side_effect=HTTPException(status_code=502, detail="r2 error")):
            resp = self.client.post(
                f"/api/access/{self.share_token}/download",
                json={"password": None},
            )
        self.assertEqual(resp.status_code, 502)

    def test_body_closed_on_iterator_error(self):
        """R2 body is closed even when iter_chunks raises mid-stream."""
        body = MagicMock()

        def iter_chunks_raises(chunk_size):
            yield b"first chunk"
            raise RuntimeError("network dropped")

        body.iter_chunks.side_effect = iter_chunks_raises

        with patch("app.routes.access._open_body", return_value=body):
            try:
                self.client.post(
                    f"/api/access/{self.share_token}/download",
                    json={"password": None},
                )
            except Exception:
                pass  # TestClient may re-raise mid-stream errors

        body.close.assert_called_once()


# ---------------------------------------------------------------------------
# Tests: /view endpoint streaming behaviour
# ---------------------------------------------------------------------------

class TestStreamingView(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        cls.client = _make_client()
        cls.auth_token = _register_and_login(cls.client, "stream_view_test@vaultkey.app")
        with patch("app.routes.files.upload_file_streaming", return_value=None):
            with patch("app.routes.files.delete_file", return_value=None):
                cls.file_id = _upload(cls.client, cls.auth_token)
        cls.share_token = _create_share(cls.client, cls.auth_token, cls.file_id, "view_only")

    def setUp(self):
        self.client = self.__class__.client
        self.token = self.__class__.auth_token
        self.file_id = self.__class__.file_id
        # Fresh share token per test avoids the 5/minute rate limit bucket
        # being exhausted across multiple tests hitting the same endpoint.
        self.share_token = _create_share(self.client, self.token, self.file_id, "view_only")

    def _call_view(self, body=None):
        body = body or _make_fake_body(b"view-only ciphertext")
        with patch("app.routes.access._open_body", return_value=body):
            resp = self.client.post(
                f"/api/access/{self.share_token}/view",
                json={"password": None},
            )
        return resp, body

    def test_response_status_200(self):
        resp, _ = self._call_view()
        self.assertEqual(resp.status_code, 200)

    def test_response_body_assembles_correctly(self):
        data = b"view only encrypted bytes"
        body = _make_fake_body(data)
        with patch("app.routes.access._open_body", return_value=body):
            resp = self.client.post(
                f"/api/access/{self.share_token}/view",
                json={"password": None},
            )
        self.assertEqual(resp.content, data)

    def test_chunk_size_is_1_mb(self):
        body = _make_fake_body(b"x" * 10)
        with patch("app.routes.access._open_body", return_value=body):
            self.client.post(
                f"/api/access/{self.share_token}/view",
                json={"password": None},
            )
        body.iter_chunks.assert_called_once_with(1 * 1024 * 1024)

    def test_body_closed_after_success(self):
        resp, body = self._call_view()
        self.assertEqual(resp.status_code, 200)
        body.close.assert_called_once()

    def test_header_x_iv_hex_present(self):
        resp, _ = self._call_view()
        self.assertIn("x-iv-hex", resp.headers)

    def test_header_x_original_filename_present(self):
        resp, _ = self._call_view()
        self.assertIn("x-original-filename", resp.headers)

    def test_header_x_mime_type_present(self):
        resp, _ = self._call_view()
        self.assertIn("x-mime-type", resp.headers)

    def test_no_content_disposition_header(self):
        """View endpoint must NOT include Content-Disposition: attachment."""
        resp, _ = self._call_view()
        self.assertNotIn("content-disposition", resp.headers)

    def test_download_token_rejected_with_400(self):
        dl_token = _create_share(self.client, self.token, self.file_id, "download")
        resp = self.client.post(
            f"/api/access/{dl_token}/view",
            json={"password": None},
        )
        self.assertEqual(resp.status_code, 400)

    def test_storage_404_surfaces_before_stream(self):
        with patch("app.routes.access._open_body",
                   side_effect=HTTPException(status_code=404, detail="missing")):
            resp = self.client.post(
                f"/api/access/{self.share_token}/view",
                json={"password": None},
            )
        self.assertEqual(resp.status_code, 404)

    def test_body_closed_on_iterator_error(self):
        """R2 body is closed even when iter_chunks raises mid-stream."""
        body = MagicMock()

        def iter_chunks_raises(chunk_size):
            yield b"first chunk"
            raise RuntimeError("network dropped")

        body.iter_chunks.side_effect = iter_chunks_raises

        with patch("app.routes.access._open_body", return_value=body):
            try:
                self.client.post(
                    f"/api/access/{self.share_token}/view",
                    json={"password": None},
                )
            except Exception:
                pass

        body.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
