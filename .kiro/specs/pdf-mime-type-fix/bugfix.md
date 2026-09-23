# Bugfix Requirements Document

## Introduction

PDF files (and potentially other typed files) shared via VaultKey display "Inline preview not available for this file type (application/octet-stream)" instead of rendering correctly in the browser viewer. The root cause is that `application/octet-stream` — a non-null, non-empty string — is accepted as a valid MIME type by `resolveMimeType()`, causing it to bypass the extension-based fallback. This happens in two scenarios: (1) the backend's `X-Mime-Type` response header is absent or carries `application/octet-stream` for files whose `mime_type` column is null/empty in the database, and (2) the client falls back to `application/octet-stream` as the default when the header is missing. In both cases, the decrypted `Blob` receives the wrong type, `isPdfMime()` returns false, and the viewer renders the fallback "not available" message instead of the PDF canvas.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a file's `mime_type` database column is null or empty AND the original filename has a known extension (e.g. `.pdf`) THEN the system returns `X-Mime-Type: application/octet-stream` via the extension-fallback path, because `_resolve_mime()` only falls back to extension lookup when `file_item.mime_type` is falsy — and a stored empty string may still be treated as falsy inconsistently.

1.2 WHEN the `X-Mime-Type` response header is present with the value `application/octet-stream` THEN the system constructs the decrypted `Blob` with `type: 'application/octet-stream'` because `resolveMimeType()` treats any non-empty server value as authoritative, including the generic fallback value.

1.3 WHEN the decrypted `Blob` has `type: 'application/octet-stream'` THEN the system displays "Inline preview not available for this file type (application/octet-stream)" in the `ViewOnlyViewer` instead of rendering the PDF.

1.4 WHEN a PDF file is accessed via the `/download` endpoint THEN the system saves the decrypted file with `application/octet-stream` content type instead of `application/pdf`, preventing the operating system and browser from identifying it as a PDF.

### Expected Behavior (Correct)

2.1 WHEN a file's `mime_type` database column is null or empty AND the original filename has a `.pdf` extension THEN the system SHALL return `X-Mime-Type: application/pdf` by successfully resolving the MIME type from the filename extension in `_resolve_mime()`.

2.2 WHEN the `X-Mime-Type` response header carries `application/octet-stream` THEN the system SHALL treat this as an unresolved type and attempt resolution from the original filename extension before accepting `application/octet-stream` as the final value.

2.3 WHEN the decrypted `Blob` for a PDF file is constructed THEN the system SHALL set `type: 'application/pdf'` on the Blob so that `isPdfMime()` returns true and the `PdfViewer` component is rendered.

2.4 WHEN a PDF file is accessed via the `/download` endpoint THEN the system SHALL save the decrypted file with `application/pdf` content type so the browser and operating system correctly identify and open the file.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a file has a correctly stored `mime_type` in the database (e.g. `image/png`, `text/plain`) THEN the system SHALL CONTINUE TO use that stored MIME type for both the `X-Mime-Type` header and the decrypted Blob type.

3.2 WHEN a file's extension maps to a non-PDF MIME type (e.g. `.png` → `image/png`, `.txt` → `text/plain`) THEN the system SHALL CONTINUE TO resolve and use the correct MIME type for preview rendering and download.

3.3 WHEN a file has no recognisable extension AND no stored `mime_type` THEN the system SHALL CONTINUE TO fall back to `application/octet-stream` as the final default, showing the "not available" preview message.

3.4 WHEN a VIEW_ONLY share link is accessed THEN the system SHALL CONTINUE TO enforce view-only restrictions (no download, no print) regardless of the MIME type fix.

3.5 WHEN a DOWNLOAD-mode share link is accessed THEN the system SHALL CONTINUE TO enforce download counter limits, expiry, and password checks regardless of the MIME type fix.

3.6 WHEN the `X-Mime-Type` header contains a specific, non-generic MIME type (e.g. `image/png`, `application/pdf`) THEN the system SHALL CONTINUE TO use that header value directly without extension-based re-resolution.
