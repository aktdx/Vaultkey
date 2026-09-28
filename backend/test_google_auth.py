"""
Tests for POST /api/auth/google — Firebase Google authentication endpoint.

All Firebase Admin SDK calls are mocked so no real Firebase credentials are
needed to run this test suite.
"""
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

# conftest.py sets all env vars (including empty FIREBASE_* vars) before
# any app import, so firebase_service initialises in its "not configured" path.

from app.main import app  # noqa: E402 — must come after env setup

client = TestClient(app)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_claims(uid: str = "google_uid_123", email: str = "google@example.com") -> dict:
    """Return a minimal verified Firebase ID token claims dict."""
    return {
        "uid": uid,
        "email": email,
        "email_verified": True,
        "firebase": {"sign_in_provider": "google.com"},
    }


def _register_local_user(email: str = "local@example.com", password: str = "StrongPass1!") -> str:
    """Register a VaultKey email/password user and return their JWT."""
    res = client.post("/api/auth/register", json={"email": email, "password": password})
    if res.status_code == 400:  # already exists from previous test run
        res = client.post("/api/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200
    return res.json()["access_token"]


# ── Tests ──────────────────────────────────────────────────────────────────────

class TestGoogleAuthEndpoint:

    # 1. Valid token → new user created → VaultKey JWT returned
    def test_valid_token_new_user_returns_jwt(self):
        claims = _make_claims(uid="new_uid_001", email="brand_new@example.com")
        with patch("app.firebase_service._firebase_ready", True), \
             patch("app.firebase_service.verify_firebase_token", return_value=claims):
            res = client.post("/api/auth/google", json={"id_token": "fake_token"})

        assert res.status_code == 200
        body = res.json()
        assert "access_token" in body
        assert body["token_type"] == "bearer"
        assert body["user"]["email"] == "brand_new@example.com"

    # 2. Valid token → same firebase_uid on second call → same user returned, no duplicate
    def test_existing_firebase_uid_no_duplicate(self):
        claims = _make_claims(uid="existing_uid_002", email="repeat@example.com")
        with patch("app.firebase_service._firebase_ready", True), \
             patch("app.firebase_service.verify_firebase_token", return_value=claims):
            res1 = client.post("/api/auth/google", json={"id_token": "fake_token"})
            res2 = client.post("/api/auth/google", json={"id_token": "fake_token"})

        assert res1.status_code == 200
        assert res2.status_code == 200
        # Same user ID returned both times
        assert res1.json()["user"]["id"] == res2.json()["user"]["id"]

    # 3. Existing email/password account → firebase_uid is linked, not a new user
    def test_existing_email_links_firebase_uid(self):
        email = "preexisting_link@example.com"
        _register_local_user(email=email, password="LinkPass99!")

        claims = _make_claims(uid="link_uid_003", email=email)
        with patch("app.firebase_service._firebase_ready", True), \
             patch("app.firebase_service.verify_firebase_token", return_value=claims):
            res = client.post("/api/auth/google", json={"id_token": "fake_token"})

        assert res.status_code == 200
        body = res.json()
        assert body["user"]["email"] == email

        # Confirm only one user exists by doing a second call with same uid — still same id
        with patch("app.firebase_service._firebase_ready", True), \
             patch("app.firebase_service.verify_firebase_token", return_value=claims):
            res2 = client.post("/api/auth/google", json={"id_token": "fake_token"})
        assert res.json()["user"]["id"] == res2.json()["user"]["id"]

    # 4. Invalid token (verify raises ValueError) → 401
    def test_invalid_token_returns_401(self):
        with patch("app.firebase_service._firebase_ready", True), \
             patch("app.firebase_service.verify_firebase_token",
                   side_effect=ValueError("Invalid authentication token.")):
            res = client.post("/api/auth/google", json={"id_token": "bad_token"})

        assert res.status_code == 401
        assert "Invalid authentication token" in res.json()["detail"]

    # 5. Unverified email → 401 (verify_firebase_token raises ValueError)
    def test_unverified_email_returns_401(self):
        with patch("app.firebase_service._firebase_ready", True), \
             patch("app.firebase_service.verify_firebase_token",
                   side_effect=ValueError("Google account email is not verified.")):
            res = client.post("/api/auth/google", json={"id_token": "fake_token"})

        assert res.status_code == 401
        assert "not verified" in res.json()["detail"]

    # 6. Non-Google provider → 401
    def test_non_google_provider_returns_401(self):
        with patch("app.firebase_service._firebase_ready", True), \
             patch("app.firebase_service.verify_firebase_token",
                   side_effect=ValueError("Only Google sign-in is accepted on this endpoint.")):
            res = client.post("/api/auth/google", json={"id_token": "fake_token"})

        assert res.status_code == 401

    # 7. Firebase not configured → 503
    def test_firebase_not_configured_returns_503(self):
        with patch("app.firebase_service._firebase_ready", False):
            res = client.post("/api/auth/google", json={"id_token": "fake_token"})

        assert res.status_code == 503

    # 8. Returned JWT works on GET /api/auth/me
    def test_returned_jwt_authenticates_me_endpoint(self):
        claims = _make_claims(uid="jwt_check_uid_008", email="jwtcheck@example.com")
        with patch("app.firebase_service._firebase_ready", True), \
             patch("app.firebase_service.verify_firebase_token", return_value=claims):
            google_res = client.post("/api/auth/google", json={"id_token": "fake_token"})

        assert google_res.status_code == 200
        token = google_res.json()["access_token"]

        me_res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me_res.status_code == 200
        assert me_res.json()["email"] == "jwtcheck@example.com"

    # 9. Email/password login still works after model change (nullable password)
    def test_email_password_login_still_works(self):
        email = "classic@example.com"
        password = "Classic999!"
        # Register
        reg = client.post("/api/auth/register", json={"email": email, "password": password})
        if reg.status_code != 200:  # already registered
            pass
        # Login
        login = client.post("/api/auth/login", json={"email": email, "password": password})
        assert login.status_code == 200
        assert "access_token" in login.json()

    # 10. Google-only user (null password) cannot log in via password endpoint
    def test_google_only_user_cannot_login_with_password(self):
        email = "googleonly@example.com"
        claims = _make_claims(uid="google_only_uid_010", email=email)

        # Create via Google auth
        with patch("app.firebase_service._firebase_ready", True), \
             patch("app.firebase_service.verify_firebase_token", return_value=claims):
            client.post("/api/auth/google", json={"id_token": "fake_token"})

        # Attempt password login → should fail
        res = client.post("/api/auth/login", json={"email": email, "password": "anything"})
        assert res.status_code == 401


class TestFirebaseServiceUnit:

    def test_verify_raises_on_expired_token(self):
        """verify_firebase_token maps ExpiredIdTokenError → ValueError."""
        import firebase_admin.auth as fb_auth
        from app.firebase_service import verify_firebase_token

        mock_error = fb_auth.ExpiredIdTokenError("expired", cause=None)
        with patch("app.firebase_service._firebase_ready", True), \
             patch("firebase_admin.auth.verify_id_token", side_effect=mock_error):
            with pytest.raises(ValueError, match="expired"):
                verify_firebase_token("expired_token")

    def test_verify_raises_on_unverified_email(self):
        """Claims with email_verified=False → ValueError."""
        from app.firebase_service import verify_firebase_token

        claims = {
            "uid": "x", "email": "x@x.com", "email_verified": False,
            "firebase": {"sign_in_provider": "google.com"},
        }
        with patch("app.firebase_service._firebase_ready", True), \
             patch("firebase_admin.auth.verify_id_token", return_value=claims):
            with pytest.raises(ValueError, match="not verified"):
                verify_firebase_token("fake")

    def test_verify_raises_on_wrong_provider(self):
        """Claims with sign_in_provider != google.com → ValueError."""
        from app.firebase_service import verify_firebase_token

        claims = {
            "uid": "x", "email": "x@x.com", "email_verified": True,
            "firebase": {"sign_in_provider": "password"},
        }
        with patch("app.firebase_service._firebase_ready", True), \
             patch("firebase_admin.auth.verify_id_token", return_value=claims):
            with pytest.raises(ValueError, match="Google sign-in"):
                verify_firebase_token("fake")
