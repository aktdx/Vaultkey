# Implementation Plan

- [x] 1. Write bug condition exploration tests (BEFORE any fixes)
  - **Property 1: Bug Condition** - All 5 Security Issues Exposed on Unfixed Code
  - **CRITICAL**: These tests MUST FAIL (or confirm defects) on unfixed code — failure confirms each bug exists
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **GOAL**: Surface concrete counterexamples that demonstrate every bug exists
  - **Scoped PBT Approach**: Scope each property to the concrete failing case(s) to ensure reproducibility

  Explore Issue 2 — CORS Wildcard:
  - Inspect the `origins` list in `main.py` and assert `"*"` is present
  - Send a credentialed request from `http://evil.example.com` and verify it receives `Access-Control-Allow-Origin` headers
  - Document counterexample: requests from arbitrary origins succeed because `"*"` is in the list
  - _isBugCondition_2: "*" IN origins_list_

  Explore Issue 3 — No Rate Limiting on Public Access Endpoints:
  - Send 20 consecutive `POST /api/access/{token}/authorize` requests from the same IP
  - Verify all 20 return 401 (wrong password) rather than 429 after the 5th
  - Send 20 consecutive `POST /api/access/{token}/download` requests from the same IP
  - Verify all 20 are processed without a 429
  - Document counterexample: unlimited requests reach the route handler with no throttling
  - _isBugCondition_3: no_rate_limit_on_endpoint AND request_count_in_window > 5_

  Explore Issue 5 — No File-Content Validation Before Encryption:
  - Create a JPEG file (bytes start with `FFD8FF`) and rename it to `.pdf`
  - Call `encryptFile(renamedJpeg)` and verify it returns `{ encryptedBlob, ivHex, keyHex }` without error
  - Create a `.txt` file containing a null byte (`0x00`) and call `encryptFile(nullByteTxt)`; verify it proceeds without error
  - Document counterexamples: non-PDF content and malformed text are encrypted without any rejection
  - _isBugCondition_5: (isBinaryExtension(ext) AND NOT matchesMagicBytes(bytes, ext)) OR (isTextExtension(ext) AND containsNullBytes(bytes))_

  Explore Issue 8 — Missing Audit Log Entries on Revoked/Expired Downloads:
  - Create a revoked share link; call `POST /api/access/{token}/download`
  - Query the `access_logs` table; verify no `ACCESS_DENIED` record was written for this request
  - Create an expired share link; call `POST /api/access/{token}/download`
  - Query the `access_logs` table; verify no `LINK_EXPIRED` record was written for this request
  - Document counterexamples: revoked and expired download attempts leave no audit trail
  - _isBugCondition_8: share.revoked=true OR share.expired=true AND no AccessLog written for download_

  Explore Issue 11 — schema.sql Out of Sync:
  - Apply `database/schema.sql` to a fresh database
  - Verify the `users` table `email` column has `NOT NULL` (matches models.py — this is OK)
  - Verify the `access_logs` table does NOT have a `FILE_VIEWED` entry in any constraint (schema.sql comment says `FILE_VIEWED` but the model includes it — check for drift)
  - Compare each table column set in `schema.sql` against the SQLAlchemy models in `models.py`
  - Document any column or constraint that differs between schema.sql and the live model definitions
  - _isBugCondition_11: schemaSQL.column_definitions != models.column_definitions for any table_

  - Run all exploration checks on UNFIXED code
  - **EXPECTED OUTCOME**: All 5 defects confirmed; document each counterexample found
  - Mark task complete when all checks are written, run, and failures/defects are documented
  - _Requirements: 1.1, 1.2 (Issue 2); 1.1, 1.2 (Issue 3); 1.1, 1.2, 1.3 (Issue 5); 1.1, 1.2, 1.3 (Issue 8); 1.1, 1.2 (Issue 11)_

