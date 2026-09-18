from datetime import datetime, timedelta, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import User, FileItem, ShareLink, AccessLog, AccessMode
from ..schemas import ShareCreateRequest, ShareCreateResponse, ShareDetailResponse
from ..security import get_current_user, generate_secure_token, hash_share_token, hash_password
from ..utils import log_event, make_aware

router = APIRouter(prefix="/api/shares", tags=["Shares"])

@router.post("", response_model=ShareCreateResponse)
def create_share_link(
    payload: ShareCreateRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Verify file exists and belongs to current user
    file_item = db.query(FileItem).filter(
        FileItem.id == payload.file_id,
        FileItem.owner_id == current_user.id
    ).first()

    if not file_item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found or unauthorized"
        )

    # Calculate expiration date
    expires_at = None
    if payload.expiration_hours and payload.expiration_hours > 0:
        expires_at = datetime.now(timezone.utc) + timedelta(hours=payload.expiration_hours)

    # Generate raw token & hash
    raw_token = generate_secure_token()
    token_hash = hash_share_token(raw_token)

    # Hash optional password
    password_hash = None
    if payload.password and payload.password.strip():
        password_hash = hash_password(payload.password.strip())

    # Resolve access_mode: explicit field takes precedence.
    # For backwards-compat: if caller passes max_downloads=0 without an explicit
    # access_mode, treat it as view_only (preserves legacy behaviour).
    resolved_access_mode = payload.access_mode
    if resolved_access_mode == AccessMode.DOWNLOAD.value and payload.max_downloads == 0:
        resolved_access_mode = AccessMode.VIEW_ONLY.value

    share = ShareLink(
        file_id=file_item.id,
        owner_id=current_user.id,
        token_hash=token_hash,
        expires_at=expires_at,
        access_mode=resolved_access_mode,
        max_downloads=payload.max_downloads,
        download_count=0,
        password_hash=password_hash,
        revoked=False
    )

    db.add(share)
    db.flush()  # assign share.id

    # Audit log
    log_event(db, share, "LINK_CREATED", "SUCCESS", request)

    return ShareCreateResponse(
        share_id=share.id,
        token=raw_token,
        file_id=file_item.id,
        original_filename=file_item.original_filename,
        expires_at=expires_at,
        max_downloads=payload.max_downloads,
        access_mode=resolved_access_mode,
        has_password=password_hash is not None,
        created_at=share.created_at
    )

@router.get("", response_model=List[ShareDetailResponse])
def list_user_shares(
    file_id: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,  # ponytail: max 100; add cursor-based pagination if user share counts grow into the thousands
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    page_size = min(max(page_size, 1), 100)
    offset = (max(page, 1) - 1) * page_size

    query = (
        db.query(ShareLink, FileItem.original_filename)
        .outerjoin(FileItem, ShareLink.file_id == FileItem.id)
        .filter(ShareLink.owner_id == current_user.id)
    )
    if file_id:
        query = query.filter(ShareLink.file_id == file_id)

    rows = query.order_by(ShareLink.created_at.desc()).offset(offset).limit(page_size).all()

    now = datetime.now(timezone.utc)
    result = []
    for s, filename in rows:
        status_str = "ACTIVE"
        if s.revoked:
            status_str = "REVOKED"
        elif s.expires_at and make_aware(s.expires_at) < now:
            status_str = "EXPIRED"
        elif s.access_mode == AccessMode.VIEW_ONLY.value:
            status_str = "VIEW_ONLY"
        elif s.max_downloads > 0 and s.download_count >= s.max_downloads:
            status_str = "LIMIT_REACHED"

        result.append(ShareDetailResponse(
            id=s.id,
            file_id=s.file_id,
            original_filename=filename or "Unknown",
            expires_at=s.expires_at,
            max_downloads=s.max_downloads,
            download_count=s.download_count,
            access_mode=s.access_mode or AccessMode.DOWNLOAD.value,
            has_password=s.password_hash is not None,
            revoked=s.revoked,
            revoked_at=s.revoked_at,
            created_at=s.created_at,
            status=status_str
        ))

    return result

@router.get("/{share_id}", response_model=ShareDetailResponse)
def get_share_detail(
    share_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    s = db.query(ShareLink).filter(
        ShareLink.id == share_id,
        ShareLink.owner_id == current_user.id
    ).first()

    if not s:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")

    filename = s.file.original_filename if s.file else "Unknown"

    now = datetime.now(timezone.utc)
    status_str = "ACTIVE"
    if s.revoked:
        status_str = "REVOKED"
    elif s.expires_at and make_aware(s.expires_at) < now:
        status_str = "EXPIRED"
    elif s.access_mode == AccessMode.VIEW_ONLY.value:
        status_str = "VIEW_ONLY"
    elif s.max_downloads > 0 and s.download_count >= s.max_downloads:
        status_str = "LIMIT_REACHED"


    return ShareDetailResponse(
        id=s.id,
        file_id=s.file_id,
        original_filename=filename,
        expires_at=s.expires_at,
        max_downloads=s.max_downloads,
        download_count=s.download_count,
        access_mode=s.access_mode or AccessMode.DOWNLOAD.value,
        has_password=s.password_hash is not None,
        revoked=s.revoked,
        revoked_at=s.revoked_at,
        created_at=s.created_at,
        status=status_str
    )

@router.post("/{share_id}/revoke")
def revoke_share_link(
    share_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    s = db.query(ShareLink).filter(
        ShareLink.id == share_id,
        ShareLink.owner_id == current_user.id
    ).first()

    if not s:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")

    if not s.revoked:
        s.revoked = True
        s.revoked_at = datetime.now(timezone.utc)

        # Audit log
        log_event(db, s, "LINK_REVOKED", "SUCCESS", request)

    return {"status": "success", "message": "Share link revoked successfully"}
