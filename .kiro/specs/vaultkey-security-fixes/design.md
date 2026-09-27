# VaultKey Security Fixes — Bugfix Design

## Overview

VaultKey's security and quality audit identified 10 issues spanning critical authentication vulnerabilities, missing rate limiting, insecure token storage, insufficient file validation, silent failure modes, and code quality gaps. This design formalizes the bug condition for each issue, defines the expected correct behavior, hypothesizes root causes, and plans the implementation and validation strategy.

The fixes are purely corrective — no new user-facing features are introduced. The scope covers `backend/app/security.py`, `backend/app/main.py`, `backend/app/routes/auth.py`, `backend/app/routes/access.py`, `backend/app/routes/files.py`, `backend/app/models.py`, `backend/app/database.py`, `frontend/src/crypto/encrypt.js`, `frontend/src/services/api.js`, `frontend/src/services/authService.js`, and `frontend/src/context/AuthContext.jsx`.

---

## Glossary

- **Bug_Condition (C)**: A predicate that evaluates to `true` for inputs or system states that expose the defect.
- **Property (P)**: The desired behavior the fixed system must exhibit when `C(X)` is true.
- **Preservation**: Existing correct behaviors that must remain unchanged after each fix.
- **isBugCondition(input)**: Pseudocode function encoding `C(X)` for a specific issue.
- **expectedBehavior(result)**: Pseudocode function encoding `P(result)` for the corrected output.
- **jti**: JWT ID claim — a unique identifier embedded in each token used for revocation lookup.
- **httpOnly cookie**: A browser cookie inaccessible to JavaScript, eliminating XSS-based token theft.
- **Magic bytes**: The first few bytes of a file's binary content that identify its true format regardless of filename extension.
- **AccessLog**: The `access_logs` database table that records all share-link access events.
- **RevokedToken**: New database table storing `jti` values of invalidated JWTs.
- **slowapi**: Python rate-limiting library for FastAPI, backed by `limits` and compatible with `starlette`.

---

## Bug Details

### Bug Condition — All 10 Issues

Each issue has an independent bug condition. They are evaluated in isolation; fixing one does not resolve another.

---

#### Issue 1 — Hardcoded JWT Secret Key

```
FUNCTION isBugCondition_1(env)
  INPUT: env — the process environment variables at startup
  OUTPUT: boolean

  RETURN env["JWT_SECRET"] is not set OR env["JWT_SECRET"] is empty
END FUNCTION
```

**Examples:**
- `JWT_SECRET` absent → `security.py` falls back to `"vaultkey_super_secret_jwt_key_2026_change_in_prod"` → anyone with source code access can forge valid JWTs. *(bug)*
- `JWT_SECRET=correct-secret` set → HMAC signing uses the configured value. *(not a bug)*

---

#### Issue 2 — CORS Wildcard Enabled

```
FUNCTION isBugCondition_2(origins_list)
  INPUT: origins_list — the list passed to CORSMiddleware at startup
  OUTPUT: boolean

  RETURN "*" IN origins_list
END FUNCTION
```

**Examples:**
- `origins = ["http://localhost:5173", "*"]` → any origin passes CORS, enabling CSRF from arbitrary domains. *(bug)*
- `origins = ["http://localhost:5173"]` → only the listed origin is allowed. *(not a bug)*

---

#### Issue 3 — No Rate Limiting

```
FUNCTION isBugCondition_3(endpoint, request_count_in_window)
  INPUT: endpoint — one of /api/auth/login, /api/auth/register,
                    /api/access/{token}/authorize, /api/access/{token}/download
         request_count_in_window — requests from same client IP in the last 60 seconds
  OUTPUT: boolean

  RETURN no_rate_limit_middleware_installed()
         AND request_count_in_window > LIMIT_FOR(endpoint)
END FUNCTION
```

**Examples:**
- 100 login attempts in 30 seconds from one IP → all processed → credential stuffing enabled. *(bug)*
- 3 login attempts in 30 seconds → all processed normally → not a bug condition.
- 15 download attempts in 30 seconds from one IP after fix → 429 returned after the 5th. *(fixed)*