- [x] 2. Write preservation property tests (BEFORE implementing any fix)
  - **Property 2: Preservation** - All Existing Correct Behaviors Captured on Unfixed Code
  - **IMPORTANT**: Follow observation-first methodology — run UNFIXED code, observe outputs, then codify them
  - **GOAL**: Establish a regression baseline that all fixes must satisfy

  Observe and encode preservation for CORS allowed origins (Issue 2 — 3.1, 3.2):
  - With `origins` list containing `"http://localhost:5173"`, send a request from that origin
  - Observe: response contains `Access-Control-Allow-Origin: http://localhost:5173` header
  - Observe: `X-IV-Hex` and `X-Original-Filename` are in `Access-Control-Expose-Headers`
  - Write property: for all origins in the configured allow-list, CORS headers are present and expose-headers are intact
  - Verify these properties PASS on unfixed code

  Observe and encode preservation for within-limit requests (Issue 3 — 3.1, 3.2):
  - Send 5 requests to `POST /api/access/{token}/authorize` from the same IP with a wrong password
  - Observe: all 5 return 401 (not 429) — within-limit behaviour preserved
  - Send 5 requests to `POST /api/access/{token}/download` from the same IP
  - Observe: all 5 are processed normally (no 429)
  - Observe: `GET /api/access/{token}` is NOT affected by POST-route rate limits
  - Write property: for all request counts ≤ 5 within 60s, the response is never HTTP 429

  Observe and encode preservation for valid file encryption (Issue 5 — 3.1, 3.2, 3.3):
  - Call `encryptFile(validPdf)` where the file starts with `%PDF` bytes
  - Observe: returns `{ encryptedBlob, ivHex, keyHex }` without error
  - Call `encryptFile(validPng)` where the file starts with `\x89PNG` bytes
  - Observe: returns result without error
  - Call `encryptFile(validTxt)` where the file contains no null bytes
  - Observe: returns result without error
  - Write property-based test: for all files whose bytes match their declared extension, `encryptFile` always succeeds

  Observe and encode preservation for existing audit log entries (Issue 8 — 3.1, 3.2):
  - Trigger `METADATA_CHECK` (via `GET /api/access/{token}`), `ACCESS_ATTEMPT` (via `POST /api/access/{token}/attempt`), `ACCESS_GRANTED`, `PASSWORD_FAILED`, `FILE_DOWNLOADED`, `FILE_VIEWED`, `ACCESS_DENIED` (via download limit reached) events
  - Query `access_logs` after each; verify every record has non-null `share_id`, `file_id`, `owner_id`, `event`, `status`, `user_agent`, `ip_address`
  - Write property: for all event types already logged, AccessLog records are complete with all required fields

  Observe and encode preservation for schema.sql sync (Issue 11 — 3.1, 3.2):
  - Start the application with `Base.metadata.create_all(bind=engine)` and verify no errors
  - Verify `create_all` is a no-op on a database where tables already exist (no DROP, no ALTER)
  - Document which tables and columns the live models define (baseline for schema.sql comparison)

  - Run all preservation tests on UNFIXED code
  - **EXPECTED OUTCOME**: All preservation tests PASS (establishes baseline to protect)
  - Mark task complete when all tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2 (Issue 2); 3.1, 3.2 (Issue 3); 3.1, 3.2, 3.3 (Issue 5); 3.1, 3.2 (Issue 8); 3.1, 3.2 (Issue 11)_

- [x] 3. Fix Issue 2 — CORS Wildcard Enabled [CRITICAL]

  - [x] 3.1 Remove wildcard and use environment-driven origins in `main.py`
    - Replace the hard-coded `origins = [...]` list with:
      ```python
      origins = os.environ.get(
          "ALLOWED_ORIGINS",
          "http://localhost:5173,http://127.0.0.1:5173",
      ).split(",")
      ```
    - Confirm `import os` is already present at the top of `main.py`
    - Remove any `"*"` entry — no wildcard must remain anywhere in the origins list
    - _Bug_Condition: isBugCondition_2(origins) — "*" IN origins_
    - _Expected_Behavior: CORS rejects any origin not in ALLOWED_ORIGINS; no wildcard present_
    - _Preservation: Origins listed in ALLOWED_ORIGINS receive correct CORS and expose-headers responses_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.2 Document ALLOWED_ORIGINS in `backend/.env.example`
    - Verify `ALLOWED_ORIGINS` is already documented with the comma-separated format example
    - Ensure the example value lists `http://localhost:5173,http://127.0.0.1:5173` (no wildcard)
    - _Requirements: 2.2, 2.3_

  - [x] 3.3 Verify bug condition exploration test now passes for Issue 2
    - **Property 1: Expected Behavior** - CORS Rejects Unconfigured Origins
    - **IMPORTANT**: Re-run the SAME test from task 1 (Issue 2 exploration) — do NOT write a new test
    - Confirm `"*"` is no longer in the origins list in `main.py`
    - Send request from `http://evil.example.com`; verify `Access-Control-Allow-Origin` header is absent
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2_

  - [x] 3.4 Verify preservation tests still pass after Issue 2 fix
    - **Property 2: Preservation** - Allowed Origins and Expose-Headers Still Work
    - **IMPORTANT**: Re-run the SAME tests from task 2 (Issue 2 preservation) — do NOT write new tests
    - Confirm `http://localhost:5173` receives `Access-Control-Allow-Origin` header
    - Confirm `X-IV-Hex` and `X-Original-Filename` remain in `Access-Control-Expose-Headers`
    - **EXPECTED OUTCOME**: Tests PASS (no regressions)

