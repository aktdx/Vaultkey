"""
Shared utility functions for VaultKey backend.
"""
from datetime import datetime, timezone
from fastapi import Request
from sqlalchemy.orm import Session
from .models import AccessLog, ShareLink


def make_aware(dt: datetime | None) -> datetime | None:
    """
    Ensure a datetime is timezone-aware (UTC).
    Handles legacy naive datetimes already stored in the database before
    the DateTime(timezone=True) migration, treating them as UTC.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        # Naive datetime — assume UTC (all values were written as UTC)
        return dt.replace(tzinfo=timezone.utc)
    return dt


def get_client_ip(request: Request) -> str | None:
    """
    Extract the real client IP address from the request.
    
    In production environments with reverse proxies (e.g., Heroku, Railway, Render),
    the X-Forwarded-For header contains the client IP.
    
    Args:
        request: FastAPI request object
        
    Returns:
        The client IP address, or None if unavailable
        
    Note:
        This trusts the X-Forwarded-For header. In untrusted proxy environments,
        consider using Uvicorn's ProxyHeadersMiddleware with proxy_headers=True.
    """
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        # Take the leftmost (original client) IP, strip whitespace
        return xff.split(",")[0].strip()
    return request.client.host if request.client else None


def log_event(
    db: Session,
    share: ShareLink,
    event: str,
    log_status: str,
    request: Request,
) -> None:
    """
    Stage a single access-log entry for *share*.

    Does NOT commit — the caller owns the transaction boundary.
    Call db.commit() (or db.flush() if a generated ID is needed first)
    after log_event() returns.

    Args:
        db: Database session
        share: The ShareLink being accessed
        event: Event type (e.g., LINK_CREATED, ACCESS_GRANTED, FILE_DOWNLOADED)
        log_status: Status (SUCCESS, DENIED, FAILED)
        request: FastAPI request object to extract user_agent and IP
    """
    user_agent = request.headers.get("user-agent")
    client_ip = get_client_ip(request)

    db.add(AccessLog(
        share_id=share.id,
        file_id=share.file_id,
        owner_id=share.owner_id,
        event=event,
        status=log_status,
        user_agent=user_agent,
        ip_address=client_ip,
    ))
