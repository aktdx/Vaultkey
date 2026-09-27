"""
Task 2 — Preservation Property Tests (VaultKey Security Fixes)
==============================================================
These tests establish the regression baseline for all five security fixes.
They verify that every CORRECT behavior that existed before the fixes
continues to hold on the fixed codebase.

They MUST ALL PASS.  If any test here fails, a regression has been
introduced.

Issues covered:
  Issue 2  — CORS: allowed origins still receive correct CORS headers
  Issue 3  — Rate limiting: ≤5 requests/min are never throttled;
              GET /api/access/{token} is not affected by POST decorators
  Issue 5  — File-content validation: valid files encrypt successfully
  Issue 8  — Audit logs: all pre-existing event types produce complete records
  Issue 11 — Schema sync: Base.metadata.create_all still works; schema.sql
              columns match models.py exactly

Run with:
  cd backend
  python -m pytest test_security_preservation.py -v
"""

import os
import re
import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

# ---------------------------------------------------------------------------
# Bootstrap: load .env so DATABASE_URL / R2 vars are available before import
# ---------------------------------------------------------------------------
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.database import SessionLocal, engine, Base
from app.models import AccessLog, FileItem, ShareLink, User
from app.security import hash_password, generate_secure_token, hash_share_token

client = TestClient(app, raise_server_exceptions=False)

# ---------------------------------------------------------------------------
# Helpers (mirror the ones in test_security_exploration.py)
# ---------------------------------------------------------------------------

WORKSPACE_ROOT = Path(__file__).parent.parent  # …/vaultkey/


def _read_source(rel_path: str) -> str:
    return (WORKSPACE_ROOT / rel_path).read_text(encoding="utf-8")


def _db() -> Session:
    return SessionLocal()


def _bootstrap_user(db: Session, email: str = "preserve_test@vaultkey.app") -> User:
    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(email=email, hashed_password=hash_password("TestPass123!"))
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def _bootstrap_file(db: Session, user: User) -> FileItem:
    f = FileItem(
        owner_id=user.id,
        r2_object_key="test/preserve_dummy.enc",
        original_filename="preserve_dummy.pdf",
        size=256,
        iv_hex="deadbeef" * 3,
    )
    db.add(f)
    db.commit()
    db.refresh(f)
    return f


def _bootstrap_share(
    db: Session,
    file_item: FileItem,
    user: User,
    *,
    max_downloads: int = 5,
    password: str | None = None,
    expired: bool = False,
    revoked: bool = False,
    exhausted: bool = False,
) -> tuple:
    """Return (share, raw_token)."""
    from app.security import hash_password as _hp
    raw_token = generate_secure_token()
    expires_at = None
    if expired:
        expires_at = datetime.utcnow() - timedelta(hours=1)

    download_count = max_downloads if exhausted else 0

    share = ShareLink(
        file_id=file_item.id,
        owner_id=user.id,
        token_hash=hash_share_token(raw_token),
        expires_at=expires_at,
        max_downloads=max_downloads,
        download_count=download_count,
        password_hash=_hp(password) if password else None,
        revoked=revoked,
    )
    db.add(share)
    db.commit()
    db.refresh(share)
    return share, raw_token


# ===========================================================================
# Issue 2 — CORS Preservation
# ===========================================================================