---

#### Issue 4 — JWT in localStorage

```
FUNCTION isBugCondition_4(storage_mechanism)
  INPUT: storage_mechanism — where the JWT is persisted after login
  OUTPUT: boolean

  RETURN storage_mechanism == "localStorage"
END FUNCTION
```

**Examples:**
- Login response stores `access_token` in `localStorage.setItem('vaultkey_token', ...)` → XSS can read it. *(bug)*
- Login response sets an `httpOnly` cookie → JavaScript cannot read the token. *(not a bug)*

---

#### Issue 5 — No PDF Magic Bytes Validation

```
FUNCTION isBugCondition_5(file)
  INPUT: file — File object passed to encryptFile()
  OUTPUT: boolean

  header = first 5 bytes of file content
  RETURN header != [0x25, 0x50, 0x44, 0x46, 0x2D]  // '%PDF-'
         AND file.name.endsWith(".pdf")              // filename extension passes existing check
END FUNCTION
```

**Examples:**
- `malicious.exe` renamed to `malicious.pdf` → passes filename check → encrypted and stored. *(bug)*
- `document.pdf` with correct `%PDF-` header → passes both checks. *(not a bug)*
- `image.jpg` renamed to `image.pdf` → magic bytes are `FFD8FF` → rejected before encryption. *(fixed)*

---

#### Issue 6 — 7-Day JWT with No Revocation

```
FUNCTION isBugCondition_6(token, event)
  INPUT: token — a JWT issued by the system
         event — "token_lifetime_check" or "logout_attempt"
  OUTPUT: boolean

  IF event == "token_lifetime_check"
    RETURN token.exp - token.iat > 3600 seconds  // more than 60 minutes
  IF event == "logout_attempt"
    RETURN no_revoked_tokens_table_exists()
           OR token.jti is absent
END FUNCTION
```

**Examples:**
- Token issued with 7-day expiry, user account compromised → attacker has 7 days of valid access. *(bug)*
- Logout called → no server-side invalidation → stolen token still works. *(bug)*
- Token issued with 60-minute expiry and `jti` → logout inserts `jti` into `revoked_tokens` → subsequent requests rejected. *(fixed)*

---

#### Issue 7 — Silent OSError on File Deletion

```
FUNCTION isBugCondition_7(delete_operation)
  INPUT: delete_operation — execution of os.remove() in files.py
  OUTPUT: boolean

  RETURN os.remove() raises OSError
         AND exception_handler is "except OSError: pass"
END FUNCTION
```

**Examples:**
- `os.remove()` fails because the `.enc` blob was manually deleted → `pass` swallows the error → orphaned DB record, no operator alert. *(bug)*
- `os.remove()` succeeds → no error path triggered. *(not a bug)*

---

#### Issue 8 — Inconsistent Audit Logging

```
FUNCTION isBugCondition_8(access_log_call_site)
  INPUT: access_log_call_site — any location where AccessLog is constructed inline
  OUTPUT: boolean

  RETURN AccessLog is constructed with inline db.add() at call site
         AND no shared helper function enforces field population
END FUNCTION
```

**Examples:**
- `METADATA_CHECK` log omits `ip_address` at one call site due to copy-paste deviation → inconsistent audit record. *(bug)*
- All events go through `_log_event(db, share, event, status, request)` → fields uniformly populated. *(fixed)*

---

#### Issue 9 — SQLite Not Suitable for Production

```
FUNCTION isBugCondition_9(deployment)
  INPUT: deployment — production deployment of VaultKey
  OUTPUT: boolean

  RETURN DATABASE_URL defaults to SQLite
         AND no .env.example documents PostgreSQL configuration
         AND no operator guidance exists in database.py
END FUNCTION
```

**Examples:**
- Operator clones repo and runs without setting `DATABASE_URL` → SQLite used in production → write contention under load. *(bug)*
- `.env.example` present with PostgreSQL example → operator configures correctly. *(fixed)*

---

#### Issue 10 — Missing `__init__.py`

```
FUNCTION isBugCondition_10(routes_package)
  INPUT: routes_package — backend/app/routes/ directory
  OUTPUT: boolean

  RETURN __init__.py does not exist in routes_package
END FUNCTION
```

