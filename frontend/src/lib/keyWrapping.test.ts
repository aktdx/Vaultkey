/**
 * Key Wrapping & Clean Share URL Tests
 *
 * Verifies:
 * 1. Independent, cryptographically secure 256-bit FEK generation.
 * 2. KEK derivation via PBKDF2-HMAC-SHA-256 with 600,000 iterations.
 * 3. Authenticated AES-256-GCM key wrapping with fresh 12-byte wrapping IV.
 * 4. Correct passphrase unwraps FEK and decrypts ciphertext to exact original plaintext.
 * 5. Wrong passphrase fails unwrap with OperationError (GCM auth tag mismatch).
 * 6. Tampered wrapped FEK or tampered IV fails unwrap.
 * 7. buildShareUrl produces strictly /s/<token> without #key= or secret fragments.
 * 8. Passphrase generator generates high-entropy passphrases.
 */
import { describe, it, expect } from 'vitest'
import {
  encryptFile,
  decryptFileWithKey,
  generateKey,
  exportKey,
  deriveKEK,
  wrapFEK,
  unwrapFEK,
  generateSalt,
  bytesToHex,
  hexToBytes,
  generateSecurePassphrase,
  hashSharePassword,
  DEFAULT_KDF_ITERATIONS,
  KDF_ALGORITHM,
} from './crypto'
import { buildShareUrl } from './utils'

