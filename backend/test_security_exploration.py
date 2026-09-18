"""
Task 1 — Bug Condition Exploration Tests (VaultKey Security Fixes)
==================================================================
These tests verify that every security fix is in place.
They are written to PASS on the fixed codebase, confirming each
bug has been resolved.

Issues covered:
  Issue 2  — CORS Wildcard Enabled
  Issue 3  — No Rate Limiting on Public Access Endpoints
  Issue 8  — Missing Audit Log Entries on Revoked/Expired Downloads
  Issue 11 — database/schema.sql Out of Sync with models.py

Run with:
  cd backend
  python -m pytest test_security_exploration.py -v
"""

import ast
import os
import re
import sys
import textwrap
import unittest
from datetime import datetime, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Bootstrap: load .env so DATABASE_URL is available before importing the app
# ---------------------------------------------------------------------------
from dotenv import load_dotenv  # pip install python-dotenv (already in requirements)
load_dotenv(Path(__file__).parent / ".env")

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

# Import app after env is loaded
from app.main import app
from app.database import SessionLocal
from app.models import AccessLog, FileItem, ShareLink, User
from app.security import hash_password, generate_secure_token, hash_share_token

client = TestClient(app, raise_server_exceptions=False)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

WORKSPACE_ROOT = Path(__file__).parent.parent  # …/vaultkey/


def _read_source(rel_path: str) -> str:
    return (WORKSPACE_ROOT / rel_path).read_text(encoding="utf-8")


def _db() -> Session:
    return SessionLocal()


def _bootstrap_user(db: Session, email: str = "explore_test@vaultkey.app") -> tuple:
    """Return (user, raw_token) for a test user, creating if needed."""
    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(email=email, hashed_password=hash_password("TestPass123!"))
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def _bootstrap_file(db: Session, user: User) -> FileItem:
    """Create a minimal FileItem for the test user (no R2 upload needed)."""
    f = FileItem(
        owner_id=user.id,
        r2_object_key="test/dummy.enc",
        original_filename="dummy.pdf",
        size=128,
        iv_hex="aabbccdd" * 3,
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
    revoked: bool = False,
    expired: bool = False,
    max_downloads: int = 5,
) -> tuple:
    """Return (share, raw_token) for a fresh ShareLink."""
    raw_token = generate_secure_token()
    expires_at = None
    if expired:
        expires_at = datetime.utcnow() - timedelta(hours=1)  # already in the past

    share = ShareLink(
        file_id=file_item.id,
        owner_id=user.id,
        token_hash=hash_share_token(raw_token),
        expires_at=expires_at,
        max_downloads=max_downloads,
        download_count=0,
        revoked=revoked,
    )
    db.add(share)
    db.commit()
    db.refresh(share)
    return share, raw_token


# ===========================================================================
# Issue 2 — CORS Wildcard
# ===========================================================================