**Examples:**
- Static analysis tool or older Python version fails to resolve `backend.app.routes` as a package. *(bug)*
- `__init__.py` present → explicit package → consistent resolution. *(fixed)*

---

## Expected Behavior

### Preservation Requirements

The following behaviors must continue to work exactly as before after all fixes are applied:

**Authentication flows:**
- Valid credentials continue to authenticate users and return a session (3.4, 3.5)
- `GET /api/auth/me` continues to return the authenticated user when a valid session cookie is present (3.8)

**Share link flows:**
- Valid, non-revoked share link tokens continue to serve access-check, authorization, and download responses correctly (3.6)
- All existing `AccessLog` event types continue to be recorded with no data loss (3.10)

**File handling:**
- Genuine PDF files (with correct `%PDF-` magic bytes) continue to encrypt successfully in the browser (3.7)
- Successful file deletions continue to remove the DB record and return a success response (3.9)

**Infrastructure:**
- Applications started with a correctly configured `JWT_SECRET` and `DATABASE_URL` continue to start and operate normally (3.1, 3.11)
- Origins listed in `ALLOWED_ORIGINS` continue to receive correct CORS headers (3.2)
- Requests within the rate limit window continue to be processed without interference (3.3)
- All existing route modules continue to import and register without errors (3.12)

**Note:** The specific expected correct behaviors for each bug (what the fixed code must do when `isBugCondition` is true) are defined in the Correctness Properties section below.

---

## Hypothesized Root Causes

**Issue 1:** `os.environ.get()` was given a hardcoded fallback string as its second argument. No startup validation enforces that the variable is actually set.

**Issue 2:** The `origins` list was hand-authored with `"*"` included, likely for development convenience and never cleaned up before production exposure.

**Issue 3:** No rate limiting library is installed or configured. FastAPI has no built-in request throttling, so every request reaches the route handler unconditionally.

**Issue 4:** Token management was implemented with the simplest approach (`localStorage`) without considering XSS attack vectors. The `OAuth2PasswordBearer` scheme only supports `Authorization` header tokens, not cookies.

**Issue 5:** `encryptFile()` accepts any `File` object and reads it entirely before checking only the `.pdf` extension on the filename passed separately. Binary content inspection was never added.

**Issue 6:** `ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7` was set for UX convenience (avoid frequent re-logins) without considering the security tradeoff. No `jti` claim was added and no revocation table was designed.

**Issue 7:** The `except OSError: pass` pattern is a common anti-pattern used to make deletion "best-effort". Logging was not considered when the error handling was written.

**Issue 8:** `AccessLog` construction was duplicated inline at each call site as the access routes were built incrementally, without extracting a shared helper. This led to subtle divergence across 10+ locations.

**Issue 9:** SQLite is the default ORM URL because it requires zero external dependencies, which is appropriate for development. No documentation or example config file was created to guide production operators.

**Issue 10:** Python 3.3+ namespace packages make `__init__.py` optional, so the omission was unnoticed during development. Static analysis tools and some deployment environments still require explicit packages.

---

## Correctness Properties

Property 1: Bug Condition — Startup Fails Without JWT Secret

_For any_ application startup where `JWT_SECRET` is not set in the environment, the fixed `security.py` SHALL raise a `RuntimeError` immediately, preventing the server from starting and making it impossible to issue or verify JWTs with an insecure fallback key.

**Validates: Requirements 2.1**

---

Property 2: Bug Condition — CORS Rejects Unconfigured Origins

_For any_ HTTP request originating from a domain not listed in the `ALLOWED_ORIGINS` environment variable, the fixed `main.py` CORS middleware SHALL reject the request with appropriate CORS error headers and SHALL NOT include a wildcard `"*"` in the allowed origins list.

**Validates: Requirements 2.2**

---

Property 3: Bug Condition — Rate Limits Enforced on Auth Endpoints

_For any_ sequence of more than 10 requests to `POST /api/auth/login` or `POST /api/auth/register` from the same client IP within one minute, the fixed application SHALL return HTTP 429 for all requests beyond the 10th, and the response body SHALL indicate the limit has been exceeded.