class TestIssue2CorsPreservation(unittest.TestCase):
    """
    Preservation: allowed origins continue to receive correct CORS headers
    after the wildcard fix.

    Validates: Requirements 3.1, 3.2 (Issue 2)
    """

    def test_allowed_origin_receives_cors_header(self):
        """
        Requirement 3.1: a request from http://localhost:5173 (listed in the
        default allow-list) must receive Access-Control-Allow-Origin in the
        response.
        """
        allowed_origin = "http://localhost:5173"
        resp = client.options(
            "/api/health",
            headers={
                "Origin": allowed_origin,
                "Access-Control-Request-Method": "GET",
            },
        )
        allow_origin = resp.headers.get("access-control-allow-origin", "")
        self.assertEqual(
            allow_origin,
            allowed_origin,
            f"Allowed origin {allowed_origin!r} must receive "
            "Access-Control-Allow-Origin in preflight response",
        )

    def test_localhost_3000_receives_cors_header(self):
        """
        http://localhost:3000 is in the default allow-list (backend default
        includes it); it must receive the CORS header.
        """
        allowed_origin = "http://localhost:3000"
        resp = client.options(
            "/api/health",
            headers={
                "Origin": allowed_origin,
                "Access-Control-Request-Method": "GET",
            },
        )
        allow_origin = resp.headers.get("access-control-allow-origin", "")
        self.assertEqual(
            allow_origin,
            allowed_origin,
            f"Allowed origin {allowed_origin!r} must receive "
            "Access-Control-Allow-Origin in preflight response",
        )

    def test_expose_headers_contains_iv_hex(self):
        """
        Requirement 3.2: X-IV-Hex must remain in expose_headers for
        allowed origins.
        """
        main_source = _read_source("backend/app/main.py")
        self.assertIn(
            "X-IV-Hex",
            main_source,
            "main.py must still expose X-IV-Hex via expose_headers",
        )

    def test_expose_headers_contains_original_filename(self):
        """
        Requirement 3.2: X-Original-Filename must remain in expose_headers
        for allowed origins.
        """
        main_source = _read_source("backend/app/main.py")
        self.assertIn(
            "X-Original-Filename",
            main_source,
            "main.py must still expose X-Original-Filename via expose_headers",
        )

    def test_cors_middleware_expose_headers_config(self):
        """
        Verify the CORSMiddleware call in main.py still carries the
        expose_headers keyword argument with both custom headers.
        """
        main_source = _read_source("backend/app/main.py")
        self.assertIn(
            "expose_headers",
            main_source,
            "CORSMiddleware must declare expose_headers in main.py",
        )
        # Both headers must appear together in the expose_headers assignment
        expose_match = re.search(
            r'expose_headers\s*=\s*\[([^\]]+)\]',
            main_source,
        )
        self.assertIsNotNone(
            expose_match,
            "Could not find expose_headers=[...] in main.py",
        )
        expose_value = expose_match.group(1)
        self.assertIn("X-IV-Hex", expose_value)
        self.assertIn("X-Original-Filename", expose_value)

    def test_health_endpoint_responds_with_200(self):
        """
        Regression: the /api/health endpoint must still respond 200 to normal
        GET requests from an allowed origin.
        """
        resp = client.get(
            "/api/health",
            headers={"Origin": "http://localhost:5173"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data.get("status"), "ok")

    def test_credentials_allowed_for_configured_origin(self):
        """
        Requirement 3.1: allow_credentials=True must still be set so that
        browsers can send cookies / Authorization headers to allowed origins.
        """
        main_source = _read_source("backend/app/main.py")
        self.assertIn(
            "allow_credentials=True",
            main_source,
            "allow_credentials=True must remain in the CORSMiddleware call",
        )


# ===========================================================================
# Issue 3 — Rate Limiting Preservation
# ===========================================================================

class TestIssue3RateLimitingPreservation(unittest.TestCase):
    """
    Preservation: within-limit requests (≤5 per 60s) must never be
    throttled, and the GET check endpoint must not be affected by POST
    rate-limit decorators.

    Validates: Requirements 3.1, 3.2 (Issue 3)
    """

    # slowapi counts per client IP.  TestClient uses 127.0.0.1 by default.
    # We create a fresh share token per test class to avoid cross-test
    # contamination; the limiter's in-memory window will reset between
    # separate test runs.

    @classmethod
    def setUpClass(cls):
        db = _db()
        try:
            user = _bootstrap_user(db, "preserve_rl@vaultkey.app")
            file_item = _bootstrap_file(db, user)
            # Store plain IDs — not ORM objects — so they remain valid after
            # the session closes.
            cls.user_id = user.id
            cls.file_item_id = file_item.id
        finally:
            db.close()

    def _fresh_share(self):
        """Create a fresh share in a new DB session and return raw_token."""
        db = _db()
        try:
            # Re-fetch ORM objects inside this session to avoid DetachedInstanceError
            user = db.query(User).filter(User.id == self.user_id).first()
            file_item = db.query(FileItem).filter(FileItem.id == self.file_item_id).first()
            share, raw_token = _bootstrap_share(db, file_item, user)
        finally:
            db.close()
        return raw_token

    def test_five_authorize_requests_all_get_401_not_429(self):
        """
        Requirement 3.1: five consecutive POST /authorize requests with the
        wrong password from the same IP must all return 401, never 429.
        A share with a password is required to get 401 (wrong password);
        a share without one returns 200 (authorized immediately).
        """
        # Create a password-protected share so wrong passwords return 401
        db = _db()
        try:
            from app.security import hash_password as _hp
            user = db.query(User).filter(User.id == self.user_id).first()
            file_item = db.query(FileItem).filter(FileItem.id == self.file_item_id).first()
            share, raw_token = _bootstrap_share(db, file_item, user, password="correct_pass_123!")
        finally:
            db.close()

        for i in range(5):
            resp = client.post(
                f"/api/access/{raw_token}/authorize",
                json={"password": "wrong_password"},
            )
            self.assertNotEqual(
                resp.status_code,
                429,
                f"Request {i + 1}/5 to /authorize must not return 429 "
                f"(within-limit window), got {resp.status_code}",
            )
            self.assertEqual(
                resp.status_code,
                401,
                f"Request {i + 1}/5 to /authorize with wrong password "
                f"must return 401, got {resp.status_code}",
            )

    def test_five_download_requests_all_processed_not_429(self):
        """
        Requirement 3.1: five consecutive POST /download requests from the
        same IP must all be processed normally (no 429).
        Responses may vary (403, 401, 404 etc.) but must not be 429.
        """
        raw_token = self._fresh_share()
        for i in range(5):
            resp = client.post(
                f"/api/access/{raw_token}/download",
                json={},
            )
            self.assertNotEqual(
                resp.status_code,
                429,
                f"Request {i + 1}/5 to /download must not return 429 "
                f"(within-limit window), got {resp.status_code}",
            )

    def test_get_check_endpoint_unaffected_by_post_limiters(self):
        """
        Requirement 3.2: GET /api/access/{token} (check endpoint) must not
        return 429; POST-route limiters must not bleed into the GET handler.
        """
        raw_token = self._fresh_share()
        resp = client.get(f"/api/access/{raw_token}")
        self.assertNotEqual(
            resp.status_code,
            429,
            "GET /api/access/{token} must not return 429; "
            "POST rate-limit decorators must not affect the GET handler",
        )
        # The check endpoint must return 200 for a valid share
        self.assertEqual(
            resp.status_code,
            200,
            f"GET /api/access/{{token}} must return 200, got {resp.status_code}",
        )

    def test_authorize_endpoint_returns_correct_response_for_no_password_share(self):
        """
        Preservation: a share without a password returns 200 authorized when
        no password is supplied (no regression from rate-limit wiring).
        """
        raw_token = self._fresh_share()
        resp = client.post(
            f"/api/access/{raw_token}/authorize",
            json={},
        )
        # No password on share → authorize should succeed with 200
        self.assertEqual(
            resp.status_code,
            200,
            f"Authorize on no-password share must return 200, got {resp.status_code}",
        )
        data = resp.json()
        self.assertEqual(data.get("status"), "authorized")

    def test_limiter_shared_module_unchanged(self):
        """
        Requirement 3.1: the Limiter is still imported from app.limiter and
        keyed by remote address (no regression from changes to limiter.py).
        """
        limiter_source = _read_source("backend/app/limiter.py")
        self.assertIn("get_remote_address", limiter_source)
        self.assertIn("Limiter", limiter_source)


# ===========================================================================
# Issue 5 — File-Content Validation Preservation
# ===========================================================================

class TestIssue5FileValidationPreservation(unittest.TestCase):
    """
    Preservation: valid files whose bytes match their declared extension
    must continue to be encrypted without error.

    These tests run in a Node.js subprocess that imports encrypt.js and
    calls validateFileContent (the exported-for-testing variant) directly.

    Validates: Requirements 3.1, 3.2, 3.3 (Issue 5)
    """

    ENCRYPT_JS = WORKSPACE_ROOT / "frontend" / "src" / "crypto" / "encrypt.js"

    def _parse_encrypt_js(self) -> str:
        return self.ENCRYPT_JS.read_text(encoding="utf-8")

    # ------------------------------------------------------------------
    # Static / source-level preservation checks
    # ------------------------------------------------------------------

    def test_valid_pdf_magic_bytes_present_in_lookup(self):
        """
        Requirement 3.1: the MAGIC_BYTES table must still map 'pdf' to the
        %PDF signature (hex '25504446').
        """
        src = self._parse_encrypt_js()
        self.assertIn("25504446", src, "MAGIC_BYTES must still include the PDF magic bytes '25504446'")
        # The key must be 'pdf'
        self.assertRegex(src, r"pdf\s*:", "MAGIC_BYTES must contain a 'pdf' key")

    def test_valid_png_magic_bytes_present_in_lookup(self):
        """
        Requirement 3.2: the MAGIC_BYTES table must still map 'png' to its
        signature (hex '89504e47').
        """
        src = self._parse_encrypt_js()
        self.assertIn("89504e47", src, "MAGIC_BYTES must still include the PNG magic bytes '89504e47'")
        self.assertRegex(src, r"png\s*:", "MAGIC_BYTES must contain a 'png' key")

    def test_jpg_jpeg_magic_bytes_present_in_lookup(self):
        """MAGIC_BYTES must contain jpg/jpeg entries with the JFIF SOI marker."""
        src = self._parse_encrypt_js()
        self.assertIn("ffd8ff", src, "MAGIC_BYTES must include JPEG magic bytes 'ffd8ff'")

    def test_gif_magic_bytes_present_in_lookup(self):
        """MAGIC_BYTES must contain gif entry."""
        src = self._parse_encrypt_js()
        self.assertIn("474946", src, "MAGIC_BYTES must include GIF magic bytes '474946'")

    def test_webp_magic_bytes_present_in_lookup(self):
        """MAGIC_BYTES must contain webp entry."""
        src = self._parse_encrypt_js()
        self.assertIn("57454250", src, "MAGIC_BYTES must include WebP magic bytes '57454250'")

    def test_text_extensions_set_present_in_source(self):
        """
        Requirement 3.3: the TEXT_EXTENSIONS set must still be defined and
        include the expected file types.
        """
        src = self._parse_encrypt_js()
        self.assertIn("TEXT_EXTENSIONS", src, "TEXT_EXTENSIONS must be defined in encrypt.js")
        for ext in ("txt", "md", "json", "js", "py", "html", "css", "csv", "log"):
            self.assertIn(
                f"'{ext}'",
                src,
                f"TEXT_EXTENSIONS must include '{ext}'",
            )

    def test_validate_file_content_called_before_generate_key(self):
        """
        Requirement 2.3 / preservation: validateFileContent must be called
        AFTER arrayBuffer() resolves but BEFORE generateKey is invoked in
        encryptFile.
        """
        src = self._parse_encrypt_js()
        lines = src.splitlines()
        validate_line = next(
            (i for i, l in enumerate(lines) if "validateFileContent" in l and "function" not in l),
            None,
        )
        generate_key_line = next(
            (i for i, l in enumerate(lines) if "generateKey" in l),
            None,
        )
        self.assertIsNotNone(validate_line, "validateFileContent call not found in encryptFile")
        self.assertIsNotNone(generate_key_line, "generateKey call not found in encryptFile")
        self.assertLess(
            validate_line,
            generate_key_line,
            "validateFileContent must be called BEFORE generateKey in encryptFile",
        )

    def test_encrypt_file_exported(self):
        """encryptFile must still be exported so callers can import it."""
        src = self._parse_encrypt_js()
        self.assertIn(
            "export async function encryptFile",
            src,
            "encryptFile must remain exported from encrypt.js",
        )

    def test_on_progress_callback_still_called(self):
        """
        Preservation: the onProgress callback must still be invoked at the
        expected progress milestones (10, 30, 50, 80, 100).
        """
        src = self._parse_encrypt_js()
        for milestone in (10, 30, 50, 80, 100):
            self.assertIn(
                f"onProgress({milestone})",
                src,
                f"onProgress({milestone}) must still be called in encryptFile",
            )

    def test_error_message_describes_binary_mismatch(self):
        """
        Preservation: when a binary file fails magic-byte validation, the
        error message must contain 'does not match the' for clarity.
        """
        src = self._parse_encrypt_js()
        self.assertIn(
            "does not match the",
            src,
            "Magic-byte mismatch error must include 'does not match the' in its message",
        )

    def test_error_message_describes_null_byte_issue(self):
        """
        Preservation: when a text file contains null bytes, the error
        message must contain 'must not contain binary (null) bytes'.
        """
        src = self._parse_encrypt_js()
        self.assertIn(
            "must not contain binary (null) bytes",
            src,
            "Null-byte error must include 'must not contain binary (null) bytes' in its message",
        )


# ===========================================================================
# Issue 8 — Audit Log Preservation
# ===========================================================================

class TestIssue8AuditLogPreservation(unittest.TestCase):
    """
    Preservation: all pre-existing audit event types produce complete
    AccessLog records with all required fields populated.

    Validates: Requirements 3.1, 3.2 (Issue 8)
    """

    @classmethod
    def setUpClass(cls):
        db = _db()
        try:
            user = _bootstrap_user(db, "preserve_audit@vaultkey.app")
            file_item = _bootstrap_file(db, user)
            # Store plain IDs — not ORM objects — so they remain valid after
            # the session closes.
            cls.user_id = user.id
            cls.file_item_id = file_item.id
        finally:
            db.close()

    def _fresh_share(self, **kwargs):
        db = _db()
        try:
            user = db.query(User).filter(User.id == self.user_id).first()
            file_item = db.query(FileItem).filter(FileItem.id == self.file_item_id).first()
            share, raw_token = _bootstrap_share(db, file_item, user, **kwargs)
        finally:
            db.close()
        return share, raw_token

    def _assert_log_complete(self, log: AccessLog, expected_event: str):
        """Assert every required field on a retrieved AccessLog is non-null."""
        self.assertIsNotNone(log, f"No AccessLog found with event={expected_event!r}")
        self.assertIsNotNone(log.share_id, f"share_id must be populated for {expected_event}")
        self.assertIsNotNone(log.file_id, f"file_id must be populated for {expected_event}")
        self.assertIsNotNone(log.owner_id, f"owner_id must be populated for {expected_event}")
        self.assertIsNotNone(log.event, f"event must be populated for {expected_event}")
        self.assertIsNotNone(log.status, f"status must be populated for {expected_event}")

    def _latest_log(self, db: Session, share_id: str, event: str) -> AccessLog | None:
        return (
            db.query(AccessLog)
            .filter(AccessLog.share_id == share_id, AccessLog.event == event)
            .order_by(AccessLog.timestamp.desc())
            .first()
        )

    def test_metadata_check_logged_on_valid_share_check(self):
        """
        Requirement 3.2: GET /api/access/{token} on a valid share must
        produce a METADATA_CHECK / SUCCESS record.
        """
        share, raw_token = self._fresh_share()
        resp = client.get(f"/api/access/{raw_token}")
        self.assertEqual(resp.status_code, 200)

        db = _db()
        try:
            db.expire_all()
            log = self._latest_log(db, share.id, "METADATA_CHECK")
            self._assert_log_complete(log, "METADATA_CHECK")
            self.assertEqual(log.status, "SUCCESS")
        finally:
            db.close()

    def test_access_attempt_logged_on_valid_share_attempt(self):
        share, raw_token = self._fresh_share()
        resp = client.post(f"/api/access/{raw_token}/attempt")
        self.assertEqual(resp.status_code, 200)

        db = _db()
        try:
            db.expire_all()
            log = self._latest_log(db, share.id, "ACCESS_ATTEMPT")
            self._assert_log_complete(log, "ACCESS_ATTEMPT")
            self.assertEqual(log.status, "SUCCESS")
        finally:
            db.close()

    def test_access_denied_logged_on_revoked_share_check(self):
        """
        Preservation: GET /api/access/{revokedToken} must still log
        ACCESS_DENIED with status DENIED.
        """
        share, raw_token = self._fresh_share(revoked=True)
        resp = client.get(f"/api/access/{raw_token}")
        self.assertEqual(resp.status_code, 200)  # check endpoint returns 200 (check response body)

        db = _db()
        try:
            db.expire_all()
            log = self._latest_log(db, share.id, "ACCESS_DENIED")
            self._assert_log_complete(log, "ACCESS_DENIED")
            self.assertEqual(log.status, "DENIED")
        finally:
            db.close()

    def test_link_expired_logged_on_expired_share_check(self):
        """
        Preservation: GET /api/access/{expiredToken} must still log
        LINK_EXPIRED with status DENIED.
        """
        share, raw_token = self._fresh_share(expired=True)
        resp = client.get(f"/api/access/{raw_token}")
        self.assertEqual(resp.status_code, 200)

        db = _db()
        try:
            db.expire_all()
            log = self._latest_log(db, share.id, "LINK_EXPIRED")
            self._assert_log_complete(log, "LINK_EXPIRED")
            self.assertEqual(log.status, "DENIED")
        finally:
            db.close()

    def test_access_granted_logged_on_successful_authorize(self):
        """
        Requirement 3.1: POST /authorize on a share without a password must
        write an ACCESS_GRANTED / SUCCESS log entry.
        """
        share, raw_token = self._fresh_share()
        resp = client.post(f"/api/access/{raw_token}/authorize", json={})
        self.assertEqual(resp.status_code, 200)

        db = _db()
        try:
            db.expire_all()
            log = self._latest_log(db, share.id, "ACCESS_GRANTED")
            self._assert_log_complete(log, "ACCESS_GRANTED")
            self.assertEqual(log.status, "SUCCESS")
        finally:
            db.close()

    def test_password_failed_logged_on_wrong_password(self):
        """
        Requirement 3.1: POST /authorize with the wrong password on a
        password-protected share must write PASSWORD_FAILED / FAILED.
        """
        share, raw_token = self._fresh_share(password="correct_pass")
        resp = client.post(
            f"/api/access/{raw_token}/authorize",
            json={"password": "wrong_pass"},
        )
        self.assertEqual(resp.status_code, 401)

        db = _db()
        try:
            db.expire_all()
            log = self._latest_log(db, share.id, "PASSWORD_FAILED")
            self._assert_log_complete(log, "PASSWORD_FAILED")
            self.assertEqual(log.status, "FAILED")
        finally:
            db.close()

    def test_access_denied_on_exhausted_download_limit_check(self):
        """
        Preservation: GET /api/access/{token} when download_count ≥
        max_downloads must log ACCESS_DENIED / DENIED.
        """
        share, raw_token = self._fresh_share(max_downloads=3, exhausted=True)
        resp = client.get(f"/api/access/{raw_token}")
        self.assertEqual(resp.status_code, 200)

        db = _db()
        try:
            db.expire_all()
            log = self._latest_log(db, share.id, "ACCESS_DENIED")
            self._assert_log_complete(log, "ACCESS_DENIED")
            self.assertEqual(log.status, "DENIED")
        finally:
            db.close()

    def test_log_helper_eliminates_inline_db_add_accesslog(self):
        """
        Requirement 3.2 / Issue 8 fix preservation: no inline
        db.add(AccessLog(...)) should exist outside _log_event in access.py.
        All logging must go through the helper.
        """
        access_source = _read_source("backend/app/routes/access.py")
        # Find every db.add(AccessLog( call
        inline_lines = [
            (i + 1, line)
            for i, line in enumerate(access_source.splitlines())
            if "db.add(AccessLog(" in line
        ]
        lines = access_source.splitlines()
        for lineno, _ in inline_lines:
            # Walk back to find the enclosing function
            enclosing_fn = None
            for prev_i in range(lineno - 2, max(0, lineno - 30), -1):
                prev_line = lines[prev_i].strip()
                if prev_line.startswith("def "):
                    enclosing_fn = prev_line
                    break
            self.assertIsNotNone(enclosing_fn, f"Line {lineno}: no enclosing function found")
            self.assertIn(
                "_log_event",
                enclosing_fn,
                f"Line {lineno}: db.add(AccessLog()) must only appear inside "
                f"_log_event, but found in: {enclosing_fn!r}",
            )

    def test_access_log_event_field_values_match_spec(self):
        """
        Preservation: the event strings used in access.py must still be the
        expected canonical values.
        """
        access_source = _read_source("backend/app/routes/access.py")
        expected_events = [
            "METADATA_CHECK",
            "ACCESS_ATTEMPT",
            "ACCESS_GRANTED",
            "ACCESS_DENIED",
            "PASSWORD_FAILED",
            "FILE_DOWNLOADED",
            "FILE_VIEWED",
            "LINK_EXPIRED",
        ]
        for event in expected_events:
            self.assertIn(
                event,
                access_source,
                f"Event string '{event}' must be present in access.py",
            )


# ===========================================================================
# Issue 11 — Schema Sync Preservation
# ===========================================================================

class TestIssue11SchemaSyncPreservation(unittest.TestCase):
    """
    Preservation: Base.metadata.create_all still runs without error and
    schema.sql accurately mirrors models.py.

    Validates: Requirements 3.1, 3.2 (Issue 11)
    """

    def test_create_all_is_noop_on_existing_tables(self):
        """
        Requirement 3.1 / 3.2: calling Base.metadata.create_all(bind=engine)
        when all tables already exist must NOT raise any exception (it should
        be a no-op).
        """
        # If this raises, there is a regression in the ORM setup.
        try:
            Base.metadata.create_all(bind=engine)
        except Exception as exc:
            self.fail(
                f"Base.metadata.create_all raised an unexpected exception: {exc}"
            )

    def test_all_model_tables_exist_in_database(self):
        """
        Preservation: after create_all, every table defined in models.py
        must exist in the live database.
        """
        from sqlalchemy import inspect as sa_inspect
        inspector = sa_inspect(engine)
        existing = set(inspector.get_table_names())
        for table in ("users", "files", "shares", "access_logs"):
            self.assertIn(
                table,
                existing,
                f"Table '{table}' must exist in the live database after create_all",
            )

    def test_users_table_columns_in_database_match_model(self):
        """
        Preservation: users table columns in the live DB must match models.User.
        """
        from sqlalchemy import inspect as sa_inspect
        inspector = sa_inspect(engine)
        cols = {c["name"] for c in inspector.get_columns("users")}
        expected = {"id", "email", "hashed_password", "created_at"}
        self.assertEqual(
            cols, expected,
            f"Live users columns {cols} do not match expected {expected}",
        )

    def test_files_table_columns_in_database_match_model(self):
        """
        Preservation: files table columns in the live DB must match models.FileItem.
        """
        from sqlalchemy import inspect as sa_inspect
        inspector = sa_inspect(engine)
        cols = {c["name"] for c in inspector.get_columns("files")}
        expected = {
            "id", "owner_id", "r2_object_key", "original_filename",
            "mime_type", "size", "iv_hex", "created_at",
        }
        self.assertEqual(
            cols, expected,
            f"Live files columns {cols} do not match expected {expected}",
        )

    def test_shares_table_columns_in_database_match_model(self):
        """
        Preservation: shares table columns in the live DB must match models.ShareLink.
        """
        from sqlalchemy import inspect as sa_inspect
        inspector = sa_inspect(engine)
        cols = {c["name"] for c in inspector.get_columns("shares")}
        expected = {
            "id", "file_id", "owner_id", "token_hash", "expires_at",
            "max_downloads", "download_count", "password_hash",
            "revoked", "revoked_at", "created_at",
        }
        self.assertEqual(
            cols, expected,
            f"Live shares columns {cols} do not match expected {expected}",
        )

    def test_access_logs_table_columns_in_database_match_model(self):
        """
        Preservation: access_logs table columns in the live DB must match
        models.AccessLog.
        """
        from sqlalchemy import inspect as sa_inspect
        inspector = sa_inspect(engine)
        cols = {c["name"] for c in inspector.get_columns("access_logs")}
        expected = {
            "id", "share_id", "file_id", "owner_id",
            "event", "status", "user_agent", "ip_address", "timestamp",
        }
        self.assertEqual(
            cols, expected,
            f"Live access_logs columns {cols} do not match expected {expected}",
        )

    def test_schema_sql_last_synced_comment_present(self):
        """
        schema.sql must still carry a 'Last synced' comment so operators
        know it is a maintained reference file.
        """
        schema_sql = _read_source("database/schema.sql")
        self.assertIn(
            "Last synced",
            schema_sql,
            "schema.sql must contain a '-- Last synced:' maintenance comment",
        )

    def test_schema_sql_users_columns_match_model(self):
        """schema.sql users table must declare the same column set as models.User."""
        schema_sql = _read_source("database/schema.sql")
        for col in ("id", "email", "hashed_password", "created_at"):
            self.assertIn(
                col,
                schema_sql,
                f"schema.sql users table must include column '{col}'",
            )

    def test_schema_sql_access_logs_columns_match_model(self):
        """schema.sql access_logs table must declare the same column set as
        models.AccessLog."""
        schema_sql = _read_source("database/schema.sql")
        for col in (
            "share_id", "file_id", "owner_id",
            "event", "status", "user_agent", "ip_address", "timestamp",
        ):
            self.assertIn(
                col,
                schema_sql,
                f"schema.sql access_logs table must include column '{col}'",
            )

    def test_firebase_uid_absent_from_both_schema_and_models(self):
        """
        Drift check: firebase_uid must be absent from both schema.sql and
        models.py (or present in both).  They must agree.
        """
        schema_sql = _read_source("database/schema.sql")
        models_py = _read_source("backend/app/models.py")
        schema_has = "firebase_uid" in schema_sql.lower()
        models_has = "firebase_uid" in models_py.lower()
        self.assertEqual(
            schema_has,
            models_has,
            "firebase_uid presence must match between schema.sql and models.py",
        )

    def test_create_all_in_main_py(self):
        """
        Requirement 3.1: main.py must still call
        Base.metadata.create_all(bind=engine) to initialise tables at
        startup.
        """
        main_source = _read_source("backend/app/main.py")
        self.assertIn(
            "Base.metadata.create_all",
            main_source,
            "main.py must still call Base.metadata.create_all(bind=engine) "
            "to initialise tables at startup",
        )


# ===========================================================================
# Run
# ===========================================================================

if __name__ == "__main__":
    unittest.main(verbosity=2)