class TestIssue2CorsWildcard(unittest.TestCase):
    """
    Bug condition: '*' present in the origins list in main.py.
    Fixed state:   Origins are env-driven; no wildcard exists.

    Validates: Requirements 2.1, 2.2, 2.3 (Issue 2)
    """

    def test_no_wildcard_in_origins_list(self):
        """
        isBugCondition_2: '*' IN origins_list
        Fixed: '*' must NOT be present anywhere in the CORS origins.
        """
        main_source = _read_source("backend/app/main.py")

        # Parse the origins assignment to verify it comes from os.environ.get
        self.assertIn(
            "os.environ.get",
            main_source,
            "origins must be driven by os.environ.get('ALLOWED_ORIGINS', ...)",
        )

        # No wildcard string literal should appear as an origin value
        # (Allow the word '*' only if it appears inside a comment or a method='*' context)
        tree = ast.parse(main_source)
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and node.value == "*":
                # Check if it's the allow_methods="*" or allow_headers="*" — those are OK.
                # We look for it as an element of the origins list or as the default string.
                # The simplest safe check: ensure it never appears as a standalone str constant
                # that is NOT inside allow_methods / allow_headers keyword.
                # We flag the test failure only when we see it as part of the allow_origins arg.
                pass  # We do a string-level check below which is sufficient.

        # String-level: the literal '["*"]' or '"*"' as an origins value must not exist.
        self.assertNotIn(
            '"*"',
            # Strip comment lines first to avoid false positives
            "\n".join(
                line for line in main_source.splitlines() if not line.strip().startswith("#")
            ).replace("allow_methods=[\"*\"]", "")
             .replace('allow_methods=["*"]', "")
             .replace("allow_headers=[\"*\"]", "")
             .replace('allow_headers=["*"]', ""),
            'Wildcard "*" must not appear as an allowed origin in main.py',
        )

    def test_allowed_origins_env_var_used(self):
        """
        Origins list must be derived from the ALLOWED_ORIGINS env var.
        Requirement 2.2: server reads ALLOWED_ORIGINS at startup and splits on commas.
        """
        main_source = _read_source("backend/app/main.py")
        self.assertIn(
            "ALLOWED_ORIGINS",
            main_source,
            "main.py must reference the ALLOWED_ORIGINS environment variable",
        )
        # The actual .split call may be '.split(",")' or '.split(",",...)' — check for the common prefix
        self.assertTrue(
            '.split(",")' in main_source or '.split(",",)' in main_source or '.split(",")' in main_source,
            "Origins list must be built by splitting the ALLOWED_ORIGINS value on commas",
        )
        # Verify the split call IS present in some form
        self.assertRegex(
            main_source,
            r'\.split\(","\)',
            "Origins list must be built by .split(',') on the ALLOWED_ORIGINS value",
        )

    def test_fallback_defaults_no_wildcard(self):
        """
        Requirement 2.3: default value when ALLOWED_ORIGINS is unset must not include '*'.
        """
        main_source = _read_source("backend/app/main.py")
        # Find the os.environ.get call and extract its default argument string
        match = re.search(
            r'os\.environ\.get\(\s*"ALLOWED_ORIGINS"[^)]*,\s*"([^"]+)"',
            main_source,
        )
        self.assertIsNotNone(
            match,
            "Could not find os.environ.get('ALLOWED_ORIGINS', '<default>') in main.py",
        )
        default_origins = match.group(1)
        self.assertNotIn(
            "*",
            default_origins,
            f"Default ALLOWED_ORIGINS must not contain '*', got: {default_origins}",
        )

    def test_env_example_documents_allowed_origins(self):
        """
        Requirement 2.2/2.3: .env.example must document ALLOWED_ORIGINS without a wildcard.
        """
        env_example = _read_source("backend/.env.example")
        self.assertIn(
            "ALLOWED_ORIGINS",
            env_example,
            ".env.example must document the ALLOWED_ORIGINS variable",
        )
        # Extract the example value
        for line in env_example.splitlines():
            if line.strip().startswith("ALLOWED_ORIGINS="):
                value = line.split("=", 1)[1]
                self.assertNotIn(
                    "*",
                    value,
                    f"ALLOWED_ORIGINS in .env.example must not contain '*', got: {value}",
                )
                break

    def test_cors_rejects_unconfigured_origin(self):
        """
        Requirement 2.1: requests from origins NOT in ALLOWED_ORIGINS must not receive
        Access-Control-Allow-Origin in the response.
        """
        evil_origin = "http://evil.example.com"
        resp = client.options(
            "/api/health",
            headers={
                "Origin": evil_origin,
                "Access-Control-Request-Method": "GET",
            },
        )
        allow_origin = resp.headers.get("access-control-allow-origin", "")
        self.assertNotEqual(
            allow_origin,
            evil_origin,
            f"Evil origin {evil_origin!r} must NOT receive Access-Control-Allow-Origin",
        )
        self.assertNotEqual(
            allow_origin,
            "*",
            "Wildcard '*' must never be returned as Access-Control-Allow-Origin",
        )

    def test_cors_allows_configured_origin(self):
        """
        Regression (Requirement 3.1/3.2): http://localhost:5173 must still receive
        the correct CORS header and expose-headers.
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
            f"Allowed origin {allowed_origin!r} must receive Access-Control-Allow-Origin",
        )


# ===========================================================================
# Issue 3 — Rate Limiting on Public Access Endpoints
# ===========================================================================

class TestIssue3RateLimiting(unittest.TestCase):
    """
    Bug condition: no rate-limit decorators on /authorize and /download endpoints.
    Fixed state:   Both endpoints are decorated with @limiter.limit("5/minute").

    Validates: Requirements 2.1, 2.2, 2.3 (Issue 3)
    """

    def test_slowapi_in_requirements(self):
        """slowapi and limits must be present in requirements.txt."""
        req = _read_source("backend/requirements.txt")
        self.assertIn("slowapi", req, "slowapi must be listed in requirements.txt")
        self.assertIn("limits", req, "limits must be listed in requirements.txt")

    def test_rate_limiter_middleware_registered(self):
        """
        Requirement 2.3: SlowAPIMiddleware, exception handler, and app.state.limiter
        must all be wired in main.py.
        """
        main_source = _read_source("backend/app/main.py")
        self.assertIn(
            "app.state.limiter",
            main_source,
            "app.state.limiter must be set in main.py",
        )
        self.assertIn(
            "RateLimitExceeded",
            main_source,
            "RateLimitExceeded exception handler must be registered in main.py",
        )
        self.assertIn(
            "SlowAPIMiddleware",
            main_source,
            "SlowAPIMiddleware must be added in main.py",
        )

    def test_limiter_imported_from_shared_module(self):
        """limiter must be imported from app.limiter (not defined inline)."""
        main_source = _read_source("backend/app/main.py")
        self.assertIn(
            "from .limiter import limiter",
            main_source,
            "main.py must import limiter from the shared .limiter module",
        )

    def test_authorize_endpoint_has_rate_limit_decorator(self):
        """
        Requirement 2.1: authorize_password must be decorated with @limiter.limit("5/minute").
        """
        access_source = _read_source("backend/app/routes/access.py")

        # Find the authorize_password function and check its preceding decorator
        lines = access_source.splitlines()
        for i, line in enumerate(lines):
            if "def authorize_password" in line:
                # Look at the preceding lines for the decorator
                context = "\n".join(lines[max(0, i - 5) : i + 1])
                self.assertIn(
                    '@limiter.limit("5/minute")',
                    context,
                    "authorize_password must be decorated with @limiter.limit('5/minute')",
                )
                return
        self.fail("authorize_password function not found in access.py")

    def test_download_endpoint_has_rate_limit_decorator(self):
        """
        Requirement 2.2: download_encrypted_file must be decorated with @limiter.limit("5/minute").
        """
        access_source = _read_source("backend/app/routes/access.py")

        lines = access_source.splitlines()
        for i, line in enumerate(lines):
            if "def download_encrypted_file" in line:
                context = "\n".join(lines[max(0, i - 5) : i + 1])
                self.assertIn(
                    '@limiter.limit("5/minute")',
                    context,
                    "download_encrypted_file must be decorated with @limiter.limit('5/minute')",
                )
                return
        self.fail("download_encrypted_file function not found in access.py")

    def test_request_param_present_in_authorize(self):
        """slowapi requires `request: Request` as a parameter in rate-limited handlers."""
        access_source = _read_source("backend/app/routes/access.py")
        # Find the function signature
        match = re.search(
            r"def authorize_password\s*\(([^)]+)\)",
            access_source,
            re.DOTALL,
        )
        self.assertIsNotNone(match, "authorize_password signature not found")
        signature = match.group(1)
        self.assertIn(
            "request",
            signature,
            "authorize_password must accept `request: Request` for slowapi to work",
        )

    def test_request_param_present_in_download(self):
        """slowapi requires `request: Request` as a parameter in rate-limited handlers."""
        access_source = _read_source("backend/app/routes/access.py")
        match = re.search(
            r"def download_encrypted_file\s*\(([^)]+)\)",
            access_source,
            re.DOTALL,
        )
        self.assertIsNotNone(match, "download_encrypted_file signature not found")
        signature = match.group(1)
        self.assertIn(
            "request",
            signature,
            "download_encrypted_file must accept `request: Request` for slowapi to work",
        )


# ===========================================================================
# Issue 8 — Missing Audit Log Entries on Revoked/Expired Downloads
# ===========================================================================

class TestIssue8AuditLogs(unittest.TestCase):
    """
    Bug condition: revoked/expired branches in download_encrypted_file raise
    HTTPException WITHOUT first writing an AccessLog.
    Fixed state:   _log_event helper is called before every HTTPException raise.

    Validates: Requirements 2.1, 2.2, 2.3 (Issue 8)
    """

    def test_log_event_helper_defined(self):
        """
        Requirement 2.3: a _log_event helper must be defined in access.py.
        """
        access_source = _read_source("backend/app/routes/access.py")
        self.assertIn(
            "def _log_event",
            access_source,
            "_log_event helper function must be defined in access.py",
        )

    def test_no_inline_db_add_accesslog(self):
        """
        Requirement 2.3: no inline db.add(AccessLog(...)) must remain in access.py;
        all logging must go through _log_event.
        We verify this by checking that AccessLog is only instantiated inside the
        _log_event helper and not in any of the route handlers directly.
        """
        access_source = _read_source("backend/app/routes/access.py")

        # Find every line that contains 'db.add(AccessLog('
        inline_call_lines = [
            (i + 1, line)
            for i, line in enumerate(access_source.splitlines())
            if "db.add(AccessLog(" in line
        ]

        # All such lines must be inside the _log_event function body.
        # _log_event is the only place allowed to call db.add(AccessLog(...)).
        # We verify this by confirming every such line is preceded (within 20 lines)
        # by 'def _log_event' without any intervening 'def ' for another function.
        for lineno, line in inline_call_lines:
            lines = access_source.splitlines()
            # Walk back from this line to find the enclosing function definition
            enclosing_fn = None
            for prev_i in range(lineno - 2, max(0, lineno - 30), -1):
                prev_line = lines[prev_i].strip()
                if prev_line.startswith("def "):
                    enclosing_fn = prev_line
                    break
            self.assertIsNotNone(
                enclosing_fn,
                f"Line {lineno} contains db.add(AccessLog() but no enclosing function found",
            )
            self.assertIn(
                "_log_event",
                enclosing_fn,
                f"Line {lineno}: db.add(AccessLog()) must only appear inside _log_event, "
                f"but found inside: {enclosing_fn!r}",
            )

    def test_revoked_branch_calls_log_event_before_raise(self):
        """
        Requirement 2.1: ACCESS_DENIED must be logged before the 403 for a revoked share.
        """
        access_source = _read_source("backend/app/routes/access.py")

        # Find the download_encrypted_file function
        # and locate the revoked branch within it.
        fn_match = re.search(
            r"def download_encrypted_file.*?(?=\ndef |\Z)",
            access_source,
            re.DOTALL,
        )
        self.assertIsNotNone(fn_match, "download_encrypted_file not found")
        fn_body = fn_match.group(0)

        # Find the revoked block: look for share.revoked check
        revoked_block_match = re.search(
            r"(if share\.revoked.*?)(raise HTTPException)",
            fn_body,
            re.DOTALL,
        )
        self.assertIsNotNone(
            revoked_block_match,
            "Could not find the `if share.revoked` block with HTTPException in download_encrypted_file",
        )
        block_before_raise = revoked_block_match.group(1)
        self.assertIn(
            "_log_event",
            block_before_raise,
            "_log_event must be called BEFORE the HTTPException raise in the revoked branch",
        )

    def test_expired_branch_calls_log_event_before_raise(self):
        """
        Requirement 2.2: LINK_EXPIRED must be logged before the 410 for an expired share.
        """
        access_source = _read_source("backend/app/routes/access.py")

        fn_match = re.search(
            r"def download_encrypted_file.*?(?=\ndef |\Z)",
            access_source,
            re.DOTALL,
        )
        self.assertIsNotNone(fn_match, "download_encrypted_file not found")
        fn_body = fn_match.group(0)

        # Find the expired block: share.expires_at check
        expired_block_match = re.search(
            r"(if share\.expires_at.*?< datetime\.utcnow\(\).*?)(raise HTTPException)",
            fn_body,
            re.DOTALL,
        )
        self.assertIsNotNone(
            expired_block_match,
            "Could not find the `if share.expires_at` block with HTTPException in download_encrypted_file",
        )
        block_before_raise = expired_block_match.group(1)
        self.assertIn(
            "_log_event",
            block_before_raise,
            "_log_event must be called BEFORE the HTTPException raise in the expired branch",
        )

    def test_revoked_download_writes_access_denied_log(self):
        """
        Integration: POST /api/access/{revokedToken}/download must write an ACCESS_DENIED
        record with all required fields populated.
        """
        db = _db()
        try:
            user = _bootstrap_user(db, "explore_issue8@vaultkey.app")
            file_item = _bootstrap_file(db, user)
            share, raw_token = _bootstrap_share(db, file_item, user, revoked=True)

            # Count logs before the request
            before = (
                db.query(AccessLog)
                .filter(
                    AccessLog.share_id == share.id,
                    AccessLog.event == "ACCESS_DENIED",
                )
                .count()
            )

            resp = client.post(f"/api/access/{raw_token}/download", json={})
            self.assertEqual(
                resp.status_code,
                403,
                f"Expected 403 for revoked share, got {resp.status_code}",
            )

            # Re-query in fresh state
            db.expire_all()
            after = (
                db.query(AccessLog)
                .filter(
                    AccessLog.share_id == share.id,
                    AccessLog.event == "ACCESS_DENIED",
                )
                .count()
            )
            self.assertGreater(
                after,
                before,
                "An ACCESS_DENIED AccessLog entry must be written when a revoked share is downloaded",
            )

            # Verify record completeness
            log = (
                db.query(AccessLog)
                .filter(
                    AccessLog.share_id == share.id,
                    AccessLog.event == "ACCESS_DENIED",
                )
                .order_by(AccessLog.timestamp.desc())
                .first()
            )
            self.assertIsNotNone(log.share_id, "share_id must be populated")
            self.assertIsNotNone(log.file_id, "file_id must be populated")
            self.assertIsNotNone(log.owner_id, "owner_id must be populated")
            self.assertIsNotNone(log.status, "status must be populated")
        finally:
            db.close()

    def test_expired_download_writes_link_expired_log(self):
        """
        Integration: POST /api/access/{expiredToken}/download must write a LINK_EXPIRED
        record with all required fields populated.
        """
        db = _db()
        try:
            user = _bootstrap_user(db, "explore_issue8@vaultkey.app")
            file_item = _bootstrap_file(db, user)
            share, raw_token = _bootstrap_share(db, file_item, user, expired=True)

            before = (
                db.query(AccessLog)
                .filter(
                    AccessLog.share_id == share.id,
                    AccessLog.event == "LINK_EXPIRED",
                )
                .count()
            )

            resp = client.post(f"/api/access/{raw_token}/download", json={})
            self.assertEqual(
                resp.status_code,
                410,
                f"Expected 410 for expired share, got {resp.status_code}",
            )

            db.expire_all()
            after = (
                db.query(AccessLog)
                .filter(
                    AccessLog.share_id == share.id,
                    AccessLog.event == "LINK_EXPIRED",
                )
                .count()
            )
            self.assertGreater(
                after,
                before,
                "A LINK_EXPIRED AccessLog entry must be written when an expired share is downloaded",
            )

            log = (
                db.query(AccessLog)
                .filter(
                    AccessLog.share_id == share.id,
                    AccessLog.event == "LINK_EXPIRED",
                )
                .order_by(AccessLog.timestamp.desc())
                .first()
            )
            self.assertIsNotNone(log.share_id, "share_id must be populated")
            self.assertIsNotNone(log.file_id, "file_id must be populated")
            self.assertIsNotNone(log.owner_id, "owner_id must be populated")
            self.assertIsNotNone(log.status, "status must be populated")
        finally:
            db.close()


# ===========================================================================
# Issue 11 — database/schema.sql Out of Sync with models.py
# ===========================================================================

class TestIssue11SchemaSyncWithModels(unittest.TestCase):
    """
    Bug condition: schema.sql column definitions do not match models.py.
    Fixed state:   schema.sql accurately mirrors models.py for every table.

    Validates: Requirements 2.1, 2.2 (Issue 11)

    isBugCondition_11: schemaSQL.column_definitions != models.column_definitions
    """

    # ------------------------------------------------------------------
    # Ground truth extracted from models.py (the authoritative source)
    # ------------------------------------------------------------------

    # Maps table name → set of expected column names
    EXPECTED_COLUMNS = {
        "users": {"id", "email", "hashed_password", "created_at"},
        "files": {
            "id", "owner_id", "r2_object_key", "original_filename",
            "mime_type", "size", "iv_hex", "created_at",
        },
        "shares": {
            "id", "file_id", "owner_id", "token_hash", "expires_at",
            "max_downloads", "download_count", "password_hash",
            "revoked", "revoked_at", "created_at",
        },
        "access_logs": {
            "id", "share_id", "file_id", "owner_id",
            "event", "status", "user_agent", "ip_address", "timestamp",
        },
    }

    # Columns that must be NOT NULL
    NOT_NULL_COLUMNS = {
        "users": {"email", "hashed_password"},
        "files": {"owner_id", "r2_object_key", "original_filename", "size", "iv_hex"},
        "shares": {"file_id", "owner_id", "token_hash"},
        "access_logs": {"owner_id", "event", "status"},
    }

    def _parse_schema_columns(self) -> dict:
        """
        Parse schema.sql and return {table_name: {col_name, ...}} using simple regex.
        """
        schema_sql = _read_source("database/schema.sql")
        tables: dict = {}
        current_table = None

        for line in schema_sql.splitlines():
            stripped = line.strip()

            # Match CREATE TABLE IF NOT EXISTS <name>
            table_match = re.match(
                r"CREATE TABLE IF NOT EXISTS (\w+)\s*\(", stripped, re.IGNORECASE
            )
            if table_match:
                current_table = table_match.group(1)
                tables[current_table] = set()
                continue

            if current_table:
                if stripped.startswith(")"):
                    current_table = None
                    continue
                # Skip constraint lines and index lines
                if re.match(r"(PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK|CONSTRAINT|CREATE INDEX)", stripped, re.IGNORECASE):
                    continue
                # Extract column name: first word of a non-empty, non-comment line
                col_match = re.match(r"(\w+)\s+", stripped)
                if col_match:
                    col_name = col_match.group(1)
                    tables[current_table].add(col_name)

        return tables

    def test_all_expected_tables_present_in_schema(self):
        """schema.sql must define all four tables that models.py declares."""
        schema_tables = self._parse_schema_columns()
        for table in self.EXPECTED_COLUMNS:
            self.assertIn(
                table,
                schema_tables,
                f"Table '{table}' is defined in models.py but missing from schema.sql",
            )

    def test_users_table_columns_match(self):
        """schema.sql users table must have exactly the columns in models.User."""
        schema_tables = self._parse_schema_columns()
        self.assertEqual(
            schema_tables.get("users", set()),
            self.EXPECTED_COLUMNS["users"],
            "users table columns in schema.sql do not match models.py",
        )

    def test_files_table_columns_match(self):
        """schema.sql files table must have exactly the columns in models.FileItem."""
        schema_tables = self._parse_schema_columns()
        self.assertEqual(
            schema_tables.get("files", set()),
            self.EXPECTED_COLUMNS["files"],
            "files table columns in schema.sql do not match models.py",
        )

    def test_shares_table_columns_match(self):
        """schema.sql shares table must have exactly the columns in models.ShareLink."""
        schema_tables = self._parse_schema_columns()
        self.assertEqual(
            schema_tables.get("shares", set()),
            self.EXPECTED_COLUMNS["shares"],
            "shares table columns in schema.sql do not match models.py",
        )

    def test_access_logs_table_columns_match(self):
        """schema.sql access_logs table must have exactly the columns in models.AccessLog."""
        schema_tables = self._parse_schema_columns()
        self.assertEqual(
            schema_tables.get("access_logs", set()),
            self.EXPECTED_COLUMNS["access_logs"],
            "access_logs table columns in schema.sql do not match models.py",
        )

    def test_not_null_constraints_present_for_users(self):
        """Critical NOT NULL columns in users must be annotated as NOT NULL in schema.sql."""
        schema_sql = _read_source("database/schema.sql")
        for col in self.NOT_NULL_COLUMNS["users"]:
            # Find the line for this column in the users table block
            pattern = rf"^\s+{col}\s+\S.*NOT NULL"
            self.assertTrue(
                re.search(pattern, schema_sql, re.MULTILINE | re.IGNORECASE) is not None,
                f"Column 'users.{col}' must have NOT NULL in schema.sql",
            )

    def test_not_null_constraints_present_for_access_logs(self):
        """Critical NOT NULL columns in access_logs must be annotated as NOT NULL in schema.sql."""
        schema_sql = _read_source("database/schema.sql")
        for col in self.NOT_NULL_COLUMNS["access_logs"]:
            pattern = rf"^\s+{col}\s+\S.*NOT NULL"
            self.assertTrue(
                re.search(pattern, schema_sql, re.MULTILINE | re.IGNORECASE) is not None,
                f"Column 'access_logs.{col}' must have NOT NULL in schema.sql",
            )

    def test_schema_sql_last_synced_comment_present(self):
        """schema.sql must contain a 'Last synced' comment to track maintenance."""
        schema_sql = _read_source("database/schema.sql")
        self.assertIn(
            "Last synced",
            schema_sql,
            "schema.sql must contain a '-- Last synced:' comment",
        )

    def test_firebase_uid_not_in_schema_or_models(self):
        """
        Drift check: firebase_uid should not appear in schema.sql if it isn't in models.py.
        Both must agree on whether this column exists.
        """
        schema_sql = _read_source("database/schema.sql")
        models_py = _read_source("backend/app/models.py")
        schema_has_firebase = "firebase_uid" in schema_sql.lower()
        models_has_firebase = "firebase_uid" in models_py.lower()
        self.assertEqual(
            schema_has_firebase,
            models_has_firebase,
            "firebase_uid presence must match between schema.sql and models.py",
        )


# ===========================================================================
# Run
# ===========================================================================

if __name__ == "__main__":
    unittest.main(verbosity=2)