**Validates: Requirements 2.3, 2.4**

---

Property 4: Bug Condition — Rate Limits Enforced on Access Endpoints

_For any_ sequence of more than 5 requests to `POST /api/access/{token}/authorize` or `POST /api/access/{token}/download` from the same client IP within one minute, the fixed application SHALL return HTTP 429 for all requests beyond the 5th.

**Validates: Requirements 2.5, 2.6**

---

Property 5: Bug Condition — JWT Delivered as httpOnly Cookie

_For any_ successful login or registration response, the fixed backend SHALL set the JWT as an `httpOnly`, `Secure`, `SameSite=Strict` cookie and SHALL NOT include the token in the JSON response body. The fixed frontend SHALL NOT read from or write to `localStorage` for the `vaultkey_token` key.

**Validates: Requirements 2.7, 2.8**

---

Property 6: Bug Condition — Non-PDF Files Rejected Before Encryption

_For any_ call to `encryptFile(file)` where the first 5 bytes of `file`'s content are not `%PDF-` (hex `25 50 44 46 2D`), the fixed function SHALL throw an `Error` with message `"Invalid file: not a PDF document."` before any encryption key is generated or any ciphertext is produced.

**Validates: Requirements 2.9**

---

Property 7: Bug Condition — JWT Expiry Reduced and Revocation Enforced

_For any_ JWT issued after the fix, the token SHALL expire after 60 minutes and SHALL contain a unique `jti` claim. _For any_ call to `POST /api/auth/logout` with a valid session cookie, the fixed system SHALL insert the token's `jti` into the `revoked_tokens` table and clear the session cookie, causing all subsequent requests presenting that `jti` to be rejected with HTTP 401.

**Validates: Requirements 2.10, 2.11, 2.12**

---

Property 8: Bug Condition — OSError Logged on File Deletion Failure

_For any_ `os.remove()` call that raises an `OSError`, the fixed `files.py` SHALL log the error at `ERROR` level via Python's `logging` module, including the file path and exception details, and SHALL continue execution (not re-raise) so the database record deletion still proceeds.

**Validates: Requirements 2.13**

---

Property 9: Bug Condition — Audit Logging Uses Shared Helper

_For any_ access event that must be recorded, the fixed `access.py` SHALL invoke `_log_event(db, share, event, status, request)` rather than constructing `AccessLog` inline, ensuring `ip_address`, `user_agent`, and all other fields are populated consistently for every event type.

**Validates: Requirements 2.14**

---

Property 10: Preservation — Non-Buggy Inputs Unaffected

_For any_ input where none of the 10 bug conditions hold (valid JWT secret set, no wildcard CORS, within rate limits, valid session cookie, genuine PDF file, non-revoked token within 60 minutes, no OSError, no inline log construction, PostgreSQL configured, `__init__.py` present), the fixed system SHALL produce exactly the same behavior as the original system.

**Validates: Requirements 3.1 – 3.12**

---

## Fix Implementation

### Fix 1 — Hardcoded JWT Secret Key

**File:** `backend/app/security.py`

**Changes:**
1. Change `SECRET_KEY = os.environ.get("JWT_SECRET", "vaultkey_super_secret_jwt_key_2026_change_in_prod")` to `SECRET_KEY = os.environ.get("JWT_SECRET")`.
2. Immediately after, add:
   ```python
   if not SECRET_KEY:
       raise RuntimeError("JWT_SECRET environment variable must be set before starting the application.")
   ```

---

### Fix 2 — CORS Wildcard Enabled

**File:** `backend/app/main.py`

**Changes:**
1. Add `import os` at the top (if not already present).
2. Replace the hard-coded `origins` list with:
   ```python
   origins = os.environ.get(
       "ALLOWED_ORIGINS",
       "http://localhost:5173,http://127.0.0.1:5173"
   ).split(",")
   ```
   This removes `"*"` entirely. The default still permits local development without requiring a `.env` file, but never permits all origins.

---

### Fix 3 — Rate Limiting

