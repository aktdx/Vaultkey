# VaultKey Technical Architecture & Key Management Spec

VaultKey is built around a strict separation of **Server-Side Access Control** and **Client-Side Data Confidentiality**.

---

## 1. Key Wrapping Architecture

```
Owner Browser (Upload & Share)                   Recipient Browser (Download/View)
+-------------------------------+               +-------------------------------+
| 1. Generate FEK (AES-256-GCM) |               | 1. Input Share Passphrase     |
| 2. Encrypt File locally       |               | 2. Request Ciphertext &       |
| 3. Derive KEK via PBKDF2 from |               |    wrapped FEK + salt from API|
|    passphrase + random salt   |               | 3. Derive KEK locally         |
| 4. Wrap FEK with KEK (AES-GCM)|               | 4. Authenticated unwrap of FEK|
| 5. Upload Ciphertext + wrapped|               | 5. Decrypt File locally       |
|    FEK, salt, and nonces      |               +---------------+---------------+
+---------------+---------------+                               ^
                |                                               |
                | (Ciphertext + Wrapped FEK + Salt + IVs)       | (Ciphertext + Wrapped FEK)
                v                                               |
+---------------------------------------------------------------+---------------+
|                              FastAPI Backend                                  |
| - Verifies Share Token Hash (SHA-256)                                         |
| - Enforces Server-Side Expiration, Auth Hash, & Max Download Limit            |
| - Performs Instant Remote Revocation Checks                                   |
| - Never sees or receives the plaintext FEK, KEK, or user passphrase           |
+-------------------------------------------------------------------------------+
```

### Clean URL Security (Zero-Knowledge Key Wrapping)
When an owner generates a share link, VaultKey formats the URL as:
```
https://vaultkey.app/s/<share-id>
```
1. **Clean URL Standard**: URLs contain **only a random, non-secret share ID**. The encryption key, IV, password, or any encoded/hashed version of them are NEVER placed in the URL, fragment, query parameters, or storage.
2. **Out-of-Band Passphrase Delivery**: The user provides the share passphrase to the recipient out-of-band (e.g. SMS, Signal, email).
3. **Authenticated Key Wrapping**: The File Encryption Key (FEK) is encrypted client-side using a Key Encryption Key (KEK) derived with PBKDF2-HMAC-SHA-256 (600,000 iterations). Wrong passphrases fail authenticated decryption locally.
4. **Server Blindness**: The backend server receives only the ciphertext, wrapped FEK, salt, and nonces. Even if the server database is breached, it possesses zero plaintext decryption keys.

---

## 2. Server-Side Authorization Controls

Every recipient request undergoes 5-layer server-side evaluation:
1. **Token Hash Existence**: Standard lookup of SHA-256 hash of token.
2. **Revocation State**: Checks `shares.revoked == False`.
3. **Expiration Timestamp**: Compares `shares.expires_at > UTC NOW()`.
4. **Atomic Download Counter**: Executes atomic SQL counter increment `UPDATE shares SET download_count = download_count + 1 WHERE download_count < max_downloads`. If zero rows are affected, access is denied.
5. **Authorization Verification**: Validates password/hash if protection is enabled.

---

## 3. Cryptographic Primitives

- **File Encryption**: AES-GCM (Galois/Counter Mode) with 256-bit key length (FEK).
- **Key Wrapping**: Authenticated AES-GCM with 256-bit Key Encryption Key (KEK) and fresh 12-byte wrapping IV.
- **Key Derivation Function (KDF)**: PBKDF2-HMAC-SHA-256 with 600,000 iterations and 16-byte random salt.
- **Browser API**: Standard `window.crypto.subtle` (Web Crypto API).
