# VaultKey — Share securely. Stay in control.

> Privacy-focused secure file-sharing application designed to give users granular control over sensitive files after they are shared.

VaultKey implements a complete end-to-end security workflow:
**UPLOAD → ENCRYPT → SHARE → CONTROL → MONITOR → REVOKE**

---

## Key Features

- **Client-Side Cryptography**: Files are encrypted in the browser using **256-bit AES-GCM** via the standard Web Crypto API before upload.
- **Zero-Knowledge Key Wrapping**: The File Encryption Key (FEK) is wrapped in the browser with AES-256-GCM using a Key Encryption Key (KEK) derived from a share passphrase (PBKDF2-HMAC-SHA-256, 600,000 iterations). Share URLs contain strictly a clean non-secret token (`/s/{token}`) with zero keys, IVs, or secrets in the URL.
- **Server-Side Access Control**: FastAPI backend enforces token validation, expiration date, maximum download limits, and password verification.
- **Atomic Download Counter**: Atomic database updates prevent race conditions and limit bypasses.
- **Remote Revocation**: Owners can revoke share links instantly with one click, cutting off future access.
- **Audit Activity Timeline**: Chronological log of link creations, access attempts, downloads, password failures, and revocations.
- **Calm, Premium UI**: Modern interface with full Dark Mode support, built with React, Vite, and Tailwind CSS.

---

## Tech Stack

- **Frontend**: React, Vite, Tailwind CSS, Lucide React, Web Crypto API, React Router DOM.
- **Backend**: Python 3.11+, FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2, Passlib (Bcrypt), Python-JOSE (JWT), SlowAPI (rate limiting).
- **Database & Storage**: Neon PostgreSQL (via SQLAlchemy + psycopg2) + Cloudflare R2 (S3-compatible object storage).

---

## Quick Start Guide

### Prerequisites

- Python 3.11+ with pip
- Node.js 18+ with npm
- Neon PostgreSQL database (sign up at [neon.tech](https://neon.tech))
- Cloudflare R2 account (or S3-compatible storage)

### 1. Backend Setup

```bash
cd backend

# Copy environment template
copy .env.example .env

# Edit .env and fill in:
# - JWT_SECRET (generate with: python -c "import secrets; print(secrets.token_hex(64))")
# - DATABASE_URL (from Neon console)
# - R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY

# Install dependencies
pip install -r requirements.txt

# Run database migrations
alembic upgrade head

# Start the server
python run.py
```

The backend API server will start at `http://127.0.0.1:8000`.

### 2. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

The frontend dev server will start at `http://localhost:5173`.

---

## Complete Demo Flow Walkthrough

1. **Register/Login**: Register a new account (e.g. `alice@vaultkey.app`).
2. **Upload File**: Click **+ Upload File**. Select a supported file (PDF, images, or text files).
3. **Local Encryption**: Watch the browser perform 256-bit AES-GCM encryption before sending ciphertext to the backend.
4. **Configure Access Controls**: Set Expiration (e.g., 24 hours), Max Downloads (e.g., 5 downloads), and optional Password (minimum 4 characters).
5. **Set Share Passphrase**: Generate or enter a share passphrase. The browser wraps the File Encryption Key (FEK) locally with a Key Encryption Key (KEK) derived via PBKDF2 (600,000 iterations).
6. **Copy Clean Share Link**: Copy the generated link format: `http://localhost:5173/s/<token>` (clean URL with no secret fragments or keys).
7. **Share Passphrase Out-of-Band**: Send the share passphrase to the recipient separately (e.g., via SMS or Signal).
8. **Recipient Access & Decryption**: The recipient opens the clean link, enters the passphrase, and the recipient browser unwraps the FEK and decrypts the file locally.
9. **Check Audit Log**: Return to Alice's dashboard/activity. View `ACCESS_GRANTED` and `FILE_DOWNLOADED` entries with real client IPs.
10. **Remote Revocation**: Alice clicks **REVOKE ACCESS**. Re-opening the recipient link now immediately displays `ACCESS REVOKED`.

---

## Windows Secure Viewer

An optional native Windows viewer reuses the React interface and applies Windows display-capture protection to its top-level window. It fails closed if native protection cannot be enabled; this protects against supported Windows capture mechanisms, not every possible recording method. See [docs/windows-secure-viewer.md](docs/windows-secure-viewer.md) for its security boundary, setup, and manual validation checklist.

## Deployment

### Backend (Railway / Render / Heroku)

1. Set environment variables in your deployment platform:
   - `JWT_SECRET`, `DATABASE_URL`, `R2_*` credentials, `ALLOWED_ORIGINS`, `ENVIRONMENT=production`
2. The `Procfile` includes a `release` command that runs `alembic upgrade head` before starting the web server
3. Deploy from the `backend` directory

### Frontend (Vercel / Netlify)

1. Set `VITE_API_URL` to your backend URL
2. Build command: `npm run build`
3. Output directory: `dist`
4. Deploy from the `frontend` directory

---

## Testing

### Frontend Tests
```bash
cd frontend
npm test              # Run once
npm run test:watch    # Watch mode
```

### Backend Tests
```bash
cd backend
python -m pytest      # Run all tests
python -m pytest -v   # Verbose output
```