**File:** `backend/requirements.txt`
1. Add `slowapi>=0.1.9` and `limits>=3.6.0`.

**File:** `backend/app/main.py`
1. Import `Limiter`, `get_remote_address`, `RateLimitExceeded`, `_rate_limit_exceeded_handler` from `slowapi`.
2. Instantiate `limiter = Limiter(key_func=get_remote_address)`.
3. Assign `app.state.limiter = limiter`.
4. Register exception handler: `app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)`.
5. Add `SlowAPIMiddleware` via `app.add_middleware(SlowAPIMiddleware)`.

**File:** `backend/app/routes/auth.py`
1. Import `limiter` from the app state or a shared module.
2. Decorate `register_user` with `@limiter.limit("10/minute")`.
3. Decorate `login_user` with `@limiter.limit("10/minute")`.
4. Add `request: Request` parameter to both handlers (required by slowapi).

**File:** `backend/app/routes/access.py`
1. Import `limiter`.
2. Decorate `authorize_password` with `@limiter.limit("5/minute")`.
3. Decorate `download_encrypted_file` with `@limiter.limit("5/minute")`.
4. Ensure `request: Request` is already present (it is).

---

### Fix 4 — JWT in localStorage → httpOnly Cookie

**File:** `backend/app/routes/auth.py`
1. Add `Response` import from `fastapi`.
2. Add a `response: Response` parameter to `register_user` and `login_user`.
3. After creating `access_token`, call:
   ```python
   response.set_cookie(
       key="vaultkey_session",
       value=access_token,
       httponly=True,
       secure=True,
       samesite="strict",
       max_age=3600
   )
   ```
4. Return a response without `access_token` in the body (return only `user`), or keep for backward compat during transition but remove in the same PR.
5. Add `GET /api/auth/logout` endpoint that clears the cookie:
   ```python
   @router.post("/logout")
   def logout(response: Response):
       response.delete_cookie("vaultkey_session")
       return {"status": "logged out"}
   ```

**File:** `backend/app/security.py`
1. Replace `OAuth2PasswordBearer` with a `Cookie`-based dependency:
   ```python
   from fastapi import Cookie
   
   def get_current_user(vaultkey_session: Optional[str] = Cookie(default=None), db: Session = Depends(get_db)):
       if not vaultkey_session:
           raise credentials_exception
       # existing JWT decode logic follows, using vaultkey_session as the token
   ```

**File:** `frontend/src/services/api.js`
1. Remove `const token = localStorage.getItem('vaultkey_token')` and the `Authorization` header injection.
2. Add `credentials: "include"` to all `fetch` calls so the browser sends the `httpOnly` cookie automatically.

**File:** `frontend/src/services/authService.js`
1. Remove `localStorage.setItem('vaultkey_token', data.access_token)` from `loginUser` and `registerUser`.
2. Remove `localStorage.removeItem('vaultkey_token')` from `logoutUser`. Instead, call `POST /api/auth/logout` to clear the server-side cookie.
3. Update `logoutUser` to be async and call the API logout endpoint.

**File:** `frontend/src/context/AuthContext.jsx`
1. Remove `const token = localStorage.getItem('vaultkey_token')` from the `useEffect` initialization check.
2. Replace the `token` guard with a direct `getCurrentUser()` call (the cookie is sent automatically if present). If it fails, the user is not authenticated.
3. Update `logout` to `await logoutUser()` (now async).

---

### Fix 5 — PDF Magic Bytes Validation

**File:** `frontend/src/crypto/encrypt.js`

**Changes:**
After `const fileBuffer = await file.arrayBuffer();`, add:
```javascript
const header = new Uint8Array(fileBuffer.slice(0, 5));
const magic = String.fromCharCode(...header);
if (!magic.startsWith('%PDF-')) {
  throw new Error('Invalid file: not a PDF document.');
}
```

---

### Fix 6 — JWT Revocation

