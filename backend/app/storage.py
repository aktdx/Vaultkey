"""
Cloudflare R2 storage module for VaultKey.

R2 exposes an S3-compatible API, so we use boto3 with a custom endpoint.
All public surface:
  - upload_file(key, data) -> None          (bytes path, kept for compatibility)
  - upload_file_streaming(key, fileobj, content_type) -> None  (streaming path)
  - open_file_stream(key) -> ContextManager  (streaming download, preferred)
  - _open_body(key) -> StreamingBody         (sync helper for direct callers)
  - download_file(key) -> bytes              (DEPRECATED -- loads full object into memory)
  - delete_file(key) -> None
  - generate_object_key() -> str

All blocking boto3 calls must be run off the event loop via
starlette.concurrency.run_in_threadpool. See routes/files.py and routes/access.py.
ponytail: anyio's default CapacityLimiter is 40 threads; if R2 throughput becomes
a bottleneck, pass an explicit limiter= to run_in_threadpool at the call sites.
"""

import os
import uuid
from contextlib import contextmanager
import boto3
from boto3.s3.transfer import TransferConfig
from botocore.config import Config
from botocore.exceptions import ClientError
from fastapi import HTTPException, status

# ── Configuration ─────────────────────────────────────────────────────────────

R2_ACCOUNT_ID        = os.environ.get("R2_ACCOUNT_ID")
R2_ACCESS_KEY_ID     = os.environ.get("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME       = os.environ.get("R2_BUCKET_NAME")

_MISSING = [
    name for name, val in {
        "R2_ACCOUNT_ID":        R2_ACCOUNT_ID,
        "R2_ACCESS_KEY_ID":     R2_ACCESS_KEY_ID,
        "R2_SECRET_ACCESS_KEY": R2_SECRET_ACCESS_KEY,
        "R2_BUCKET_NAME":       R2_BUCKET_NAME,
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

# Deterministic timeouts: 5 s to establish a connection, 60 s to receive data.
# 60 s covers large PUT bodies up to 50 MB on a slow link; GET objects are
# typically much smaller but share the same client instance.
# ponytail: if you need separate read timeouts for GET vs PUT, create two
# client singletons — _s3_read_client (read_timeout=30) and _s3_write_client
# (read_timeout=60) — and select by operation in each public function.
_CLIENT_CONFIG = Config(connect_timeout=5, read_timeout=60)

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
            config=_CLIENT_CONFIG,
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

# ── Future scalability option: R2 presigned URLs ──────────────────────────────
# After authorization checks pass, you could generate a short-lived presigned
# URL and redirect the client directly to R2, bypassing the API worker for the
# data transfer entirely. This eliminates backend bandwidth for large files.
# Trade-offs: presigned URLs cannot be revoked mid-flight; audit logging is
# limited to the redirect event; rate limiting applies only to the redirect;
# custom response headers (X-IV-Hex etc.) require a separate mechanism.
# Implement this when concurrent 50 MB+ downloads saturate the API worker's
# network interface. See: boto3 generate_presigned_url("get_object", ...).
# ─────────────────────────────────────────────────────────────────────────────

def _open_body(key: str):
    """Open an R2 object and return its raw StreamingBody without reading it.

    Synchronous blocking function. FastAPI dispatches sync route handlers in a
    threadpool automatically, so calling this directly from a sync def route is
    safe. For async routes use run_in_threadpool.

    The caller is responsible for closing the returned body. Prefer
    open_file_stream() when a context manager is more convenient.

    Raises:
        HTTPException(404): if the object key does not exist in R2.
        HTTPException(502): for any other R2 / network error.
    """
    try:
        response = _get_client().get_object(Bucket=R2_BUCKET_NAME, Key=key)
        return response["Body"]
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

@contextmanager
def open_file_stream(key: str):
    """Context manager that opens an R2 object and yields its StreamingBody.

    Guarantees the body is closed when the with-block exits, whether normally
    or via an exception.

    Example:
        with open_file_stream(key) as body:
            for chunk in body.iter_chunks(1024 * 1024):
                process(chunk)

    Raises:
        HTTPException(404): if the object key does not exist in R2.
        HTTPException(502): for any other R2 / network error.
    """
    body = _open_body(key)
    try:
        yield body
    finally:
        body.close()

def download_file(key: str) -> bytes:
    """Download an object from R2 and return its raw bytes.

    Deprecated: use open_file_stream() or _open_body() instead. This function
    loads the entire object into memory and is retained only for test
    compatibility. For download/view endpoints use _open_body() with a
    StreamingResponse to keep backend memory bounded at one chunk per request.
    """
    with open_file_stream(key) as body:
        return body.read()

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
