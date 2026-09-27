# Bugfix Requirements Document

## Introduction

This document covers five security vulnerabilities in the VaultKey application. The issues span the backend API (CORS misconfiguration, missing rate limiting, duplicated audit-logging code, and a stale schema file) and the frontend encryption layer (absent file-content validation). Together they expose the application to credential theft via CORS bypass, brute-force and download-limit attacks on unauthenticated endpoints, silent audit-trail gaps, and encrypted storage of files whose content was never validated.

---

## Bug Analysis

### Issue 2 — CORS Wildcard Enabled

#### Current Behavior (Defect)

1.1 WHEN any origin sends a credentialed request (cookies or `Authorization` header) to the VaultKey API THEN the server accepts and responds because `"*"` is present in the `allow_origins` list alongside `allow_credentials=True`, bypassing same-origin protections.

1.2 WHEN the `origins` list in `main.py` is changed for production THEN the wildcard `"*"` entry remains hardcoded, so the restriction has no effect.

#### Expected Behavior (Correct)

2.1 WHEN a credentialed request arrives from an origin that is not in the configured allow-list THEN the server SHALL reject the preflight and omit `Access-Control-Allow-Origin` from the response.

2.2 WHEN the allowed-origin list is configured via the `ALLOWED_ORIGINS` environment variable THEN the server SHALL read that value at startup, split it on commas, and use the resulting list as the sole set of permitted origins, with no hardcoded wildcard present.

2.3 WHEN `ALLOWED_ORIGINS` is not set THEN the server SHALL fall back to `http://localhost:5173,http://127.0.0.1:5173` as the default allowed origins.

#### Unchanged Behavior (Regression Prevention)

3.1 WHEN a request arrives from a listed allowed origin THEN the server SHALL CONTINUE TO respond with the correct `Access-Control-Allow-Origin` header and honour credentialed requests.

3.2 WHEN `expose_headers` is configured for `X-IV-Hex` and `X-Original-Filename` THEN the server SHALL CONTINUE TO expose those headers to allowed origins.

---

**Bug Condition (Issue 2):**

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type HttpRequest
  OUTPUT: boolean

  RETURN X.origin NOT IN allowedOrigins AND credentialed(X)
END FUNCTION

// Fix Checking
FOR ALL X WHERE isBugCondition(X) DO
  result ← handleCors'(X)
  ASSERT result.accessControlAllowOrigin IS NULL
END FOR

// Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT handleCors(X) = handleCors'(X)
END FOR
```

---

### Issue 3 — No Rate Limiting on Public Endpoints

#### Current Behavior (Defect)

1.1 WHEN an attacker sends unlimited `POST /api/access/{token}/authorize` requests with different passwords THEN the system processes every request without throttling, enabling password brute-forcing against password-protected share links.

1.2 WHEN an attacker sends unlimited `POST /api/access/{token}/download` requests THEN the system processes every request without throttling, allowing attempts to bypass or probe the download-count limit.

#### Expected Behavior (Correct)

2.1 WHEN a client sends more than 5 requests to `POST /api/access/{token}/authorize` within a 60-second window from the same IP THEN the server SHALL return HTTP 429 Too Many Requests and reject the request without processing it.

2.2 WHEN a client sends more than 5 requests to `POST /api/access/{token}/download` within a 60-second window from the same IP THEN the server SHALL return HTTP 429 Too Many Requests and reject the request without processing it.

2.3 WHEN `slowapi` raises a rate-limit exception THEN the server SHALL register a global exception handler that returns a structured JSON 429 response.

#### Unchanged Behavior (Regression Prevention)

3.1 WHEN a legitimate client sends 5 or fewer requests within a 60-second window THEN the server SHALL CONTINUE TO process those requests normally without throttling.

3.2 WHEN the `GET /api/access/{token}` check endpoint is called THEN the server SHALL CONTINUE TO respond without rate-limit interference from the `POST` route limiters.

---

**Bug Condition (Issue 3):**

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type HttpRequest
  OUTPUT: boolean

  RETURN (X.path IN ["/api/access/{token}/authorize", "/api/access/{token}/download"])
     AND requestCountInWindow(X.ip, 60s) > 5
END FUNCTION

// Fix Checking
FOR ALL X WHERE isBugCondition(X) DO
  result ← handleRequest'(X)
  ASSERT result.statusCode = 429
END FOR

// Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT handleRequest(X) = handleRequest'(X)
END FOR
```

---

### Issue 5 — No File-Content Validation Before Encryption

#### Current Behavior (Defect)

1.1 WHEN a user selects a file whose extension is `.pdf` but whose actual byte content is not a PDF THEN the frontend encrypts and uploads the file without any content validation.

1.2 WHEN a user selects a text-based file (`.txt`, `.md`, `.json`, etc.) that contains null bytes THEN the frontend encrypts and uploads the file without flagging the anomaly.

1.3 WHEN the backend receives an upload THEN it validates only the filename extension and does not inspect the file bytes, so a misnamed binary payload passes through.

#### Expected Behavior (Correct)

2.1 WHEN a user selects a file with extension `.pdf`, `.png`, `.jpg`, `.jpeg`, `.gif`, or `.webp` THEN the frontend SHALL read the file's first bytes before encrypting and SHALL reject the file with a descriptive error if those bytes do not match the known magic-byte signature for that extension.

2.2 WHEN a user selects a text or code file (`.txt`, `.md`, `.json`, `.js`, `.py`, `.html`, `.css`, `.csv`, `.log`) THEN the frontend SHALL scan the file bytes before encrypting and SHALL reject the file with a descriptive error if null bytes (`0x00`) are present.

