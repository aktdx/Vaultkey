"""
Proves that storage calls (upload, download, delete) run in a worker thread,
not on the event loop / main thread.

Also verifies that the boto3 client is configured with explicit timeouts.

Run with: pytest test_storage_threadpool.py -v
"""

import threading
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from app.main import app

def _make_client() -> TestClient:
    return TestClient(app)

def _register_and_login(client: TestClient) -> str:
    email = "threadpool_test@vaultkey.test"
    password = "ThreadPool999!"
    resp = client.post("/api/auth/register", json={"email": email, "password": password})
    if resp.status_code == 400:
        resp = client.post("/api/auth/login", json={"email": email, "password": password})
    resp.raise_for_status()
    return resp.json()["access_token"]

def _upload(client: TestClient, token: str) -> object:
    return client.post(
        "/api/files",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("proof.pdf.enc", b"x" * 1024, "application/octet-stream")},
        data={"original_filename": "proof.pdf", "iv_hex": "aabbccddeeff00112233445566778899"},
    )

class TestStorageRunsInThreadpool(unittest.TestCase):

    def setUp(self):
        self.client = _make_client()
        self.main_thread_id = threading.main_thread().ident
        self.token = _register_and_login(self.client)

    # ── upload runs off the event loop ────────────────────────────────────────

    def test_upload_runs_in_worker_thread(self):
        call_thread_ids = []

        def fake_upload(key, fileobj, content_type="application/octet-stream"):
            call_thread_ids.append(threading.current_thread().ident)

        with patch("app.routes.files.upload_file_streaming", side_effect=fake_upload):
            with patch("app.routes.files.delete_file", return_value=None):
                resp = _upload(self.client, self.token)

        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(len(call_thread_ids), 1)
        self.assertNotEqual(
            call_thread_ids[0],
            self.main_thread_id,
            "upload_file_streaming ran on the main thread — it must run in a worker thread",
        )

    # ── delete runs off the event loop ───────────────────────────────────────

    def test_delete_runs_in_worker_thread(self):
        # First create a real file record via a fully mocked upload.
        with patch("app.routes.files.upload_file_streaming", return_value=None):
            with patch("app.routes.files.delete_file", return_value=None):
                resp = _upload(self.client, self.token)
                self.assertEqual(resp.status_code, 200, resp.text)
                file_id = resp.json()["id"]

        call_thread_ids = []

        def fake_delete(key):
            call_thread_ids.append(threading.current_thread().ident)

        with patch("app.routes.files.delete_file", side_effect=fake_delete):
            resp = self.client.delete(
                f"/api/files/{file_id}",
                headers={"Authorization": f"Bearer {self.token}"},
            )

        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(len(call_thread_ids), 1)
        self.assertNotEqual(
            call_thread_ids[0],
            self.main_thread_id,
            "delete_file ran on the main thread — it must run in a worker thread",
        )

    # ── boto3 client has explicit timeouts ───────────────────────────────────

    def test_boto3_client_has_timeouts(self):
        # Reset the singleton so _get_client() builds a fresh one.
        import app.storage as storage_mod
        original_client = storage_mod._s3_client
        storage_mod._s3_client = None

        try:
            with patch.dict(
                "os.environ",
                {
                    "R2_ACCOUNT_ID":        "test",
                    "R2_ACCESS_KEY_ID":     "test",
                    "R2_SECRET_ACCESS_KEY": "test",
                    "R2_BUCKET_NAME":       "test",
                },
            ):
                client = storage_mod._get_client()
                cfg = client.meta.config
                self.assertIsNotNone(cfg, "boto3 client has no Config set")
                self.assertEqual(cfg.connect_timeout, 5)
                self.assertEqual(cfg.read_timeout, 60)
        finally:
            # Restore the original singleton so we don't pollute other tests.
            storage_mod._s3_client = original_client

if __name__ == "__main__":
    unittest.main()
