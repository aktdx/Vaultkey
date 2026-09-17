"""
Cloudflare R2 storage module for VaultKey.

R2 exposes an S3-compatible API, so we use boto3 with a custom endpoint.
All public surface:
  - upload_file(key, data) -> None          (bytes path, kept for compatibility)
  - upload_file_streaming(key, fileobj, content_type) -> None  (streaming path)
  - download_file(key) -> bytes
  - delete_file(key) -> None
  - generate_object_key() -> str
"""

import os
import uuid
import boto3
from boto3.s3.transfer import TransferConfig
from botocore.exceptions import ClientError
from fastapi import HTTPException, status

# ── Configuration ─────────────────────────────────────────────────────────────

R2_ACCOUNT_ID      = os.environ.get("R2_ACCOUNT_ID")
R2_ACCESS_KEY_ID   = os.environ.get("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME     = os.environ.get("R2_BUCKET_NAME")

_MISSING = [
    name for name, val in {
        "R2_ACCOUNT_ID":       R2_ACCOUNT_ID,
        "R2_ACCESS_KEY_ID":    R2_ACCESS_KEY_ID,
        "R2_SECRET_ACCESS_KEY": R2_SECRET_ACCESS_KEY,
        "R2_BUCKET_NAME":      R2_BUCKET_NAME,
    }.items()
    if not val
]

if _MISSING:
    raise RuntimeError(
        f"Missing required R2 environment variables: {', '.join(_MISSING)}"
    )

R2_ENDPOINT_URL = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

# R2 minimum multipart part size is 5 MB (same as AWS S3).
_MULTIPART_THRESHOLD = 5 * 1024 * 1024  # 5 MB
_MULTIPART_CHUNKSIZE = 5 * 1024 * 1024  # 5 MB

_TRANSFER_CONFIG = TransferConfig(
    multipart_threshold=_MULTIPART_THRESHOLD,
    multipart_chunksize=_MULTIPART_CHUNKSIZE,
)

# ── Client (lazy singleton) ────────────────────────────────────────────────────

_s3_client = None

def _get_client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client(
            "s3",
            endpoint_url=R2_ENDPOINT_URL,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            region_name="auto",  # R2 uses 'auto' as the region
        )
    return _s3_client

# ── Public helpers ─────────────────────────────────────────────────────────────

def generate_object_key() -> str:
    """Return a random, non-guessable R2 object key for an encrypted file."""
    return f"uploads/{uuid.uuid4().hex}.enc"

def upload_file(key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    """Upload raw bytes to R2 under the given key.

    Retained for compatibility. The upload endpoint uses upload_file_streaming
    instead to avoid buffering the full file in application memory.
    """
    try:
        _get_client().put_object(
            Bucket=R2_BUCKET_NAME,
            Key=key,
            Body=data,
            ContentType=content_type,
        )
    except ClientError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to upload file to storage: {exc.response['Error']['Message']}",
        ) from exc

def upload_file_streaming(
    key: str,
    fileobj,
    content_type: str = "application/octet-stream",
) -> None:
    """Upload a file-like object to R2 without buffering it fully in memory.

    Uses boto3 upload_fileobj which invokes the S3 Transfer Manager.
    Objects larger than _MULTIPART_THRESHOLD (5 MB) use multipart upload;
    smaller objects use a single PUT. Peak memory per upload is bounded by
    _MULTIPART_CHUNKSIZE (5 MB), not the total file size.

    Args:
        key:          R2 object key (from generate_object_key()).
        fileobj:      Readable binary file-like object positioned at byte 0.
        content_type: MIME type stored as object metadata.
    """
    try:
        _get_client().upload_fileobj(
            fileobj,
            R2_BUCKET_NAME,
            key,
            ExtraArgs={"ContentType": content_type},
            Config=_TRANSFER_CONFIG,
        )
    except ClientError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to upload file to storage: {exc.response['Error']['Message']}",
        ) from exc

def download_file(key: str) -> bytes:
    """Download an object from R2 and return its raw bytes."""
    try:
        response = _get_client().get_object(Bucket=R2_BUCKET_NAME, Key=key)
        return response["Body"].read()
    except ClientError as exc:
        error_code = exc.response["Error"]["Code"]
        if error_code in ("NoSuchKey", "404"):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Encrypted file payload missing.",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to retrieve file from storage: {exc.response['Error']['Message']}",
        ) from exc

def delete_file(key: str) -> None:
    """Delete an object from R2. Silently ignores missing keys."""
    try:
        _get_client().delete_object(Bucket=R2_BUCKET_NAME, Key=key)
    except ClientError as exc:
        error_code = exc.response["Error"]["Code"]
        if error_code in ("NoSuchKey", "404"):
            return  # already gone — treat as success
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to delete file from storage: {exc.response['Error']['Message']}",
        ) from exc
