"""
Preservation tests — MIME type resolution: specific types must not be disturbed.

Property 2: Preservation — Specific MIME Types Are Not Overridden

These tests MUST PASS on both unfixed and fixed code.  They establish the
regression baseline: anything that already works correctly must keep working
after the fix in task 3.1 is applied.

Inputs where isBugCondition is FALSE:
  - stored mime_type is a specific, non-generic value  → return it unchanged
  - stored mime_type is null/empty                     → extension lookup fires
  - stored mime_type is octet-stream + unknown extension → octet-stream is kept
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).parent))

from app.routes.access import _resolve_mime  # noqa: E402


def _file(mime_type, filename):
    f = MagicMock()
    f.mime_type = mime_type
    f.original_filename = filename
    return f


class TestMimeResolutionPreservation:
    """Inputs outside the bug condition — behaviour must be identical before and after the fix."""

    # ── Specific stored types are returned unchanged ──────────────────────────

    def test_stored_pdf_returned_as_is(self):
        assert _resolve_mime(_file("application/pdf", "report.pdf")) == "application/pdf"

    def test_stored_png_returned_as_is(self):
        assert _resolve_mime(_file("image/png", "photo.png")) == "image/png"

    def test_stored_jpeg_returned_as_is(self):
        assert _resolve_mime(_file("image/jpeg", "photo.jpg")) == "image/jpeg"

    def test_stored_text_plain_returned_as_is(self):
        assert _resolve_mime(_file("text/plain", "notes.txt")) == "text/plain"

    def test_stored_application_json_returned_as_is(self):
        assert _resolve_mime(_file("application/json", "data.json")) == "application/json"

    def test_stored_text_markdown_returned_as_is(self):
        assert _resolve_mime(_file("text/markdown", "README.md")) == "text/markdown"

    def test_stored_text_csv_returned_as_is(self):
        assert _resolve_mime(_file("text/csv", "report.csv")) == "text/csv"

    # ── Null/empty stored type → extension lookup fires ───────────────────────

    def test_null_mime_type_pdf_extension(self):
        assert _resolve_mime(_file(None, "report.pdf")) == "application/pdf"

    def test_null_mime_type_png_extension(self):
        assert _resolve_mime(_file(None, "photo.png")) == "image/png"

    def test_empty_string_mime_type_pdf_extension(self):
        assert _resolve_mime(_file("", "report.pdf")) == "application/pdf"

    def test_null_mime_type_unknown_extension(self):
        assert _resolve_mime(_file(None, "archive.xyz")) == "application/octet-stream"

    def test_empty_mime_type_unknown_extension(self):
        assert _resolve_mime(_file("", "archive.xyz")) == "application/octet-stream"

    # ── octet-stream + unknown extension → octet-stream kept (correct final fallback) ─

    def test_octet_stream_unknown_extension_stays_octet_stream(self):
        """No extension match: octet-stream is the right answer and must not change."""
        assert _resolve_mime(_file("application/octet-stream", "archive.xyz")) == "application/octet-stream"

    def test_octet_stream_no_extension_stays_octet_stream(self):
        assert _resolve_mime(_file("application/octet-stream", "Makefile")) == "application/octet-stream"