2.3 WHEN the backend receives an upload THEN it SHALL CONTINUE TO check that the filename extension is in the allowed list as a second layer of defense.

#### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user selects a valid `.pdf` file whose first bytes are `%PDF` THEN the system SHALL CONTINUE TO encrypt and upload it successfully.

3.2 WHEN a user selects a valid image file whose magic bytes match its extension THEN the system SHALL CONTINUE TO encrypt and upload it successfully.

3.3 WHEN a user selects a valid text file that contains no null bytes THEN the system SHALL CONTINUE TO encrypt and upload it successfully.

---

**Bug Condition (Issue 5):**

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type FileUpload
  OUTPUT: boolean

  RETURN (isBinaryExtension(X.extension) AND NOT matchesMagicBytes(X.bytes, X.extension))
      OR (isTextExtension(X.extension) AND containsNullBytes(X.bytes))
END FUNCTION

// Fix Checking
FOR ALL X WHERE isBugCondition(X) DO
  result ← validateFile'(X)
  ASSERT result.rejected = true AND result.error IS NOT NULL
END FOR

// Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT validateFile(X) = validateFile'(X)
END FOR
```

---

### Issue 8 — Duplicated Inline Audit-Logging and Missing Log Entries

#### Current Behavior (Defect)

1.1 WHEN `download_encrypted_file` raises an `HTTPException` because the share link is revoked THEN no `AccessLog` record is written to the database, leaving a gap in the audit trail.

1.2 WHEN `download_encrypted_file` raises an `HTTPException` because the share link is expired THEN no `AccessLog` record is written to the database, leaving a gap in the audit trail.

1.3 WHEN any endpoint in `routes/access.py` records an audit event THEN it constructs an `AccessLog(...)` object inline and calls `db.add(...)` and `db.commit()` directly, duplicating the same boilerplate across approximately 10 call sites.

#### Expected Behavior (Correct)

2.1 WHEN `download_encrypted_file` detects a revoked share link THEN it SHALL write an `ACCESS_DENIED` / `DENIED` log entry before raising the `HTTPException`.

2.2 WHEN `download_encrypted_file` detects an expired share link THEN it SHALL write a `LINK_EXPIRED` / `DENIED` log entry before raising the `HTTPException`.

2.3 WHEN any access event occurs THEN the code SHALL delegate log creation to a single `_log_event(db, share, event, log_status, request)` helper function, eliminating duplicated inline `db.add` / `db.commit` calls.

#### Unchanged Behavior (Regression Prevention)

3.1 WHEN an `ACCESS_DENIED`, `LINK_EXPIRED`, `PASSWORD_FAILED`, `ACCESS_GRANTED`, `FILE_DOWNLOADED`, `FILE_VIEWED`, `METADATA_CHECK`, or `ACCESS_ATTEMPT` event occurs THEN the system SHALL CONTINUE TO persist the same fields (share_id, file_id, owner_id, event, status, user_agent, ip_address) as before.

3.2 WHEN the `check_recipient_access` endpoint logs events THEN the system SHALL CONTINUE TO produce identical log records to those produced before the refactor.

---

**Bug Condition (Issue 8):**

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type DownloadRequest
  OUTPUT: boolean

  RETURN share(X).revoked = true OR share(X).expired = true
END FUNCTION

// Fix Checking
FOR ALL X WHERE isBugCondition(X) DO
  result ← downloadEncryptedFile'(X)
  ASSERT accessLogExists(X, event IN ["ACCESS_DENIED", "LINK_EXPIRED"])
END FOR

// Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT accessLogCount(X) = accessLogCount'(X)
    AND accessLogFields(X) = accessLogFields'(X)
END FOR
```

---

### Issue 11 — `database/schema.sql` Out of Sync with `models.py`

#### Current Behavior (Defect)

1.1 WHEN `database/schema.sql` is applied to a fresh PostgreSQL database THEN it creates the `users` table with `email NOT NULL` and `hashed_password NOT NULL` and no `firebase_uid` column, which may conflict with future model changes that make those fields nullable or add Firebase support.

1.2 WHEN `main.py` starts the application THEN it calls `Base.metadata.create_all(bind=engine)`, making `schema.sql` redundant for runtime use; however, `schema.sql` remaining in the repository creates a false source of truth for operators provisioning new databases.

#### Expected Behavior (Correct)

2.1 WHEN a developer or operator needs the authoritative database schema THEN the `schema.sql` file SHALL accurately reflect the current SQLAlchemy models, or the file SHALL be removed so that `Base.metadata.create_all` is the single source of truth.

2.2 WHEN `schema.sql` is retained THEN it SHALL reflect the actual column nullability and column set defined in `models.py` (including any `firebase_uid` column if added, and correct `NOT NULL` constraints).

#### Unchanged Behavior (Regression Prevention)

3.1 WHEN the application starts THEN it SHALL CONTINUE TO call `Base.metadata.create_all(bind=engine)` to initialise tables from the live models.

3.2 WHEN existing tables already exist in the database THEN `create_all` SHALL CONTINUE TO be a no-op and not drop or alter them.

---

**Bug Condition (Issue 11):**

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type DatabaseProvisioningAttempt
  OUTPUT: boolean

  RETURN X.usesSchemaSQL = true
     AND schemaSQL.users.email.nullable != models.User.email.nullable
END FUNCTION

// Fix Checking
FOR ALL X WHERE isBugCondition(X) DO
  result ← provisionDatabase'(X)
  ASSERT schemaSQL MATCHES models OR schemaSQL NOT EXISTS
END FOR

// Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT provisionDatabase(X) = provisionDatabase'(X)
END FOR
```
