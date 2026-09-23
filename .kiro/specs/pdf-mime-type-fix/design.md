# PDF MIME Type Fix — Bugfix Design

## Overview

PDF files (and any other files whose MIME type resolves to `application/octet-stream`) fail to
render inline in the VaultKey view-only viewer. The viewer displays the fallback message
"Inline preview not available for this file type (application/octet-stream)" instead of the
PDF canvas or correct media renderer.

The bug lives in **two places that share the same root assumption**: both the backend helper
`_resolve_mime()` and the frontend helper `resolveMimeType()` treat `application/octet-stream`
as a _resolved_ MIME type rather than as the generic-binary sentinel it actually is. The backend
therefore sends `X-Mime-Type: application/octet-stream` for files whose database column stores
that value, and the frontend accepts it uncritically, constructs the decrypted `Blob` with the
wrong type, and hands it to `ViewOnlyViewer` where `isPdfMime()` returns `false`.

The fix is a minimal two-point change: make both helpers treat `application/octet-stream` as
unresolved and perform the extension-based lookup before accepting that value as final.

---

## Glossary

- **Bug_Condition (C)**: The set of inputs for which the system produces `application/octet-stream`
  as the final MIME type for a file that has a known, resolvable extension (e.g. `.pdf`).
- **Property (P)**: The expected output behaviour for inputs in C — the resolved MIME type
  SHALL match the extension-derived value (e.g. `application/pdf` for `.pdf`).
- **Preservation**: All behaviour for files outside C (files with specific, non-generic MIME
  types already stored, files with unknown extensions, non-MIME-related access flows) MUST
  remain identical before and after the fix.
- **`_resolve_mime(file_item)`**: Python helper in `backend/app/routes/access.py` that returns
  the MIME type included in the `X-Mime-Type` response header.
- **`resolveMimeType(serverMimeType, filename)`**: TypeScript helper in
  `frontend/src/lib/crypto.ts` that selects the MIME type used when constructing the decrypted
  `Blob`.
- **`X-Mime-Type` header**: Custom response header set by the `/download` and `/view` endpoints;
  the only channel through which the backend communicates the file's MIME type to the browser.
- **`isPdfMime(mime)`**: Predicate in `ViewOnlyViewer.tsx`; returns `true` only for
  `application/pdf`. Determines whether the `PdfViewer` sub-component is rendered.
- **`application/octet-stream`**: The IANA generic binary type; used as a last-resort default
  when no specific type can be determined. Treated as _unresolved_ in this fix.

---

## Bug Details

### Bug Condition

The bug manifests whenever the final MIME type passed to `new Blob([plaintext], { type })` is
`application/octet-stream` for a file whose `original_filename` has an extension that maps to a
specific MIME type (e.g. `.pdf` → `application/pdf`). This happens because:

1. **Backend path**: `_resolve_mime()` returns `file_item.mime_type` directly if that column is
   truthy. When `mime_type` was stored as `"application/octet-stream"` (possible for files
   uploaded via older code paths before the `EXTENSION_TO_MIME` table was in place), the function
   returns that value without checking the extension.
2. **Frontend path**: `resolveMimeType()` returns `serverMimeType.trim()` for any non-empty
   server value, so `"application/octet-stream"` from the header bypasses the extension fallback
   entirely.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input — { serverMimeType: string | null, filename: string }
  OUTPUT: boolean

  -- The bug fires when the current logic would produce octet-stream ...
  currentResult := currentResolveMimeType(input.serverMimeType, input.filename)

  -- ... but the correct logic (extension lookup) would produce a specific type.
  correctResult := extensionLookup(input.filename)

  RETURN currentResult = "application/octet-stream"
         AND correctResult IS NOT NULL
         AND correctResult != "application/octet-stream"
END FUNCTION

FUNCTION currentResolveMimeType(serverMimeType, filename)
  -- Current (broken) implementation
  IF serverMimeType IS NOT NULL AND serverMimeType.trim() != ""
    RETURN serverMimeType.trim()   -- returns "application/octet-stream" without extension check
  ext := extractExtension(filename)
  IF ext IN EXTENSION_TO_MIME
    RETURN EXTENSION_TO_MIME[ext]
  RETURN "application/octet-stream"
