from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _auth_headers():
    email = f"ppt-upload-{uuid4()}@vaultkey.app"
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "PptUploadTest123!"},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_powerpoint_extensions_upload_with_correct_mime_types():
    headers = _auth_headers()
    cases = [
        ("slides.ppt", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", "application/vnd.ms-powerpoint"),
        (
            "slides.pptx",
            b"PK\x03\x04encrypted-payload",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ),
    ]

    with patch("app.routes.files.upload_file_streaming", return_value=None):
        for filename, payload, expected_mime in cases:
            response = client.post(
                "/api/files",
                headers=headers,
                files={"file": (f"{filename}.enc", payload, "application/octet-stream")},
                data={"original_filename": filename, "iv_hex": "00112233445566778899aabb"},
            )
            assert response.status_code == 200, response.text
            assert response.json()["mime_type"] == expected_mime


def test_storage_failure_returns_cors_visible_gateway_error_without_delete_retry():
    headers = _auth_headers()
    headers["Origin"] = "http://127.0.0.1:5173"
    with patch("app.routes.files.upload_file_streaming", side_effect=OSError("storage unavailable")):
        with patch("app.routes.files.delete_file") as delete_file:
            response = client.post(
                "/api/files",
                headers=headers,
                files={"file": ("slides.pptx.enc", b"encrypted", "application/octet-stream")},
                data={"original_filename": "slides.pptx", "iv_hex": "00112233445566778899aabb"},
            )

    assert response.status_code == 502
    assert response.json()["detail"] == "Encrypted file storage is unavailable. The upload was not saved."
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
    delete_file.assert_not_called()
