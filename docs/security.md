# VaultKey Security & Compliance Guide

## Security Controls Checklist

- [x] **Web Crypto API**: Native browser AES-GCM 256-bit encryption.
- [x] **Zero-Knowledge Key Wrapping**: Decryption key wrapped locally with PBKDF2 (600,000 iterations); clean URLs without secret fragments.
- [x] **PDF Validation**: Verified both by MIME type, extension, and `%PDF-` magic header bytes.
- [x] **Atomic Download Counter**: Race-condition-safe counter updates.
- [x] **Strict Size Limits**: 50 MB enforced in browser and FastAPI backend.
- [x] **Password Hashing**: PBKDF2/Bcrypt hash verification for protected shares.
- [x] **Audit Trail**: Every access attempt, download, revocation, and password failure logged.
- [x] **View-Only Share Mode**: Server-side rejection of download API calls; browser-side deterrence layer.

## Defensive Terminology
VaultKey uses the term **Client-side encrypted file sharing**. It does not claim "100% unhackable" or "DRM screenshot proof". Key security relies on authenticated client-side AES-GCM key wrapping where plaintext keys and passphrases are never transmitted to the backend.

---

## View-Only Mode

### What it does

View-Only mode (`access_mode: view_only`) provides a **multi-layer deterrence** system against casual downloading, saving, and printing of shared files.

**Server-side enforcement (authoritative security boundary)**

- `POST /api/access/{token}/download` returns **HTTP 403** for any share whose `access_mode` is `view_only`.  This check happens unconditionally — hiding the button in the frontend is not sufficient.
- A separate `POST /api/access/{token}/view` endpoint serves the ciphertext for view-only recipients.  It logs `VIEW_STARTED` and never increments the download counter.
- The `POST /api/access/{token}/report-blocked` endpoint receives client-reported audit events (`PRINT_BLOCKED`, `DOWNLOAD_BLOCKED`, `SAVE_ATTEMPT_BLOCKED`, `VIEW_STARTED`, `VIEW_COMPLETED`). Allowed events are validated by a strict Pydantic `Literal` type — arbitrary strings are rejected with HTTP 422.
- All existing access controls (expiry, revocation, password protection, rate limiting, JWT authentication, share-token hashing) remain fully active for View-Only shares.

**Browser-side deterrence (convenience layer, not a security guarantee)**

- No "Download" button is rendered in the UI for View-Only shares.
- The `ViewOnlyViewer` component intercepts the following keyboard shortcuts and calls `preventDefault()`:
  - `Ctrl/Cmd+S`, `Ctrl/Cmd+Shift+S` — Save/Save As
  - `Ctrl/Cmd+P` — Print
  - `Ctrl/Cmd+U` — View Source
  - `F12`, `Ctrl/Cmd+Shift+I`, `Ctrl/Cmd+Shift+J`, `Ctrl/Cmd+Shift+C` — DevTools (deterrence only)
- Right-click context menu is suppressed on the viewer container.
- `window.print()` is patched to a no-op for the lifetime of the viewer.
- A `@media print { body { display: none } }` stylesheet is injected while the viewer is open.
- PDF files are rendered with `#toolbar=0&navpanes=0` to suppress the browser's built-in PDF download toolbar.
- Image files are rendered via `<img>` with `draggable=false` and `pointer-events:none`.
- Text/code files are rendered via an application-controlled `<pre>` block, not a raw URL.
- Blob URLs are revoked immediately when the viewer is closed (`URL.revokeObjectURL`).
- Decrypted content is not written to `localStorage`, `sessionStorage`, `IndexedDB`, or any persistent cache.

**Audit events**

| Event | Trigger |
|---|---|
| `VIEW_STARTED` | Recipient's browser successfully fetches the ciphertext via `/view` |
| `VIEW_COMPLETED` | Recipient closes the viewer |
| `PRINT_BLOCKED` | `Ctrl/Cmd+P` or `window.print()` intercepted client-side |
| `SAVE_ATTEMPT_BLOCKED` | `Ctrl/Cmd+S` intercepted client-side |
| `DOWNLOAD_BLOCKED` | Any direct call to `/download` on a view-only share (server), or drag-save attempt (client) |

---

### Security limitations — important

> **View-Only mode provides browser-side deterrence against casual downloading, saving, and printing. It does not provide absolute protection against copying because content that is rendered on a recipient-controlled device cannot be made completely non-extractable.**

Specifically, a determined recipient can still obtain the content through:

- **Browser network inspector** — the encrypted ciphertext is transferred to the browser; the decryption key is in the URL fragment and therefore visible to the recipient.
- **Memory inspection** — the decrypted Blob exists in browser memory while the viewer is open.
- **Screenshots or screen recording** — no in-application countermeasure can prevent this.
- **Physical cameras** aimed at the screen.
- **Modified browsers or browser extensions** that ignore `preventDefault()`.
- **Clipboard capture** — text content can be selected and copied from the text viewer.

Do not describe View-Only mode using any of the following terms:

- ❌ DRM
- ❌ Impossible to copy
- ❌ Impossible to download
- ❌ Screenshot-proof
- ❌ DevTools-proof

The server-side `access_mode` check in `/api/access/{token}/download` is the only layer that provides a genuine technical enforcement boundary.  Everything else is best-effort deterrence.