END FUNCTION
```

### Examples

- **PDF with octet-stream in DB**: `mime_type = "application/octet-stream"`, filename
  `"report.pdf"` → current: `application/octet-stream`; expected: `application/pdf`.
- **PNG with octet-stream in DB**: `mime_type = "application/octet-stream"`, filename
  `"photo.png"` → current: `application/octet-stream`; expected: `image/png`.
- **PDF with null DB column**: `mime_type = null`, filename `"report.pdf"` → current (and
  correct, since the falsy check already falls through): `application/pdf`. _(not in C)_
- **File with unknown extension**: `mime_type = "application/octet-stream"`, filename
  `"archive.xyz"` → correct final value is still `application/octet-stream` (no extension
  match). _(not in C — no regression risk)_
- **PDF correctly stored**: `mime_type = "application/pdf"`, filename `"report.pdf"` → current
  and expected: `application/pdf`. _(not in C)_

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- Files with a correctly stored, specific `mime_type` (e.g. `image/png`, `text/plain`,
  `application/pdf`) SHALL continue to use that stored value; the extension lookup is never
  invoked for them.
- The `X-Mime-Type` header for a file whose stored MIME type is specific and non-generic MUST
  remain unchanged.
- All non-MIME-related access controls (VIEW_ONLY enforcement, download counter, expiry,
  password checks, audit logging) MUST be completely unaffected.
- The `resolveMimeType()` function's three-step fallback order (server → extension → default)
  MUST remain semantically the same; the only change is that `application/octet-stream` is no
  longer treated as a resolved server value.
- Files with no recognisable extension AND `mime_type = "application/octet-stream"` MUST still
  resolve to `application/octet-stream` (correct final fallback).

**Scope:**

All inputs that do NOT satisfy `isBugCondition` — i.e. files that already carry a specific
non-generic MIME type, or files with unknown extensions — MUST be completely unaffected. This
includes:

- Mouse/keyboard interaction with the viewer (not touch-point for this fix).
- Share creation, password authorisation, activity logging.
- The upload path in `routes/files.py` (already derives MIME from extension at upload time;
  no change needed).

---

## Hypothesized Root Cause

Based on code inspection of `backend/app/routes/access.py` and `frontend/src/lib/crypto.ts`:

1. **`_resolve_mime()` treats any truthy `mime_type` as final**: The guard `if file_item.mime_type`
   is truthy for `"application/octet-stream"`, so the extension lookup on line
   `_EXT_MIME_FALLBACK.get(ext, "application/octet-stream")` is never reached when the column
   stores the generic type. Files uploaded before the extension-derived MIME was enforced at
   upload time (in `routes/files.py`) may have `"application/octet-stream"` as their stored
   value.

2. **`resolveMimeType()` treats any non-empty server value as authoritative**: The TypeScript
   guard `if (serverMimeType?.trim()) return serverMimeType.trim()` is true for
   `"application/octet-stream"`, bypassing the `EXTENSION_TO_MIME` lookup that would otherwise
   correct the type from the filename. This means even if the backend is fixed alone, a cached
   header or test that supplies `"application/octet-stream"` directly would still produce the
   wrong Blob type.

3. **`api.ts` default fallback is `application/octet-stream`**: Both `apiDownloadFile` and
   `apiViewFile` fall back to `'application/octet-stream'` when the `X-Mime-Type` header is
   absent. This is correct behaviour (no header → unknown), but it reinforces that the client
   must treat this value as unresolved rather than specific.

4. **No migration for legacy rows**: Files already in the database with
   `mime_type = "application/octet-stream"` will continue to serve the wrong type even after
   new uploads are stored correctly, unless the resolution logic is hardened on both sides.

---

## Correctness Properties

Property 1: Bug Condition — Generic MIME Type Override by Extension

_For any_ file access request where the bug condition holds — i.e. the current MIME type
resolution would produce `application/octet-stream` but the file's extension maps to a
specific type — the fixed `_resolve_mime()` (backend) and `resolveMimeType()` (frontend) SHALL
produce the extension-derived MIME type (e.g. `application/pdf` for `.pdf` files), causing
`isPdfMime()` to return `true` and the `PdfViewer` to render the decrypted content.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation — Specific MIME Types Are Not Overridden

_For any_ file access request where the bug condition does NOT hold — i.e. the stored
`mime_type` is already a specific, non-generic value (e.g. `image/png`, `application/pdf`,
`text/plain`) OR the filename has no resolvable extension — the fixed functions SHALL produce
the same result as the original functions, preserving all existing MIME type resolution
behaviour for well-formed records.

**Validates: Requirements 3.1, 3.2, 3.3, 3.6**

---

## Fix Implementation

### Changes Required

#### File 1: `backend/app/routes/access.py`

**Function:** `_resolve_mime(file_item: FileItem) -> str`

**Specific Change:** Treat `"application/octet-stream"` as unresolved in the stored value check.

```python
# BEFORE
def _resolve_mime(file_item: FileItem) -> str:
    if file_item.mime_type:
        return file_item.mime_type
    ext = os.path.splitext(file_item.original_filename)[1].lower()
    return _EXT_MIME_FALLBACK.get(ext, "application/octet-stream")

