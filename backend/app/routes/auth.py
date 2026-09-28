import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..limiter import limiter
from ..models import User
from ..schemas import GoogleAuthRequest, UserLogin, UserRegister, UserResponse, TokenResponse
from ..security import create_access_token, get_current_user, hash_password, verify_password
from .. import firebase_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


@router.post("/register", response_model=TokenResponse)
@limiter.limit("10/minute")
def register_user(request: Request, payload: UserRegister, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email.lower().strip()).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User with this email already exists"
        )

    user = User(
        email=payload.email.lower().strip(),
        hashed_password=hash_password(payload.password)
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    access_token = create_access_token(data={"sub": user.id, "email": user.email})
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=UserResponse.model_validate(user)
    )


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
def login_user(request: Request, payload: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email.lower().strip()).first()
    # Guard against Google-only users who have no password
    if not user or not user.hashed_password or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )

    access_token = create_access_token(data={"sub": user.id, "email": user.email})
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=UserResponse.model_validate(user)
    )


@router.post("/google", response_model=TokenResponse)
@limiter.limit("10/minute")
def google_auth(request: Request, payload: GoogleAuthRequest, db: Session = Depends(get_db)):
    """Exchange a Firebase ID token for a VaultKey JWT.

    Three cases:
      A. firebase_uid already in DB → authenticate that user.
      B. firebase_uid not found but email matches → link uid, authenticate.
      C. Neither found → create new user (no password).
    """
    # 1. Verify token — all identity data comes from here, never from the request body
    if not firebase_service._firebase_ready:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google sign-in is not configured on this server."
        )

    try:
        claims = firebase_service.verify_firebase_token(payload.id_token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))

    firebase_uid: str = claims["uid"]
    email: str = claims["email"].lower().strip()

    # 2. Find or create the VaultKey user
    try:
        # Case A: known Firebase UID
        user = db.query(User).filter(User.firebase_uid == firebase_uid).first()

        if user is None:
            # Case B: matching email → link the Firebase UID
            user = db.query(User).filter(User.email == email).first()
            if user is not None:
                user.firebase_uid = firebase_uid
                db.commit()
                db.refresh(user)

        if user is None:
            # Case C: brand-new user
            user = User(email=email, hashed_password=None, firebase_uid=firebase_uid)
            db.add(user)
            db.commit()
            db.refresh(user)

    except Exception:
        logger.exception("Database error during Google auth for email=%s", email)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred during sign-in. Please try again."
        )

    # 3. Issue the same VaultKey JWT used everywhere else
    access_token = create_access_token(data={"sub": user.id, "email": user.email})
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=UserResponse.model_validate(user)
    )


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)
