import os
import tempfile
from typing import List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.orm import Session
from sqlalchemy import func, case
from ..database import get_db
from ..models import User, FileItem, ShareLink
from ..schemas import FileResponse, FileCreateResponse
from ..security import get_current_user
from ..storage import generate_object_key, upload_file_streaming, delete_file

router = APIRouter(prefix="/api/files", tags=["Files"])

MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024  # 50 MB
CHUNK_SIZE = 1 * 1024 * 1024            # 1 MB read chunks

# Allowed file extensions matching encrypt.js validation
ALLOWED_EXTENSIONS = {
    ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".txt", ".md", ".json", ".js", ".py", ".html", ".css", ".csv", ".log",
}

# Extension to MIME type mapping
EXTENSION_TO_MIME = {
    ".pdf":  "application/pdf",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif":  "image/gif",
    ".webp": "image/webp",
    ".txt":  "text/plain",
    ".md":   "text/markdown",
    ".json": "application/json",
    ".js":   "text/javascript",
    ".py":   "text/x-python",
    ".html": "text/html",
    ".css":  "text/css",
    ".csv":  "text/csv",
    ".log":  "text/plain",
}

@router.post("", response_model=FileCreateResponse)
async def upload_encrypted_file(
    file: UploadFile = File(...),
    original_filename: str = Form(...),
    iv_hex: str = Form(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Filename validation — check extension against allow-list before reading
    clean_filename = os.path.basename(original_filename.strip())
    ext = os.path.splitext(clean_filename)[1].lower()

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type '{ext}' is not supported. Allowed types: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    # Derive MIME type from extension
    mime_type = EXTENSION_TO_MIME[ext]

    # Read upload in bounded chunks into a spooled temp file.
    # SpooledTemporaryFile holds data in memory up to CHUNK_SIZE then spills
    # to disk, keeping heap usage proportional to CHUNK_SIZE, not file size.
    total_bytes = 0
    spooled = tempfile.SpooledTemporaryFile(max_size=CHUNK_SIZE)
    try:
        while True:
            chunk = await file.read(CHUNK_SIZE)
            if not chunk:
                break
            total_bytes += len(chunk)
            if total_bytes > MAX_FILE_SIZE_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="File size exceeds maximum limit of 50 MB.",
                )
            spooled.write(chunk)
    except HTTPException:
        spooled.close()
        raise

    if total_bytes == 0:
        spooled.close()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file cannot be empty.",
        )

    spooled.seek(0)

    # Upload ciphertext to R2 then persist metadata.
    # On any failure after the object is created, delete it to avoid orphans.
    object_key = generate_object_key()
    try:
        upload_file_streaming(object_key, spooled, content_type=mime_type)

        file_record = FileItem(
            owner_id=current_user.id,
            r2_object_key=object_key,
            original_filename=clean_filename,
            mime_type=mime_type,
            size=total_bytes,
            iv_hex=iv_hex.strip(),
        )
        db.add(file_record)
        db.commit()
        db.refresh(file_record)
    except Exception:
        delete_file(object_key)
        raise
    finally:
        spooled.close()

    return FileCreateResponse.model_validate(file_record)

@router.get("", response_model=List[FileResponse])
def list_files(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    files = (
        db.query(FileItem)
        .filter(FileItem.owner_id == current_user.id)
        .order_by(FileItem.created_at.desc())
        .all()
    )

    if not files:
        return []

    # Batch query for share statistics to eliminate N+1
    file_ids = [f.id for f in files]

    share_stats = (
        db.query(
            ShareLink.file_id,
            func.count(case((ShareLink.revoked == False, 1))).label("active_shares"),
            func.coalesce(func.sum(ShareLink.download_count), 0).label("total_downloads"),
        )
        .filter(ShareLink.file_id.in_(file_ids))
        .group_by(ShareLink.file_id)
        .all()
    )

    stats_map = {row.file_id: row for row in share_stats}

    result = []
    for f in files:
        stats = stats_map.get(f.id)
        res = FileResponse.model_validate(f)
        res.active_shares_count = stats.active_shares if stats else 0
        res.total_downloads = stats.total_downloads if stats else 0
        result.append(res)

    return result

@router.get("/{file_id}", response_model=FileResponse)
def get_file_detail(
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    f = db.query(FileItem).filter(
        FileItem.id == file_id,
        FileItem.owner_id == current_user.id,
    ).first()

    if not f:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    share_stats = (
        db.query(
            ShareLink.file_id,
            func.count(case((ShareLink.revoked == False, 1))).label("active_shares"),
            func.coalesce(func.sum(ShareLink.download_count), 0).label("total_downloads"),
        )
        .filter(ShareLink.file_id == f.id)
        .group_by(ShareLink.file_id)
        .first()
    )

    res = FileResponse.model_validate(f)
    res.active_shares_count = share_stats.active_shares if share_stats else 0
    res.total_downloads = share_stats.total_downloads if share_stats else 0
    return res

@router.delete("/{file_id}")
def delete_file_record(
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    f = db.query(FileItem).filter(
        FileItem.id == file_id,
        FileItem.owner_id == current_user.id,
    ).first()

    if not f:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    delete_file(f.r2_object_key)

    db.delete(f)
    db.commit()
    return {"status": "success", "message": "File deleted successfully"}