# AFTER
_GENERIC_MIME = "application/octet-stream"

def _resolve_mime(file_item: FileItem) -> str:
    # Treat stored "application/octet-stream" as unresolved — fall through to extension lookup.
    stored = (file_item.mime_type or "").strip()
    if stored and stored != _GENERIC_MIME:
        return stored
    ext = os.path.splitext(file_item.original_filename)[1].lower()
    return _EXT_MIME_FALLBACK.get(ext, _GENERIC_MIME)
```

**Rationale:** A stored value of `application/octet-stream` means "we did not know the type at
upload time." The extension table is a reliable secondary source; using it here is strictly more
informative for files with known extensions.

---

#### File 2: `frontend/src/lib/crypto.ts`

**Function:** `resolveMimeType(serverMimeType, filename)`

**Specific Change:** Treat `"application/octet-stream"` from the server as unresolved.

```typescript
// BEFORE
export function resolveMimeType(serverMimeType: string | null | undefined, filename = ''): string {
  if (serverMimeType?.trim()) return serverMimeType.trim()
  const dotIndex = filename.lastIndexOf('.')
  if (dotIndex !== -1) {
    const mapped = EXTENSION_TO_MIME[filename.slice(dotIndex).toLowerCase()]
    if (mapped) return mapped
  }
  return 'application/octet-stream'
}

// AFTER
const GENERIC_MIME = 'application/octet-stream'

export function resolveMimeType(serverMimeType: string | null | undefined, filename = ''): string {
  const server = serverMimeType?.trim()
  // Treat "application/octet-stream" as unresolved — attempt extension lookup first.
  if (server && server !== GENERIC_MIME) return server
  const dotIndex = filename.lastIndexOf('.')
  if (dotIndex !== -1) {
    const mapped = EXTENSION_TO_MIME[filename.slice(dotIndex).toLowerCase()]
    if (mapped) return mapped
  }
  return GENERIC_MIME
}
```

**Rationale:** The client must not trust a generic type from the server for files with known
extensions. This ensures the fix is robust even if legacy database rows are not backfilled.

---

No changes are needed to:
- `frontend/src/lib/api.ts` — the `mimeType` variable is just passed along; the resolution fix
  is in `resolveMimeType()`.
- `frontend/src/components/shares/ViewOnlyViewer.tsx` — `isPdfMime()` already works correctly
  once the Blob type is set correctly.
- `backend/app/routes/files.py` — the upload path already derives MIME from extension via
  `EXTENSION_TO_MIME` and never stores `application/octet-stream` for a known extension.

---

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples on the unfixed
code to confirm the root cause; then verify the fix produces the correct MIME type for all bug
condition inputs while preserving behaviour for all other inputs.

---

### Exploratory Bug Condition Checking

**Goal:** Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm
or refute the hypothesised root causes above. If we refute, re-hypothesize and update the design.

**Test Plan:** Call `resolveMimeType("application/octet-stream", "report.pdf")` on the unfixed
code and assert the result is `application/pdf`. On unfixed code this assertion will fail,
confirming root cause #2. Call `_resolve_mime(mock_file_item)` with
`mime_type = "application/octet-stream"` and `original_filename = "report.pdf"` on the unfixed
Python code and assert `"application/pdf"` is returned; it will fail, confirming root cause #1.

**Test Cases:**

1. **Frontend — PDF with octet-stream header**: `resolveMimeType("application/octet-stream", "report.pdf")` → asserts `"application/pdf"` (will fail on unfixed code).
2. **Frontend — PNG with octet-stream header**: `resolveMimeType("application/octet-stream", "photo.png")` → asserts `"image/png"` (will fail on unfixed code).
3. **Backend — PDF with octet-stream in DB**: `_resolve_mime(FileItem(mime_type="application/octet-stream", original_filename="report.pdf"))` → asserts `"application/pdf"` (will fail on unfixed code).
4. **Backend — unknown extension**: `_resolve_mime(FileItem(mime_type="application/octet-stream", original_filename="archive.xyz"))` → asserts `"application/octet-stream"` (should pass on both unfixed and fixed code — edge case boundary check).

**Expected Counterexamples:**

- `resolveMimeType("application/octet-stream", "report.pdf")` returns `"application/octet-stream"` instead of `"application/pdf"` on unfixed code.
- Possible causes: early-return guard treats any truthy server value as final, including the generic fallback.

---

### Fix Checking

**Goal:** Verify that for all inputs where the bug condition holds, the fixed functions produce
the extension-derived MIME type.

**Pseudocode:**

```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedResolveMimeType(input.serverMimeType, input.filename)
  ASSERT result = extensionLookup(input.filename)
  ASSERT result != "application/octet-stream"
