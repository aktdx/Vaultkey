# VaultKey Project Overview

VaultKey is a privacy-focused secure file-sharing application that gives users granular control over sensitive files after they are shared.

## Architecture

VaultKey implements a complete end-to-end security workflow:
**UPLOAD → ENCRYPT → SHARE → CONTROL → MONITOR → REVOKE**

### Frontend (React + Vite)
- Client-side AES-GCM 256-bit encryption using Web Crypto API
- Zero-knowledge architecture: encryption keys never touch the server
- Magic-byte validation for file integrity before encryption
- Modern UI with dark mode support using Tailwind CSS

### Backend (FastAPI + Python)
- Token-based authentication with JWT
- Server-side access control (expiration, download limits, passwords)
- Atomic download counters to prevent race conditions
- Real-time audit logging with X-Forwarded-For support
- Rate limiting with SlowAPI

### Database (Neon PostgreSQL)
- Users, files metadata, share links, and access logs
- Alembic migrations for schema evolution
- Foreign key cascades for data integrity

### Storage (Cloudflare R2)
- Encrypted ciphertext blob storage
- S3-compatible API
- Separation of metadata (PostgreSQL) and encrypted data (R2)

## Security Model

1. **Client-Side Encryption**: Files are encrypted in the browser before upload
2. **Zero-Knowledge Key Wrapping**: Encryption keys are wrapped in the browser via PBKDF2 (600,000 rounds) + AES-GCM; clean share URLs contain only random tokens with no keys
3. **Server-Side Access Control**: Backend enforces time limits, download counters, and password protection
4. **Audit Trail**: All access attempts are logged with IP addresses and user agents
5. **Remote Revocation**: Owners can revoke access instantly, preventing future downloads

## Key Features

- Multi-file-type support (PDF, images, text/code files)
- Password-protected shares (minimum 4 characters)
- Configurable expiration (1 hour to 7 days)
- Download limits (0-10, where 0 = view-only mode)
- Real-time activity monitoring
- One-click revocation
- Health checks for production monitoring

## Documentation

- [Architecture Details](./architecture.md)
- [Security Model](./security.md)
- [Threat Model](./threat-model.md)

For setup instructions, see the main [README](../README.md).