**File:** `backend/app/security.py`
1. Change `ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7` to `ACCESS_TOKEN_EXPIRE_MINUTES = 60`.
2. Add `import uuid` at the top.
3. In `create_access_token()`, add `to_encode["jti"] = str(uuid.uuid4())` before encoding.
4. In `get_current_user()`, after decoding the payload:
   - Extract `jti = payload.get("jti")`.
   - If `jti` is `None`, raise `credentials_exception`.
   - Query `db.query(RevokedToken).filter(RevokedToken.jti == jti).first()`.
   - If a result is found, raise `credentials_exception` (HTTP 401).

**File:** `backend/app/models.py`
1. Add new model:
   ```python
   class RevokedToken(Base):
       __tablename__ = "revoked_tokens"

       id = Column(String(36), primary_key=True, default=generate_uuid)
       jti = Column(String(36), unique=True, nullable=False, index=True)
       revoked_at = Column(DateTime, default=datetime.utcnow)
   ```

**File:** `backend/app/routes/auth.py`
1. Update the `logout` endpoint (added in Fix 4) to also extract the `jti` from the session cookie, decode the JWT, and insert a `RevokedToken` record before clearing the cookie:
   ```python
   @router.post("/logout")
   def logout(response: Response, vaultkey_session: Optional[str] = Cookie(default=None), db: Session = Depends(get_db)):
       if vaultkey_session:
           try:
               payload = jwt.decode(vaultkey_session, SECRET_KEY, algorithms=[ALGORITHM])
               jti = payload.get("jti")
               if jti:
                   db.add(RevokedToken(jti=jti))
                   db.commit()
           except JWTError:
               pass  # Token already invalid; still clear the cookie
       response.delete_cookie("vaultkey_session")
       return {"status": "logged out"}
   ```

---

### Fix 7 — Silent OSError on File Deletion

**File:** `backend/app/routes/files.py`

**Changes:**
1. Add at the top: `import logging` and `logger = logging.getLogger(__name__)`.
2. Replace:
   ```python
   except OSError:
       pass
   ```
   with:
   ```python
   except OSError as e:
       logger.error(f"Failed to delete ciphertext blob {f.storage_path}: {e}")
   ```

---

### Fix 8 — Audit Logging Helper

**File:** `backend/app/routes/access.py`

**Changes:**
1. Add at the top of the file (after imports):
   ```python
   def _log_event(db: Session, share: ShareLink, event: str, status: str, request: Request) -> None:
       user_agent = request.headers.get("user-agent")
       client_ip = request.client.host if request.client else None
       db.add(AccessLog(
           share_id=share.id,
           file_id=share.file_id,
           owner_id=share.owner_id,
           event=event,
           status=status,
           user_agent=user_agent,
           ip_address=client_ip
       ))
       db.commit()
   ```
2. Replace every inline `db.add(AccessLog(...))` + `db.commit()` block with the corresponding `_log_event(db, share, event, status, request)` call.
3. Remove the now-redundant inline `user_agent` and `client_ip` local variable declarations from each route handler (they move into the helper).

---

### Fix 9 — SQLite Production Docs

**File:** `backend/.env.example` *(new file)*
```
# Required — set a long random string in production (e.g., openssl rand -hex 32)
JWT_SECRET=change-me-to-a-long-random-secret

# Comma-separated list of allowed frontend origins
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

# Database connection — PostgreSQL is required for production
# Example: postgresql://vaultkey_user:password@localhost:5432/vaultkey
DATABASE_URL=sqlite:///./vaultkey.db
```

**File:** `backend/app/database.py`
1. Add a comment above the `DATABASE_URL` line:
   ```python
   # Configure DATABASE_URL in your environment for production.
   # SQLite (default) is suitable for development only.
   # For production, use PostgreSQL:
   #   DATABASE_URL=postgresql://vaultkey_user:password@localhost:5432/vaultkey
   DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{DB_PATH}")
   ```

---

### Fix 10 — Missing `__init__.py`

**File:** `backend/app/routes/__init__.py` *(new file — empty)*

Create an empty file at this path. No content required; its presence marks the directory as an explicit Python package.

---

## Testing Strategy

### Validation Approach

Testing follows a two-phase approach: first, confirm the bug exists on unfixed code by writing tests that expose the defect (exploratory checking); then, verify the fix resolves the bug (fix checking) and that no existing correct behavior regressed (preservation checking).