- [x] 4. Fix Issue 3 — No Rate Limiting on Public Access Endpoints [HIGH]

  - [x] 4.1 Verify `slowapi` and `limits` are present in `requirements.txt`
    - Confirm `slowapi>=0.1.9` and `limits>=3.6.0` are listed in `backend/requirements.txt`
    - These entries should already be present from a prior change; add them if missing
    - _Requirements: 2.1, 2.2_

  - [x] 4.2 Verify rate-limiter middleware is wired in `main.py`
    - Confirm `app.state.limiter = limiter` is set after app creation
    - Confirm `app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)` is registered
    - Confirm `app.add_middleware(SlowAPIMiddleware)` is present
    - Confirm `limiter` is imported from `app.limiter` (the shared module)
    - _Bug_Condition: isBugCondition_3 — no rate-limit middleware installed AND request_count > limit_
    - _Expected_Behavior: HTTP 429 returned when limit is exceeded; structured JSON error body_
    - _Preservation: Requests ≤ 5 per minute continue to be processed normally_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 4.3 Apply `@limiter.limit("5/minute")` decorators to access endpoints in `routes/access.py`
    - Confirm `authorize_password` is decorated with `@limiter.limit("5/minute")`
    - Confirm `download_encrypted_file` is decorated with `@limiter.limit("5/minute")`
    - Confirm `request: Request` is the first non-path parameter in both handlers (required by slowapi)
    - Confirm `limiter` is imported from `..limiter`
    - _Requirements: 2.1, 2.2_

  - [x] 4.4 Verify bug condition exploration test now passes for Issue 3
    - **Property 1: Expected Behavior** - Rate Limits Enforced on Access Endpoints
    - **IMPORTANT**: Re-run the SAME test from task 1 (Issue 3 exploration) — do NOT write a new test
    - Send 6 `POST /api/access/{token}/authorize` requests from the same IP; verify the 6th returns HTTP 429
    - Send 6 `POST /api/access/{token}/download` requests from the same IP; verify the 6th returns HTTP 429
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2_

  - [x] 4.5 Verify preservation tests still pass after Issue 3 fix
    - **Property 2: Preservation** - Within-Limit Requests and GET Endpoint Unaffected
    - **IMPORTANT**: Re-run the SAME tests from task 2 (Issue 3 preservation) — do NOT write new tests
    - Send 5 authorize requests; confirm all return 401 (not 429)
    - Send 5 download requests; confirm all are processed normally
    - Call `GET /api/access/{token}`; confirm it responds without 429 interference
    - **EXPECTED OUTCOME**: Tests PASS (no regressions)

