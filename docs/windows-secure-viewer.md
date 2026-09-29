# Windows Secure Viewer

The Windows Secure Viewer is an additional viewing mode; it does not replace the browser application. It reuses the existing React UI, AES-256-GCM client-side encryption, public recipient access checks, PDF.js rendering, expiration, revocation, and download-limit enforcement.

## Protection boundary

The WinForms top-level window calls the official `SetWindowDisplayAffinity` API with `WDA_EXCLUDEFROMCAPTURE` before creating or navigating WebView2. The application reapplies the affinity after resize, maximize/restore, focus, display, DPI, and window-position events. Any failure enters a native safe state and clears the viewer. The React route also gates all recipient API calls on a positive native protection message.

This protects the window from supported Windows capture mechanisms while displayed in the protected window. It is not universal: it cannot guarantee protection from physical cameras, every third-party capture implementation, hardware-level capture, privileged/malicious software, or future/unsupported Windows capture paths. Do not describe it as impossible to screenshot.

The normal `/s/` browser viewer remains available. Browser-side controls there are deterrence only and have no OS-level capture protection.

## Key-free handoff and decryption

The custom URI contains only the random share UUID and a one-time nonce. The browser retains the key from the existing URL fragment, obtains an ephemeral native RSA public key over loopback, and submits the key encrypted with RSA-OAEP-SHA256. The loopback service is bound to `127.0.0.1`, checks an exact-origin allowlist, share UUID, and nonce, and never logs the request body. The raw key is not put in the desktop URI, a backend request, or a server log. The native host sends the decrypted key to the React runtime in process through WebView2 messaging; the existing Web Crypto AES-GCM implementation decrypts the ciphertext in memory. The plaintext is not uploaded or written to a document file.

The share UUID is public recipient metadata, not the raw share token. Existing share-token links continue to work. Recipient APIs also accept the UUID for the desktop session. Password-protected shares still require the recipient to enter the password in the desktop viewer. Download shares consume their existing download allowance when fetched; view-only shares use the existing view endpoint.

## Local setup

Follow [windows-secure-viewer/README.md](../windows-secure-viewer/README.md) for .NET/WebView2 prerequisites, frontend build, Windows publish, and per-user `vaultkey://` registration. The backend permits the app's fixed `https://vaultkey.local` WebView origin. Production builds must set `VITE_API_URL` to the deployed API origin and configure the exact share-page origin in `VAULTKEY_VIEWER_ORIGINS`.

## Manual Windows capture validation

On a supported Windows machine, record the OS build, display topology, scaling, and the result for each capture tool. Test Snipping Tool, Windows screen capture/recording, and supported third-party capture software while windowed, maximized, full-screen, moved between monitors, after display/DPI changes, and after suspend/resume. Also test capture-protection failure and confirm no decrypted document appears. No capture tool has been verified by automated tests in this repository.