---

### Exploratory Bug Condition Checking

**Goal:** Surface concrete counterexamples that demonstrate each bug on the current (unfixed) codebase.

**Test Cases (run on unfixed code):**

1. **JWT_SECRET absent** — Start the application without `JWT_SECRET` set. Observe: server starts successfully with the hardcoded fallback. *(confirms Issue 1)*
2. **CORS wildcard** — Send a credentialed request from `http://evil.example.com`. Observe: request is accepted due to `"*"`. *(confirms Issue 2)*
3. **No rate limiting on login** — Send 20 consecutive `POST /api/auth/login` requests. Observe: all return 401 (wrong credentials) rather than 429. *(confirms Issue 3)*
4. **localStorage token** — Inspect `localStorage` after login. Observe: `vaultkey_token` key is present with the JWT value. *(confirms Issue 4)*
5. **Non-PDF upload** — Call `encryptFile()` with a `.jpg` file renamed to `.pdf`. Observe: encryption proceeds, no error thrown. *(confirms Issue 5)*
6. **7-day token** — Decode an issued JWT. Observe: `exp - iat` equals 604800 seconds (7 days) and no `jti` claim is present. *(confirms Issue 6)*
7. **Silent OSError** — Mock `os.remove` to raise `OSError`. Call `DELETE /api/files/{id}`. Observe: 200 returned, no log output. *(confirms Issue 7)*
8. **Inline audit logging** — Review `access.py` source. Count `db.add(AccessLog(...)` occurrences. Observe: 10+ inline duplications with field inconsistencies. *(confirms Issue 8)*
9. **No .env.example** — Check repository root and `backend/`. Observe: `.env.example` does not exist. *(confirms Issue 9)*
10. **Missing `__init__.py`** — Check `backend/app/routes/`. Observe: no `__init__.py` file exists. *(confirms Issue 10)*

**Expected Counterexamples:**
- Application starts with hardcoded secret; JWT can be forged with known key.
- No HTTP 429 responses from auth or access endpoints regardless of request volume.
- `localStorage.getItem('vaultkey_token')` returns a JWT string in any browser session after login.

---

### Fix Checking

**Goal:** Verify that for all inputs where a bug condition holds, the fixed system produces the expected behavior.

**Pseudocode:**
```
FOR EACH issue i IN [1..10] DO
  FOR ALL input WHERE isBugCondition_i(input) DO
    result := fixedSystem(input)
    ASSERT expectedBehavior_i(result)
  END FOR
END FOR
```

**Specific fix checks:**

| Issue | Input | Expected Result |
|-------|-------|-----------------|
| 1 | Startup without `JWT_SECRET` | `RuntimeError` raised, server does not start |
| 2 | Request from unconfigured origin | CORS headers absent, request rejected |
| 3 | 11th login request in 1 min from same IP | HTTP 429 |
| 4 | Inspect response cookies after login | `vaultkey_session` cookie present with `httpOnly` flag; `localStorage` empty |
| 5 | `encryptFile(nonPdfFile)` | `Error("Invalid file: not a PDF document.")` thrown before any crypto operations |
| 6 | Decode freshly issued JWT | `exp - iat == 3600`, `jti` present; `POST /logout` → 401 on subsequent authenticated request |
| 7 | `DELETE /api/files/{id}` with mocked `OSError` | Logger receives `ERROR` call with path and exception; 200 still returned |
| 8 | Trigger any access event | `AccessLog` record has `ip_address` and `user_agent` populated; no inline `db.add(AccessLog(...))` calls remain in source |
| 9 | Check `backend/` directory | `.env.example` exists with `DATABASE_URL`, `JWT_SECRET`, `ALLOWED_ORIGINS` entries |
| 10 | Check `backend/app/routes/` | `__init__.py` file exists |

---

### Preservation Checking

**Goal:** Verify that for all inputs where no bug condition holds, the fixed system behaves identically to the original.

**Pseudocode:**
```
FOR ALL input WHERE NOT ANY isBugCondition_i(input) DO
  ASSERT fixedSystem(input) == originalSystem(input)
END FOR
```