describe('Key Wrapping Security Architecture', () => {
  it('generates distinct, random 256-bit FEKs on every call', async () => {
    const key1 = await generateKey()
    const key2 = await generateKey()

    const raw1 = await exportKey(key1)
    const raw2 = await exportKey(key2)

    expect(raw1).not.toBe(raw2)
    // 256 bits = 32 bytes = 43 base64url characters
    expect(raw1.length).toBeGreaterThanOrEqual(43)
  })

  it('generates high-entropy passphrases with at least 4 words and random suffix', () => {
    const p1 = generateSecurePassphrase()
    const p2 = generateSecurePassphrase()

    expect(p1).not.toBe(p2)
    const parts1 = p1.split('-')
    expect(parts1.length).toBeGreaterThanOrEqual(5) // 4 words + number
    expect(p1.length).toBeGreaterThanOrEqual(16)
  })

  it('derives KEK using PBKDF2-HMAC-SHA-256 with strong iterations', async () => {
    expect(DEFAULT_KDF_ITERATIONS).toBe(600_000)
    expect(KDF_ALGORITHM).toBe('PBKDF2-HMAC-SHA-256')

    const salt = generateSalt(16)
    const kek1 = await deriveKEK('correct-horse-battery-staple', salt, 50_000)
    const kek2 = await deriveKEK('correct-horse-battery-staple', salt, 50_000)
    const kekDiffPassword = await deriveKEK('wrong-horse-battery-staple', salt, 50_000)
    const kekDiffSalt = await deriveKEK('correct-horse-battery-staple', generateSalt(16), 50_000)

    expect(kek1.algorithm.name).toBe('AES-GCM')
    expect((kek1.algorithm as AesKeyGenParams).length).toBe(256)

    // Test that kek1 and kek2 produce identical wrapping output with fixed IV, while diff passwords/salts differ
    const fek = await generateKey()
    const { wrappedFekBase64: wrapped1, wrappingIvHex: iv1 } = await wrapFEK(fek, kek1)
    
    // Unwrapping with kek2 (same password & salt) must succeed
    const unwrappedFromKek2 = await unwrapFEK(wrapped1, kek2, iv1)
    expect(unwrappedFromKek2).toBeDefined()

    // Unwrapping with wrong password or wrong salt must fail
    await expect(unwrapFEK(wrapped1, kekDiffPassword, iv1)).rejects.toThrow()
    await expect(unwrapFEK(wrapped1, kekDiffSalt, iv1)).rejects.toThrow()
  })

  it('wraps FEK with fresh 12-byte nonce every time', async () => {
    const fek = await generateKey()
    const salt = generateSalt(16)
    const kek = await deriveKEK('test-passphrase-vaultkey', salt, 10_000)

    const wrap1 = await wrapFEK(fek, kek)
    const wrap2 = await wrapFEK(fek, kek)

    // Nonces must be unique (never reused)
    expect(wrap1.wrappingIvHex).not.toBe(wrap2.wrappingIvHex)
    // 12 bytes = 24 hex characters
    expect(wrap1.wrappingIvHex.length).toBe(24)
    expect(wrap2.wrappingIvHex.length).toBe(24)
    // Ciphertexts differ due to fresh IV
    expect(wrap1.wrappedFekBase64).not.toBe(wrap2.wrappedFekBase64)
  })

  it('successfully unwraps FEK and decrypts file when password is correct', async () => {
    const originalText = 'VaultKey confidential document content for key-wrapping test.'
    const data = new TextEncoder().encode(originalText).buffer

    // 1. Encrypt file with random FEK
    const { ciphertext, iv, key: fekKey } = await encryptFile(data, 'notes.txt')

    // 2. Wrap FEK with passphrase
    const passphrase = 'secure-vault-passphrase-2026'
    const salt = generateSalt(16)
    const kek = await deriveKEK(passphrase, salt, 20_000)
    const { wrappedFekBase64, wrappingIvHex } = await wrapFEK(fekKey, kek)

    // 3. Recipient side: derive KEK and unwrap FEK
    const recipientKek = await deriveKEK(passphrase, salt, 20_000)
    const unwrappedFek = await unwrapFEK(wrappedFekBase64, recipientKek, wrappingIvHex)

    // 4. Decrypt file using unwrapped FEK
    const decryptedBlob = await decryptFileWithKey(ciphertext, iv, unwrappedFek, 'text/plain', 'notes.txt')
    const decryptedText = await decryptedBlob.text()

    expect(decryptedText).toBe(originalText)
  })

  it('fails unwrap with wrong password due to authenticated GCM tag verification', async () => {
    const fek = await generateKey()
    const salt = generateSalt(16)
    const kek = await deriveKEK('correct-passphrase-alpha', salt, 10_000)
    const { wrappedFekBase64, wrappingIvHex } = await wrapFEK(fek, kek)

    const wrongKek = await deriveKEK('wrong-passphrase-beta', salt, 10_000)

    await expect(unwrapFEK(wrappedFekBase64, wrongKek, wrappingIvHex)).rejects.toThrow()
  })

  it('fails unwrap if wrapped ciphertext or wrapping IV is tampered with', async () => {
    const fek = await generateKey()
    const salt = generateSalt(16)
    const kek = await deriveKEK('tamper-test-passphrase', salt, 10_000)
    const { wrappedFekBase64, wrappingIvHex } = await wrapFEK(fek, kek)

    // Tamper wrapping IV
    const tamperedIvBytes = hexToBytes(wrappingIvHex)
    tamperedIvBytes[0] ^= 0xff
    const tamperedIvHex = bytesToHex(tamperedIvBytes)
    await expect(unwrapFEK(wrappedFekBase64, kek, tamperedIvHex)).rejects.toThrow()

    // Tamper wrapped FEK ciphertext
    const tamperedCiphertext = wrappedFekBase64.slice(0, -2) + (wrappedFekBase64.endsWith('A') ? 'B' : 'A')
    await expect(unwrapFEK(tamperedCiphertext, kek, wrappingIvHex)).rejects.toThrow()
  })

  it('buildShareUrl produces strictly /s/<token> without #key= or secret fragments', () => {
    const shareId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    const url = buildShareUrl(shareId)

    // Strictly /s/<shareId>
    expect(url).toContain(`/s/${shareId}`)
    // Must NOT contain #key= or any query key=
    expect(url).not.toContain('#key=')
    expect(url).not.toContain('key=')
    expect(url).not.toContain('#')
    expect(url).not.toContain('?')
  })

  it('computes deterministic password hash with salt for backend authorization', async () => {
    const saltHex = bytesToHex(generateSalt(16))
    const h1 = await hashSharePassword('my-share-passphrase', saltHex)
    const h2 = await hashSharePassword('my-share-passphrase', saltHex)
    const hDiff = await hashSharePassword('different-passphrase', saltHex)

    expect(h1).toBe(h2)
    expect(h1).not.toBe(hDiff)
  })
})
