from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import FileItem, ShareLink, User
from app.security import hash_share_token

client = TestClient(app)


def test_public_share_id_and_secure_session_status():
    Base.metadata.create_all(bind=engine)
    cors_preflight = client.options(
        "/api/access/test/session-status",
        headers={
            "Origin": "https://vaultkey.local",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert cors_preflight.status_code == 200
    assert cors_preflight.headers["access-control-allow-origin"] == "https://vaultkey.local"

    db = SessionLocal()
    owner = User(email=f"secure-viewer-{uuid4()}@vaultkey.test", hashed_password="unused")
    db.add(owner)
    db.flush()

    file_item = FileItem(
        owner_id=owner.id,
        r2_object_key="uploads/secure-viewer-test.enc",
        original_filename="protected.pdf",
        mime_type="application/pdf",
        size=123,
        iv_hex="00112233445566778899aabb",
    )
    db.add(file_item)
    db.flush()

    raw_token = f"legacy-token-{uuid4()}"
    share = ShareLink(
        file_id=file_item.id,
        owner_id=owner.id,
        token_hash=hash_share_token(raw_token),
        access_mode="download",
        max_downloads=1,
        download_count=0,
        revoked=False,
    )
    db.add(share)
    db.commit()
    share_id = share.id

    try:
        by_id = client.get(f"/api/access/{share_id}")
        assert by_id.status_code == 200
        assert by_id.json()["share_id"] == share_id
        assert by_id.json()["valid"] is True

        legacy = client.get(f"/api/access/{raw_token}")
        assert legacy.status_code == 200
        assert legacy.json()["share_id"] == share_id

        share.download_count = 1
        db.commit()
        limited = client.get(f"/api/access/{share_id}")
        assert limited.json()["status"] == "LIMIT_REACHED"
        assert client.get(f"/api/access/{share_id}/session-status").json() == {
            "valid": True,
            "status": "OK",
        }

        share.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()
        assert client.get(f"/api/access/{share_id}/session-status").json()["status"] == "EXPIRED"

        share.revoked = True
        db.commit()
        assert client.get(f"/api/access/{share_id}/session-status").json()["status"] == "REVOKED"
    finally:
        db.delete(share)
        db.delete(file_item)
        db.delete(owner)
        db.commit()
        db.close()
