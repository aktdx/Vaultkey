"""
Bug condition exploration tests — MIME type octet-stream override bug.

Property 1: Bug Condition — Generic MIME Type Not Overridden by Extension

These tests encode the EXPECTED (correct) behaviour and are intentionally
designed to FAIL on unfixed code, confirming the root cause.

DO NOT fix these tests or the production code when they fail here.
They will become green after the fix is applied in task 3.1.

Root cause under test:
    `_resolve_mime()` in access.py treats `"application/octet-stream"` as a
    resolved value. Because `if file_item.mime_type:` is truthy for that string,
    the extension-based fallback (`_EXT_MIME_FALLBACK`) is never reached.
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock

# ── Path setup ────────────────────────────────────────────────────────────────
sys.path.insert(0, str(Path(__file__).parent))

from app.routes.access import _resolve_mime  # noqa: E402


def _file(mime_type, filename):
    """Create a minimal FileItem mock with the given mime_type and original_filename."""
    f = MagicMock()
    f.mime_type = mime_type
    f.original_filename = filename
    return f


# ---------------------------------------------------------------------------
# Bug condition cases — MUST FAIL on unfixed code
# ---------------------------------------------------------------------------

class TestMimeOctetStreamBugCondition:
    """
    Each test here represents a file whose mime_type DB column stores
    "application/octet-stream" (legacy rows) but whose extension maps to a
    known, specific MIME type.

    On unfixed code _resolve_mime returns "application/octet-stream" for these
    inputs. After the fix it must return the extension-derived MIME type.
    """

    def test_pdf_with_octet_stream_in_db(self):
        """_resolve_mime must return application/pdf for report.pdf, not octet-stream."""
        result = _resolve_mime(_file("application/octet-stream", "report.pdf"))
        assert result == "application/pdf", (
            f"BUG CONFIRMED: got {result!r} — 'application/octet-stream' was not overridden "
            "by the .pdf extension lookup"
        )

    def test_png_with_octet_stream_in_db(self):
        """_resolve_mime must return image/png for photo.png, not octet-stream."""
        result = _resolve_mime(_file("application/octet-stream", "photo.png"))
        assert result == "image/png", (
            f"BUG CONFIRMED: got {result!r} — 'application/octet-stream' was not overridden "
            "by the .png extension lookup"
        )

    def test_jpg_with_octet_stream_in_db(self):
        result = _resolve_mime(_file("application/octet-stream", "photo.jpg"))
        assert result == "image/jpeg", f"got {result!r}"

    def test_txt_with_octet_stream_in_db(self):
        result = _resolve_mime(_file("application/octet-stream", "notes.txt"))
        assert result == "text/plain", f"got {result!r}"

    def test_json_with_octet_stream_in_db(self):
        result = _resolve_mime(_file("application/octet-stream", "data.json"))
        assert result == "application/json", f"got {result!r}"

    # ── Boundary: unknown extension — must pass even on UNFIXED code ──────────

    def test_unknown_extension_stays_octet_stream(self):
        """archive.xyz has no extension mapping — octet-stream is the correct final fallback."""
        result = _resolve_mime(_file("application/octet-stream", "archive.xyz"))
        assert result == "application/octet-stream", (
            f"Expected 'application/octet-stream' for unknown extension, got {result!r}"
        )
