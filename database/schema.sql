-- VaultKey Database Schema
-- ============================================================
-- IMPORTANT: This file is a reference only.
-- The authoritative schema is generated at runtime by
--   Base.metadata.create_all(bind=engine)   (backend/app/main.py)
-- Keep this file in sync with backend/app/models.py.
-- Last synced: 2026-09-06
-- ============================================================


-- 1. Users
CREATE TABLE IF NOT EXISTS users (
    id               VARCHAR(36)  PRIMARY KEY,
    email            VARCHAR(255) NOT NULL UNIQUE,
    hashed_password  VARCHAR(255) NOT NULL,
    created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);


-- 2. Files (metadata only — ciphertext lives in Cloudflare R2)
CREATE TABLE IF NOT EXISTS files (
    id                VARCHAR(36)  PRIMARY KEY,
    owner_id          VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    r2_object_key     VARCHAR(512) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    mime_type         VARCHAR(100) NULL,   -- e.g. application/pdf, image/png, text/plain
    size              INTEGER      NOT NULL,
    iv_hex            VARCHAR(64)  NOT NULL,
    created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_id);


-- 3. Share links
CREATE TABLE IF NOT EXISTS shares (
    id             VARCHAR(36)  PRIMARY KEY,
    file_id        VARCHAR(36)  NOT NULL REFERENCES files(id)  ON DELETE CASCADE,
    owner_id       VARCHAR(36)  NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    token_hash     VARCHAR(64)  NOT NULL UNIQUE,
    expires_at     TIMESTAMP    NULL,
    max_downloads  INTEGER      DEFAULT 5,
    download_count INTEGER      DEFAULT 0,
    password_hash  VARCHAR(255) NULL,
    revoked        BOOLEAN      DEFAULT FALSE,
    revoked_at     TIMESTAMP    NULL,
    created_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shares_token  ON shares(token_hash);
CREATE INDEX IF NOT EXISTS idx_shares_file   ON shares(file_id);
CREATE INDEX IF NOT EXISTS idx_shares_owner  ON shares(owner_id);


-- 4. Access logs
-- event values : LINK_CREATED, METADATA_CHECK, ACCESS_ATTEMPT, ACCESS_GRANTED, ACCESS_DENIED,
--                PASSWORD_FAILED, FILE_DOWNLOADED, FILE_VIEWED,
--                LINK_EXPIRED, LINK_REVOKED
-- status values: SUCCESS, DENIED, FAILED
CREATE TABLE IF NOT EXISTS access_logs (
    id         VARCHAR(36)  PRIMARY KEY,
    share_id   VARCHAR(36)  NULL REFERENCES shares(id) ON DELETE CASCADE,
    file_id    VARCHAR(36)  NULL REFERENCES files(id)  ON DELETE CASCADE,
    owner_id   VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event      VARCHAR(50)  NOT NULL,
    status     VARCHAR(20)  NOT NULL,
    user_agent VARCHAR(512) NULL,
    ip_address VARCHAR(100) NULL,
    timestamp  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_logs_owner ON access_logs(owner_id);
CREATE INDEX IF NOT EXISTS idx_logs_file  ON access_logs(file_id);
CREATE INDEX IF NOT EXISTS idx_logs_share ON access_logs(share_id);
