"""
Firebase Admin SDK — initialization and ID token verification.

Responsibilities:
  1. Initialize Firebase Admin once at import time (guarded against double-init).
  2. Expose verify_firebase_token(id_token) → verified claims dict.

Credentials are loaded from environment variables only — never from a file path.
"""
import json
import logging
import os

try:
    import firebase_admin
    from firebase_admin import auth as firebase_auth, credentials
    _FIREBASE_AVAILABLE = True
except ImportError:
    firebase_admin = None  # type: ignore[assignment]
    firebase_auth = None   # type: ignore[assignment]
    credentials = None     # type: ignore[assignment]
    _FIREBASE_AVAILABLE = False

logger = logging.getLogger(__name__)

# ── Initialize Firebase Admin once ────────────────────────────────────────────

def _init_firebase() -> bool:
    """Initialize Firebase Admin SDK from environment variables.

    Returns True if initialization succeeded, False if env vars are missing
    (so the app can start without Firebase configured, but /auth/google will 503).
    """
    if not _FIREBASE_AVAILABLE:
        logger.warning(
            "firebase-admin package is not installed. "
            "POST /api/auth/google will return 503."
        )
        return False

    if firebase_admin._apps:
        return True  # already initialized

    sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
    project_id = os.environ.get("FIREBASE_PROJECT_ID", "").strip()

    if sa_json:
        try:
            sa_dict = json.loads(sa_json)
            cred = credentials.Certificate(sa_dict)
            firebase_admin.initialize_app(cred)
            logger.info("Firebase Admin initialized with service account credentials.")
            return True
        except (json.JSONDecodeError, ValueError) as exc:
            logger.error("FIREBASE_SERVICE_ACCOUNT_JSON is set but invalid: %s", exc)
            return False
    elif project_id:
        # Application Default Credentials (useful on GCP / Render with workload identity)
        try:
            cred = credentials.ApplicationDefault()
            firebase_admin.initialize_app(cred, {"projectId": project_id})
            logger.info("Firebase Admin initialized with Application Default Credentials.")
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error("Failed to initialize Firebase Admin with ADC: %s", exc)
            return False
    else:
        logger.warning(
            "FIREBASE_SERVICE_ACCOUNT_JSON and FIREBASE_PROJECT_ID are both unset. "
            "POST /api/auth/google will return 503."
        )
        return False


_firebase_ready = _init_firebase()


# ── Token verification ─────────────────────────────────────────────────────────

def verify_firebase_token(id_token: str) -> dict:
    """Verify a Firebase ID token and return the decoded claims.

    Raises ValueError with a user-safe message on any validation failure.
    Never leaks token contents, service-account details, or internal stack traces.

    Validates:
      - Signature, expiry, issuer, audience (via Firebase Admin SDK)
      - email_verified must be True
      - sign_in_provider must be google.com
    """
    if not _firebase_ready:
        raise RuntimeError("Firebase Admin SDK is not configured on this server.")

    try:
        claims = firebase_auth.verify_id_token(id_token, check_revoked=False)
    except firebase_auth.ExpiredIdTokenError:
        raise ValueError("Authentication token has expired. Please sign in again.")
    except firebase_auth.RevokedIdTokenError:
        raise ValueError("Authentication token has been revoked. Please sign in again.")
    except firebase_auth.InvalidIdTokenError:
        raise ValueError("Invalid authentication token.")
    except Exception:  # noqa: BLE001 — catch-all so we never leak Firebase internals
        logger.exception("Unexpected error during Firebase token verification.")
        raise ValueError("Authentication verification failed.")

    if not claims.get("email_verified"):
        raise ValueError("Google account email is not verified.")

    provider = claims.get("firebase", {}).get("sign_in_provider", "")
    if provider != "google.com":
        raise ValueError("Only Google sign-in is accepted on this endpoint.")

    return claims