- [x] 5. Fix Issue 5 — No File-Content Validation Before Encryption [MEDIUM]

  - [x] 5.1 Add magic bytes and null-byte validation in `frontend/src/crypto/encrypt.js`
    - Confirm the `MAGIC_BYTES` lookup table covers `pdf`, `png`, `jpg`, `jpeg`, `gif`, `webp`
    - Confirm the `TEXT_EXTENSIONS` set covers `txt`, `md`, `json`, `js`, `py`, `html`, `css`, `csv`, `log`
    - Confirm the `validateFileContent(file, buffer)` function:
      - For binary extensions: slices `buffer` at the magic-byte offset and compares the hex prefix; throws a descriptive `Error` on mismatch
      - For text extensions: scans for null bytes (`0x00`) and throws a descriptive `Error` if found
      - Is called with `(file, fileBuffer)` after `file.arrayBuffer()` resolves and BEFORE `generateKey` is called
    - _Bug_Condition: isBugCondition_5(file) — isBinaryExt AND NOT matchesMagicBytes OR isTextExt AND containsNullBytes_
    - _Expected_Behavior: Error thrown with descriptive message before any crypto operations for invalid files_
    - _Preservation: Valid files whose bytes match their declared extension continue to encrypt successfully_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 5.2 Verify bug condition exploration test now passes for Issue 5
    - **Property 1: Expected Behavior** - Invalid Files Rejected Before Encryption
    - **IMPORTANT**: Re-run the SAME test from task 1 (Issue 5 exploration) — do NOT write a new test
    - Call `encryptFile(renamedJpegAsPdf)`; verify an `Error` is thrown with message containing `"does not match the .pdf format"` and no `CryptoKey` is generated
    - Call `encryptFile(nullByteTxt)`; verify an `Error` is thrown with message containing `"must not contain binary (null) bytes"` and no `CryptoKey` is generated
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2_

  - [x] 5.3 Verify preservation tests still pass after Issue 5 fix
    - **Property 2: Preservation** - Valid Files Still Encrypt Successfully
    - **IMPORTANT**: Re-run the SAME tests from task 2 (Issue 5 preservation) — do NOT write new tests
    - Confirm `encryptFile(validPdf)` returns `{ encryptedBlob, ivHex, keyHex }` without error
    - Confirm `encryptFile(validPng)` returns successfully
    - Confirm `encryptFile(validTxt)` returns successfully
    - Write property-based test: for all files where `isBugCondition_5` is false, `encryptFile` always succeeds
    - **EXPECTED OUTCOME**: Tests PASS (no regressions)

- [x] 6. Fix Issue 8 — Missing Audit Log Entries on Revoked/Expired Downloads [MEDIUM]

  - [x] 6.1 Add `_log_event` helper to `routes/access.py` and replace all inline AccessLog constructions
    - Confirm the `_log_event(db, share, event, log_status, request)` helper function is defined near the top of `access.py` (after imports), with this signature:
      ```python
      def _log_event(db, share, event, log_status, request):
          user_agent = request.headers.get("user-agent")
          client_ip = request.client.host if request.client else None
          db.add(AccessLog(
              share_id=share.id,
              file_id=share.file_id,
              owner_id=share.owner_id,
              event=event,
              status=log_status,
              user_agent=user_agent,
              ip_address=client_ip,
          ))
          db.commit()
      ```
    - Replace every inline `db.add(AccessLog(...))` + `db.commit()` block across all three route handlers with the equivalent `_log_event(db, share, event, status, request)` call
    - _Requirements: 2.3_

  - [x] 6.2 Add missing log entries for revoked and expired share links in `download_encrypted_file`
    - In `download_encrypted_file`, before raising the `HTTPException` for a revoked share, call:
      `_log_event(db, share, "ACCESS_DENIED", "DENIED", request)`
    - Before raising the `HTTPException` for an expired share, call:
      `_log_event(db, share, "LINK_EXPIRED", "DENIED", request)`
    - _Bug_Condition: isBugCondition_8(request) — share.revoked=true OR share.expired=true AND no AccessLog written_
    - _Expected_Behavior: ACCESS_DENIED written before revoked 403; LINK_EXPIRED written before expired 410_
    - _Preservation: All previously logged event types (METADATA_CHECK, ACCESS_ATTEMPT, ACCESS_GRANTED, PASSWORD_FAILED, FILE_DOWNLOADED, FILE_VIEWED, ACCESS_DENIED for download-limit) still recorded with complete fields_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 6.3 Verify bug condition exploration test now passes for Issue 8
    - **Property 1: Expected Behavior** - Revoked/Expired Downloads Produce Audit Log Entries
    - **IMPORTANT**: Re-run the SAME test from task 1 (Issue 8 exploration) — do NOT write a new test
    - Call `POST /api/access/{revokedToken}/download`; verify an `ACCESS_DENIED` AccessLog record exists with `share_id`, `file_id`, `owner_id`, `user_agent`, `ip_address` all populated
    - Call `POST /api/access/{expiredToken}/download`; verify a `LINK_EXPIRED` AccessLog record exists with all fields populated
    - Verify no inline `db.add(AccessLog(` calls remain anywhere in `access.py` (all via `_log_event`)
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2_

  - [x] 6.4 Verify preservation tests still pass after Issue 8 fix
    - **Property 2: Preservation** - All Existing Audit Events Still Recorded With Complete Fields
    - **IMPORTANT**: Re-run the SAME tests from task 2 (Issue 8 preservation) — do NOT write new tests
    - Trigger `METADATA_CHECK`, `ACCESS_ATTEMPT`, `ACCESS_GRANTED`, `PASSWORD_FAILED`, `FILE_DOWNLOADED`, `FILE_VIEWED`, `ACCESS_DENIED` (download-limit) events
    - Verify every resulting AccessLog record has non-null `share_id`, `file_id`, `owner_id`, `event`, `status`, `user_agent`, `ip_address`
    - Write property: for all event types, AccessLog records are complete with no fields regressed to null
    - **EXPECTED OUTCOME**: Tests PASS (no regressions)

