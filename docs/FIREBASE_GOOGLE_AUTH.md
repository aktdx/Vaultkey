# Firebase Google Authentication — Setup Guide

VaultKey uses Firebase Authentication to handle Google sign-in. Firebase verifies the user's Google identity and returns a short-lived ID token. The VaultKey backend exchanges that token for its own JWT — so all existing API routes and session management continue to work without modification.

---

## 1. Create a Firebase Project

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com).
2. Click **Add project**, enter a name (e.g. `vaultkey-prod`), and follow the wizard.
3. You do **not** need Google Analytics enabled.

---

## 2. Enable Google Sign-In Provider

1. In the Firebase Console, open your project.
2. Go to **Authentication → Sign-in method**.
3. Click **Google**, toggle it to **Enabled**.
4. Set a **Project support email** (required).
5. Click **Save**.

---

## 3. Add a Firebase Web App

1. Go to **Project Settings** (gear icon) → **General**.
2. Scroll to **Your apps**, click **Add app → Web** (`</>`).
3. Enter a nickname (e.g. `VaultKey Frontend`).
4. Click **Register app**.
5. Copy the `firebaseConfig` object — you'll need these six values:

```
apiKey
authDomain
projectId
storageBucket
messagingSenderId
appId
```

---

## 4. Configure Authorised Domains

Firebase blocks sign-in from unlisted domains.

1. Go to **Authentication → Settings → Authorised domains**.
2. `localhost` is already present (for local dev).
3. Add your production frontend domain (e.g. `app.vaultkey.io`).

---

## 5. Frontend Environment Variables

Copy `frontend/.env.example` to `frontend/.env` and fill in the values from Step 3:

```env
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abcdef123456
```

These values are **safe to ship in the browser** — they identify which Firebase project to use, they are not secret credentials.

---

## 6. Generate a Firebase Service Account Key (Backend)

The VaultKey backend needs a **service account** to verify Firebase ID tokens server-side.

1. Go to **Project Settings → Service accounts**.
2. Click **Generate new private key** → **Generate key**.
3. A JSON file downloads. **Do not commit this file.**
4. Open the file and copy its entire contents. You will paste this as a single-line environment variable (see Step 7).

---

## 7. Backend Environment Variables

Copy `backend/.env.example` to `backend/.env` and add:

```env
FIREBASE_PROJECT_ID=your-project-id

# Paste the entire service account JSON as one line (remove all newlines)
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"..."}
```

To convert the JSON file to a single line on Windows:
```powershell
(Get-Content service-account.json -Raw) -replace '\r?\n', '' | Set-Clipboard
```

On macOS/Linux:
```bash
cat service-account.json | tr -d '\n' | pbcopy   # macOS
cat service-account.json | tr -d '\n'             # Linux — copy the output
```

---

## 8. Local Development Setup

```bash
# Backend
cd backend
cp .env.example .env           # fill in all values including Firebase vars
.\.venv\Scripts\activate        # or: source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head            # applies migration 003 (firebase_uid column)
uvicorn app.main:app --reload

# Frontend
cd frontend
cp .env.example .env           # fill in VITE_FIREBASE_* vars
npm install
npm run dev
```

---

## 9. Database Migration

Migration `003_google_auth.py` must be applied before the Google endpoint works:

```bash
cd backend
alembic upgrade head
```

This migration:
- Makes `hashed_password` nullable (Google-only users have no password).
- Adds `firebase_uid VARCHAR(128) UNIQUE` column to the `users` table.

Existing email/password users are unaffected.

---

## 10. Production Deployment on Render

In the Render dashboard for your **backend service**:

1. Go to **Environment** → **Environment Variables**.
2. Add:

| Key | Value |
|-----|-------|
| `FIREBASE_PROJECT_ID` | your Firebase project ID |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | the entire service account JSON as a single line |

No files to upload — Render reads from env vars only.

For the **frontend** (Netlify, Vercel, or Render static site):

Add the six `VITE_FIREBASE_*` variables to your deployment platform's environment variable settings. These are applied at build time by Vite.

---

## 11. Troubleshooting

### "Pop-up was blocked by your browser"
The browser is blocking the Firebase OAuth pop-up. Allow pop-ups for your app's domain in browser settings, or switch to `signInWithRedirect` if pop-ups are consistently blocked for your users.

### "Firebase configuration error: VITE_FIREBASE_API_KEY is not set"
The frontend `.env` file is missing or the variable name is wrong. Check `frontend/.env` against the example file.

### Backend returns `503 — Google sign-in is not configured`
`FIREBASE_SERVICE_ACCOUNT_JSON` or `FIREBASE_PROJECT_ID` is not set on the backend. Check the server environment variables.

### Backend returns `401 — Invalid authentication token`
Common causes:
- The Firebase ID token was sent to the wrong Firebase project (project ID mismatch).
- The token is expired (they expire after 1 hour; `getIdToken(true)` forces a refresh).
- The service account key is for a different Firebase project than the frontend config.

### "An account already exists with this email"
The user tried to sign in with Google but the email is already registered with a different provider (e.g. an existing email/password account). VaultKey automatically links the accounts on the next Google sign-in if the email matches — so this error should only appear on the first attempt if the Google email differs from the registered one.

### Service account permission error
The service account must have the **Firebase Authentication Admin** role. Go to Google Cloud Console → IAM → find the service account → add `Firebase Authentication Admin` role.