**Test Cases:**

1. **Valid credentials authenticate successfully** — `POST /api/auth/login` with correct email/password → HTTP 200, `user` object returned, session cookie set. *(validates 3.4)*
2. **Registration creates account** — `POST /api/auth/register` with new email → HTTP 200, user created. *(validates 3.5)*
3. **Authenticated API calls work** — `GET /api/auth/me` with valid session cookie → returns user object. *(validates 3.8)*
4. **Valid share link download** — Full flow: check → authorize → download with valid token → encrypted blob returned with correct headers. *(validates 3.6)*
5. **Genuine PDF encrypts** — `encryptFile(realPdfFile)` → returns `{ encryptedBlob, ivHex, keyHex }` without error. *(validates 3.7)*
6. **File deletion success** — `DELETE /api/files/{id}` where file exists → 200, no logger error call. *(validates 3.9)*
7. **All audit event types recorded** — Trigger `ACCESS_DENIED`, `LINK_EXPIRED`, `METADATA_CHECK`, `ACCESS_ATTEMPT`, `PASSWORD_FAILED`, `ACCESS_GRANTED`, `FILE_DOWNLOADED` → all appear in `access_logs` with complete fields. *(validates 3.10)*
8. **Allowed origin passes CORS** — Request from `http://localhost:5173` → appropriate CORS headers present. *(validates 3.2)*
9. **Requests within rate limit window pass** — 5 requests from same IP → all processed normally. *(validates 3.3)*
10. **Route imports succeed** — All 5 routers (`auth`, `files`, `shares`, `access`, `activity`) import without error after `__init__.py` is added. *(validates 3.12)*

**Testing Approach:** Property-based testing is recommended for rate limit preservation (generate random request counts between 1 and the limit, assert all are processed) and for CORS origin checking (generate random valid origins from the configured list, assert all pass). Unit tests cover the other preservation cases.

---

### Unit Tests

- Test `security.py` startup raises `RuntimeError` when `JWT_SECRET` is unset.
- Test `security.py` starts normally when `JWT_SECRET` is set.
- Test `get_current_user()` rejects tokens with revoked `jti`.
- Test `get_current_user()` accepts valid tokens with non-revoked `jti`.
- Test `encryptFile()` rejects non-PDF content (magic bytes check).
- Test `encryptFile()` accepts genuine PDF content.
- Test `delete_file` logs error when `os.remove` raises `OSError`.
- Test `delete_file` does not log when `os.remove` succeeds.
- Test `_log_event` populates all fields including `ip_address` and `user_agent`.
- Test `isBugCondition_5` against various file headers (PNG, JPEG, ZIP, EXE, PDF).

---

### Property-Based Tests

- **Rate limit boundary** — Generate request counts in `[1, limit]` from a single IP; assert all return non-429. Generate counts in `[limit+1, limit*3]`; assert all return 429.
- **CORS origin set** — Generate origins from the configured allow-list; assert all receive `Access-Control-Allow-Origin` headers. Generate random non-allowed origins; assert none receive the header.
- **JWT jti uniqueness** — Generate N tokens; assert all `jti` values are distinct (no UUID collision in reasonable sample).
- **PDF magic bytes** — Generate random 5-byte headers that are not `%PDF-`; assert `encryptFile` always throws. Generate headers starting with `%PDF-`; assert `encryptFile` always proceeds.
- **Audit log field completeness** — Generate access events across all event types; assert every resulting `AccessLog` record has non-null `ip_address`, `user_agent`, `event`, `status`, `share_id`, `file_id`, `owner_id`.

---

### Integration Tests

- Full login → authenticated request → logout → rejected re-use of same `jti` flow.
- Full file upload (genuine PDF) → create share → recipient download flow end-to-end.
- Rate limit integration: 11 rapid login attempts → first 10 succeed with 401 (wrong creds), 11th returns 429.
- CORS integration: preflight from allowed origin passes; preflight from disallowed origin fails.
- Cookie lifecycle: login sets cookie, `/api/auth/me` with cookie returns user, logout clears cookie, `/api/auth/me` without cookie returns 401.