- [x] 7. Fix Issue 11 — `database/schema.sql` Out of Sync with `models.py` [LOW]

  - [x] 7.1 Reconcile `database/schema.sql` with the live SQLAlchemy models
    - Compare every table and column in `database/schema.sql` against `backend/app/models.py`
    - Update `schema.sql` so it accurately reflects the current models:
      - `users`: `id VARCHAR(36)`, `email VARCHAR(255) NOT NULL UNIQUE`, `hashed_password VARCHAR(255) NOT NULL`, `created_at TIMESTAMP`
      - `files`: `id`, `owner_id` (FK CASCADE), `r2_object_key VARCHAR(512) NOT NULL`, `original_filename VARCHAR(255) NOT NULL`, `mime_type VARCHAR(100) DEFAULT 'application/pdf'`, `size INTEGER NOT NULL`, `iv_hex VARCHAR(64) NOT NULL`, `created_at TIMESTAMP`
      - `shares`: `id`, `file_id` (FK CASCADE), `owner_id` (FK CASCADE), `token_hash VARCHAR(64) NOT NULL UNIQUE`, `expires_at TIMESTAMP NULL`, `max_downloads INTEGER DEFAULT 5`, `download_count INTEGER DEFAULT 0`, `password_hash VARCHAR(255) NULL`, `revoked BOOLEAN DEFAULT FALSE`, `revoked_at TIMESTAMP NULL`, `created_at TIMESTAMP`
      - `access_logs`: `id`, `share_id` (FK CASCADE NULL), `file_id` (FK CASCADE NULL), `owner_id` (FK CASCADE NOT NULL)`, `event VARCHAR(50) NOT NULL`, `status VARCHAR(20) NOT NULL`, `user_agent VARCHAR(512) NULL`, `ip_address VARCHAR(100) NULL`, `timestamp TIMESTAMP`
    - Update the `-- Last synced` comment at the top to reflect the current date
    - _Bug_Condition: isBugCondition_11(schema) — schemaSQL column definitions do not match models.py_
    - _Expected_Behavior: schema.sql accurately mirrors models.py column names, types, nullability, and defaults_
    - _Preservation: Application continues to call Base.metadata.create_all(bind=engine) at startup; schema.sql is reference-only and does not affect runtime behaviour_
    - _Requirements: 2.1, 2.2_

  - [x] 7.2 Verify bug condition exploration test now passes for Issue 11
    - **Property 1: Expected Behavior** - schema.sql Matches models.py
    - **IMPORTANT**: Re-run the SAME test from task 1 (Issue 11 exploration) — do NOT write a new test
    - Compare every column in the updated `schema.sql` against `models.py`; confirm no drift remains
    - **EXPECTED OUTCOME**: Test PASSES (schema.sql and models are in sync)
    - _Requirements: 2.1_

  - [x] 7.3 Verify preservation tests still pass after Issue 11 fix
    - **Property 2: Preservation** - Application Startup and create_all Unaffected
    - **IMPORTANT**: Re-run the SAME tests from task 2 (Issue 11 preservation) — do NOT write new tests
    - Confirm `Base.metadata.create_all(bind=engine)` still runs without error on application start
    - Confirm `create_all` remains a no-op on a database where tables already exist
    - **EXPECTED OUTCOME**: Tests PASS (no regressions)

- [x] 8. Checkpoint — Ensure all tests pass
  - Re-run the complete test suite covering all 5 fixes
  - Verify all 5 bug condition exploration tests now PASS (confirming bugs are resolved)
  - Verify all preservation tests still PASS (confirming no regressions)
  - Confirm no inline `db.add(AccessLog(...))` calls remain in `access.py`
  - Confirm `"*"` does not appear in the CORS origins list in `main.py`
  - Confirm `@limiter.limit("5/minute")` decorators are on both access POST endpoints
  - Confirm `validateFileContent` is called before `generateKey` in `encrypt.js`
  - Confirm `schema.sql` last-synced date is updated and all columns match `models.py`
  - Ask the user if any questions arise during validation
