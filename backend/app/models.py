import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Boolean, DateTime, Enum as SAEnum
from sqlalchemy import ForeignKey
from sqlalchemy.orm import relationship
from .database import Base
import enum


class AccessMode(str, enum.Enum):
    """
    Controls how a recipient may interact with shared content.
    DOWNLOAD  – recipient may download the decrypted file to disk (default behaviour).
    VIEW_ONLY – recipient may only view the content in-browser; the backend will reject
                any direct download API call and the frontend shows a restricted viewer.
    """
    DOWNLOAD = "download"
    VIEW_ONLY = "view_only"

def generate_uuid():
    return str(uuid.uuid4())

class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    files = relationship("FileItem", back_populates="owner", cascade="all, delete-orphan")
    shares = relationship("ShareLink", back_populates="owner", cascade="all, delete-orphan")
    access_logs = relationship("AccessLog", back_populates="owner", cascade="all, delete-orphan")

class FileItem(Base):
    __tablename__ = "files"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    owner_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    r2_object_key = Column(String(512), nullable=False)   # e.g. "uploads/<uuid>.enc"
    original_filename = Column(String(255), nullable=False)
    mime_type = Column(String(100), nullable=True, default=None)
    size = Column(Integer, nullable=False)
    iv_hex = Column(String(64), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    owner = relationship("User", back_populates="files")
    shares = relationship("ShareLink", back_populates="file", cascade="all, delete-orphan")
    access_logs = relationship("AccessLog", back_populates="file", cascade="all, delete-orphan")

class ShareLink(Base):
    __tablename__ = "shares"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    file_id = Column(String(36), ForeignKey("files.id", ondelete="CASCADE"), nullable=False)
    owner_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash = Column(String(64), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    # access_mode controls how recipients may interact with the shared file.
    # "download"  – recipient may download the decrypted file (legacy default).
    # "view_only" – backend rejects the download endpoint; frontend uses restricted viewer.
    access_mode = Column(
        String(20),
        nullable=False,
        default=AccessMode.DOWNLOAD.value,
        server_default=AccessMode.DOWNLOAD.value,
    )
    max_downloads = Column(Integer, default=5)
    download_count = Column(Integer, default=0)
    password_hash = Column(String(255), nullable=True)
    revoked = Column(Boolean, default=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    file = relationship("FileItem", back_populates="shares")
    owner = relationship("User", back_populates="shares")
    access_logs = relationship("AccessLog", back_populates="share", cascade="all, delete-orphan")

class AccessLog(Base):
    __tablename__ = "access_logs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    share_id = Column(String(36), ForeignKey("shares.id", ondelete="CASCADE"), nullable=True)
    file_id = Column(String(36), ForeignKey("files.id", ondelete="CASCADE"), nullable=True)
    owner_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    event = Column(String(50), nullable=False)  # LINK_CREATED, METADATA_CHECK, ACCESS_ATTEMPT, ACCESS_GRANTED, ACCESS_DENIED, PASSWORD_FAILED, FILE_DOWNLOADED, FILE_VIEWED, VIEW_STARTED, VIEW_COMPLETED, PRINT_BLOCKED, DOWNLOAD_BLOCKED, SAVE_ATTEMPT_BLOCKED, LINK_EXPIRED, LINK_REVOKED
    status = Column(String(20), nullable=False) # SUCCESS, DENIED, FAILED
    user_agent = Column(String(512), nullable=True)
    ip_address = Column(String(100), nullable=True)
    timestamp = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    share = relationship("ShareLink", back_populates="access_logs")
    file = relationship("FileItem", back_populates="access_logs")
    owner = relationship("User", back_populates="access_logs")
