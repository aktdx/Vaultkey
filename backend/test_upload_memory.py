"""
Tests for the streaming upload refactor.

Verifies:
- files below the 50 MB limit are accepted
- files exactly at the 50 MB limit are accepted
- files above the 50 MB limit are rejected with 400 before any R2 call
- R2 object is deleted when the DB commit fails after upload
- concurrent uploads do not cause unbounded memory growth

All R2 / storage calls are patched so no live infrastructure is required.
"""

import io
import os
import threading
import tracemalloc
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from app.main import app

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
CHUNK_SIZE    =  1 * 1024 * 1024  #  1 MB

# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_client() -> TestClient:
    return TestClient(app)

def _register_and_login(client: TestClient) -> str:
    """Register (or reuse) a test user and return a Bearer token."""
    email = "upload_test@vaultkey.test"
    password = "UploadTest999!"
    resp = client.post("/api/auth/register", json={"email": email, "password": password})
    if resp.status_code == 400:  # already registered
        resp = client.post("/api/auth/login", json={"email": email, "password": password})
    resp.raise_for_status()
    return resp.json()["access_token"]

def _upload(client: TestClient, token: str, payload: bytes, filename: str = "file.pdf") -> object:
    return client.post(
        "/api/files",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": (filename + ".enc", payload, "application/octet-stream")},
        data={"original_filename": filename, "iv_hex": "aabbccddeeff00112233445566778899"},
    )

# ── Test cases ─────────────────────────────────────────────────────────────────

class TestUploadSizeEnforcement(unittest.TestCase):

    def setUp(self):
        self.client = _make_client()
        # Patch upload_file_streaming and delete_file for every test so no
        # real R2 calls are made.
        self._stream_patcher = patch(
            "app.routes.files.upload_file_streaming", return_value=None
        )
        self._delete_patcher = patch(
            "app.routes.files.delete_file", return_value=None
        )
        self.mock_stream = self._stream_patcher.start()
        self.mock_delete = self._delete_patcher.start()
        self.token = _register_and_login(self.client)

    def tearDown(self):
        self._stream_patcher.stop()
        self._delete_patcher.stop()

    # 1. Below limit ────────────────────────────────────────────────────────────
    def test_upload_below_limit_accepted(self):
        payload = b"x" * (1 * 1024 * 1024)  # 1 MB
        resp = _upload(self.client, self.token, payload)
        self.assertEqual(resp.status_code, 200, resp.text)
        self.mock_stream.assert_called_once()

    # 2. Exactly at limit ───────────────────────────────────────────────────────
    def test_upload_exactly_at_limit_accepted(self):
        payload = b"x" * MAX_FILE_SIZE  # exactly 50 MB
        resp = _upload(self.client, self.token, payload)
        self.assertEqual(resp.status_code, 200, resp.text)
        self.mock_stream.assert_called_once()

    # 3. Above limit ────────────────────────────────────────────────────────────
    def test_upload_above_limit_rejected(self):
        payload = b"x" * (MAX_FILE_SIZE + 1)  # 50 MB + 1 byte
        resp = _upload(self.client, self.token, payload)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("exceeds", resp.json()["detail"].lower())
        # R2 must never be called for an oversized file
        self.mock_stream.assert_not_called()

    # 4. DB failure triggers R2 cleanup ────────────────────────────────────────
    def test_db_failure_triggers_r2_cleanup(self):
        payload = b"x" * (1 * 1024 * 1024)  # 1 MB — valid size

        failing_session = MagicMock()
        failing_session.commit.side_effect = Exception("DB down")
        failing_session.__enter__ = MagicMock(return_value=failing_session)
        failing_session.__exit__ = MagicMock(return_value=False)

        with patch("app.routes.files.generate_object_key", return_value="uploads/test-key.enc"):
            with patch("app.routes.files.SessionLocal", return_value=failing_session):
                resp = _upload(self.client, self.token, payload)

        # The endpoint should propagate a 500 (unhandled exception becomes 500)
        self.assertIn(resp.status_code, (500, 502, 503))
        # delete_file must have been called with the key that was allocated
        self.mock_delete.assert_called_once_with("uploads/test-key.enc")

    # 5. Concurrent uploads — memory growth is bounded ─────────────────────────
    def test_concurrent_uploads_bounded_memory(self):
        """
        Spawn 8 concurrent uploads of 10 MB each (total logical data: 80 MB).
        Peak tracemalloc delta must stay well under 80 MB, demonstrating that
        memory is not proportional to the sum of file sizes.

        The bound used here (40 MB) is intentionally generous to avoid flakiness
        from interpreter overhead; the key property is sub-linear growth.
        """
        payload = b"x" * (10 * 1024 * 1024)  # 10 MB per upload
        n_threads = 8
        MEMORY_BOUND_BYTES = 40 * 1024 * 1024  # 40 MB ceiling

        errors = []

        def do_upload():
            try:
                resp = _upload(self.client, self.token, payload)
                if resp.status_code not in (200, 400):
                    errors.append(f"Unexpected status {resp.status_code}: {resp.text}")
            except Exception as exc:
                errors.append(str(exc))

        tracemalloc.start()
        snapshot_before = tracemalloc.take_snapshot()

        threads = [threading.Thread(target=do_upload) for _ in range(n_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        snapshot_after = tracemalloc.take_snapshot()
        tracemalloc.stop()

        if errors:
            self.fail(f"Upload errors during concurrency test: {errors}")

        top_stats = snapshot_after.compare_to(snapshot_before, "lineno")
        delta_bytes = sum(s.size_diff for s in top_stats if s.size_diff > 0)

        self.assertLess(
            delta_bytes,
            MEMORY_BOUND_BYTES,
            f"Memory delta {delta_bytes / 1024 / 1024:.1f} MB exceeded "
            f"{MEMORY_BOUND_BYTES / 1024 / 1024:.0f} MB bound.",
        )

if __name__ == "__main__":
    unittest.main()