END FOR
```

---

### Preservation Checking

**Goal:** Verify that for all inputs where the bug condition does NOT hold, the fixed functions
produce the same result as the original functions.

**Pseudocode:**

```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalResolveMimeType(input.serverMimeType, input.filename)
       = fixedResolveMimeType(input.serverMimeType, input.filename)
END FOR
```

**Testing Approach:** Property-based testing is well-suited here because:
- The input domain (all possible `(serverMimeType, filename)` pairs) is large.
- Edge cases (empty strings, null, whitespace, extensions not in the map, mixed-case extensions)
  are easy to miss with hand-written tests but are generated automatically.
- It provides a strong guarantee that no non-buggy input is regressed by the change.

**Test Plan:** Observe the original function's return value for non-bug inputs on unfixed code
(PBT will generate these), then assert the fixed function returns the same value.

**Test Cases:**

1. **Specific MIME type preserved**: `resolveMimeType("image/png", "photo.png")` → MUST still return `"image/png"` after fix.
2. **`application/pdf` in server header preserved**: `resolveMimeType("application/pdf", "report.pdf")` → MUST still return `"application/pdf"`.
3. **Null server type still uses extension**: `resolveMimeType(null, "report.pdf")` → MUST still return `"application/pdf"`.
4. **Unknown extension still falls through to octet-stream**: `resolveMimeType(null, "archive.xyz")` → MUST still return `"application/octet-stream"`.
5. **Unknown extension + octet-stream header preserved**: `resolveMimeType("application/octet-stream", "archive.xyz")` → MUST still return `"application/octet-stream"` (no regression for truly unknown files).

---

### Unit Tests

- Test `resolveMimeType()` with every extension in `EXTENSION_TO_MIME` paired with `"application/octet-stream"` as the server value — assert the extension-derived type is returned.
- Test `resolveMimeType()` with every specific non-generic server MIME type — assert it is returned unchanged.
- Test `_resolve_mime()` (Python) with `mime_type = "application/octet-stream"` and each known extension — assert extension lookup fires.
- Test `_resolve_mime()` with a specific stored MIME type (`"image/png"`) — assert it is returned unchanged.
- Test both functions with null, empty string, and whitespace-only server values — assert extension fallback is used.
- Test with filenames that have no extension — assert `"application/octet-stream"` is returned as the final default.

### Property-Based Tests

- **Fix property**: Generate `(filename, ext)` pairs where `ext` is in the extension map; run fixed `resolveMimeType("application/octet-stream", filename)` and assert result equals `EXTENSION_TO_MIME[ext]`.
- **Preservation property**: Generate `(serverMimeType, filename)` pairs where `serverMimeType` is NOT `"application/octet-stream"` and is not null/empty; assert fixed and original `resolveMimeType` return the same value.
- **Boundary property**: Generate filenames with no extension or unmapped extensions paired with any server MIME type; assert result is `"application/octet-stream"` when server is null/empty/octet-stream, and the specific server value otherwise.

### Integration Tests

- Upload a PDF, force `mime_type = "application/octet-stream"` in the database, share as VIEW_ONLY, access the share — assert the viewer renders the PDF canvas, not the fallback message.
- Same flow for a PNG file — assert the image is rendered.
- Access a share for a file with a correctly stored `mime_type = "image/png"` — assert MIME type is unchanged (`image/png`), preserving existing behaviour.
- Access a share for a file with no recognisable extension and `mime_type = "application/octet-stream"` — assert the fallback "not available" message is shown (correct final behaviour, not a regression).
