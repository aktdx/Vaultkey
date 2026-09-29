# VaultKey Windows Secure Viewer

This Windows-only WinForms/WebView2 host reuses the React/Vite viewer and the existing Web Crypto AES-256-GCM decrypt path. The top-level WinForms HWND is protected with `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` before WebView2 is initialized or any share API is called.

The app accepts `vaultkey://share/<share-id>?nonce=<random-challenge>`. The link contains no share token, password, or encryption key. The browser fetches an ephemeral RSA public key from a loopback-only service, encrypts the existing AES key with RSA-OAEP-SHA256, and posts only the ciphertext to `127.0.0.1:41739`. The native process decrypts that handoff in memory and sends it to the React runtime through WebView2 messaging. The encrypted document remains on the server; the browser decrypts it locally using the existing crypto module.

The loopback bridge accepts only the configured browser origins, the launch share ID, and its one-use 256-bit nonce. Configure additional trusted web origins with `VAULTKEY_VIEWER_ORIGINS`, a semicolon-separated exact-origin list. The default list covers the production VaultKey origin and Vite localhost origins. Never use a wildcard origin.

## Build and run

Prerequisites: Windows 10 version 2004 or later, .NET 8 SDK, Node.js/npm, and the Evergreen WebView2 Runtime.

```powershell
cd frontend
npm install --no-package-lock
$env:VITE_API_URL = 'http://localhost:8000'
npm run build

cd ../windows-secure-viewer
dotnet publish -c Release -r win-x64 --self-contained false
./register-protocol.ps1 -ExecutablePath ./bin/Release/net8.0-windows/win-x64/publish/VaultKey.SecureViewer.exe
```

Set `VITE_API_URL` to the deployed API origin before building for production. Then run the backend using the existing instructions in the repository README and open a share in the web app. The browser's **Open in Secure Viewer** action launches the registered URI scheme and transfers the key over the encrypted one-use loopback handoff. The desktop app can also be started with a valid `vaultkey://share/...` URI as its argument.

The protocol registration is per-user under `HKCU`. Remove it with:

```powershell
Remove-Item -Path 'HKCU:\Software\Classes\vaultkey' -Recurse -Force
```

## Fail-closed behavior

The app applies capture affinity before loading WebView2. If setting affinity fails, if the loopback listener cannot bind, if the WebView2 assets are missing, or if capture affinity cannot be reapplied after a window/display state change, no protected content is loaded or it is immediately replaced by a native failure state. The React route independently refuses to request share data until it receives a native `viewer-ready` message with protection enabled. A running session revalidates expiry/revocation every 5 seconds and clears its render state on failure.

## Verification limits

This wrapper uses the official Windows API but does not make capture mathematically impossible. The repository's automated tests cannot verify Windows capture behavior. Manually test Snipping Tool, Windows capture, supported third-party capture applications, windowed/maximized/full-screen states, DPI/resolution changes, monitor moves, and suspend/resume on each supported Windows build. Record tested OS version and exact capture tool results. Physical cameras, privileged malware, hardware capture, and unsupported capture paths remain outside the guarantee.
