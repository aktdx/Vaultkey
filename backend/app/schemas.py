from typing import Optional, List, Literal
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, field_validator

# Auth Schemas
class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    created_at: datetime

    class Config:
        from_attributes = True

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

class GoogleAuthRequest(BaseModel):
    id_token: str

# File Schemas
class FileCreateResponse(BaseModel):
    id: str
    original_filename: str
    size: int
    mime_type: str
    iv_hex: str
    created_at: datetime

    class Config:
        from_attributes = True

class FileResponse(BaseModel):
    id: str
    original_filename: str
    size: int
    mime_type: str
    iv_hex: str
    created_at: datetime
    active_shares_count: int = 0
    total_downloads: int = 0

    class Config:
        from_attributes = True

# Share Schemas
class ShareCreateRequest(BaseModel):
    file_id: str
    expiration_hours: Optional[int] = None # None, 1, 6, 24, 72 (3 days), 168 (7 days)
    max_downloads: int = Field(5, ge=0, le=10)
    # access_mode explicitly controls share behaviour at both API and UI level.
    # "download"  – recipient may retrieve and save the decrypted file (default).
    # "view_only" – backend rejects /download; frontend shows restricted viewer only.
    access_mode: Literal["download", "view_only"] = "download"

    password: Optional[str] = None
    # Secure key wrapping fields (zero-knowledge)
    wrapped_fek: Optional[str] = None
    kdf_salt: Optional[str] = None
    kdf_iterations: Optional[int] = 600000
    kdf_algorithm: Optional[str] = "PBKDF2-HMAC-SHA-256"
    wrapping_iv: Optional[str] = None
    password_hash: Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v):
        if v is not None and len(v.strip()) > 0 and len(v.strip()) < 4:
            raise ValueError("Share password must be at least 4 characters.")
        return v

class ShareCreateResponse(BaseModel):
    share_id: str
    token: str  # Unpredictable high-entropy raw token returned ONCE to the creator
    file_id: str
    original_filename: str
    expires_at: Optional[datetime]
    max_downloads: int
    access_mode: str  # "download" | "view_only"
    has_password: bool
    created_at: datetime
    wrapped_fek: Optional[str] = None
    kdf_salt: Optional[str] = None
    kdf_iterations: Optional[int] = None
    kdf_algorithm: Optional[str] = None
    wrapping_iv: Optional[str] = None

class ShareDetailResponse(BaseModel):
    id: str
    file_id: str
    original_filename: str
    expires_at: Optional[datetime]
    max_downloads: int
    download_count: int
    access_mode: str  # "download" | "view_only"
    has_password: bool
    revoked: bool
    revoked_at: Optional[datetime]
    created_at: datetime
    status: str # ACTIVE, EXPIRED, REVOKED, LIMIT_REACHED, VIEW_ONLY
    wrapped_fek: Optional[str] = None
    kdf_salt: Optional[str] = None
    kdf_iterations: Optional[int] = None
    kdf_algorithm: Optional[str] = None
    wrapping_iv: Optional[str] = None

    class Config:
        from_attributes = True

# Access / Recipient Schemas
class RecipientCheckResponse(BaseModel):
    valid: bool
    share_id: Optional[str] = None
    original_filename: str
    file_size: int
    expires_at: Optional[datetime]
    max_downloads: int
    downloads_remaining: int
    access_mode: str  # "download" | "view_only"
    requires_password: bool
    revoked: bool
    status: str  # OK, EXPIRED, REVOKED, LIMIT_REACHED, INVALID
    wrapped_fek: Optional[str] = None
    kdf_salt: Optional[str] = None
    kdf_iterations: Optional[int] = None
    kdf_algorithm: Optional[str] = None
    wrapping_iv: Optional[str] = None

class RecipientAuthorizeRequest(BaseModel):
    password: Optional[str] = None
    password_hash: Optional[str] = None


# Recipient-side audit reporting (client fires this when a restricted action is blocked).
# The backend records the event in the shared owner's activity log so they know
# the restriction was triggered.  No sensitive data (key, blob content) is included.
class BlockedActionReportRequest(BaseModel):
    # Must be one of the allowed restricted-action event types only.
    event: Literal[
        "PRINT_BLOCKED",
        "DOWNLOAD_BLOCKED",
        "SAVE_ATTEMPT_BLOCKED",
        "VIEW_STARTED",
        "VIEW_COMPLETED",
    ]

# Activity Log Schema
class ActivityLogResponse(BaseModel):
    id: str
    file_id: Optional[str]
    filename: Optional[str]
    event: str
    status: str
    user_agent: Optional[str]
    ip_address: Optional[str] = None
    timestamp: datetime

    class Config:
        from_attributes = True

