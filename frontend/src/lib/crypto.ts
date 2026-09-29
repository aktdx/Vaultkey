/**
 * VaultKey Encryption/Decryption Module
 * Uses the Web Crypto API with AES-256-GCM for browser-side encryption.
 * This is the REAL implementation — no fake security claims.
 */

const ALGORITHM = 'AES-GCM'
const KEY_LENGTH = 256
const IV_LENGTH = 12 // 96-bit IV for GCM

export interface EncryptedPayload {
  ciphertext: ArrayBuffer
  iv: Uint8Array
  key: CryptoKey       // 256-bit AES-GCM File Encryption Key (in memory)
  keyBase64: string    // base64url-encoded raw key bytes (in memory only, never sent to server)
}

export const DEFAULT_KDF_ITERATIONS = 600_000
export const KDF_ALGORITHM = 'PBKDF2-HMAC-SHA-256'

// ── Security #1: File-content validation before encryption ───────────────────
// Added: magic-byte validation for binary types, null-byte check for text types.
// Validation runs BEFORE key generation so bad input is rejected cheaply.

/**
 * Magic-byte signatures for binary file types.
 * Each entry: byte offset + expected hex prefix.
 */
const MAGIC_BYTES: Record<string, { offset: number; hex: string }> = {
  pdf:  { offset: 0, hex: '25504446' },   // %PDF
  ppt:  { offset: 0, hex: 'd0cf11e0a1b11ae1' }, // OLE Compound File
  pptx: { offset: 0, hex: '504b0304' },   // ZIP-based Office Open XML
  png:  { offset: 0, hex: '89504e47' },   // \x89PNG
  jpg:  { offset: 0, hex: 'ffd8ff' },     // JFIF/EXIF SOI
  jpeg: { offset: 0, hex: 'ffd8ff' },
  gif:  { offset: 0, hex: '474946' },     // GIF
  webp: { offset: 8, hex: '57454250' },   // RIFF????WEBP (bytes 8-11)
}

/**
 * Text-based extensions that must not contain null bytes (0x00).
 */
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'js', 'py', 'html', 'css', 'csv', 'log',
])

/**
 * Validates file content before encryption.
 * - Binary types: first bytes must match the known magic-byte signature.
 * - Text types: file must not contain null bytes (0x00).
 *
 * @throws {Error} if the file content does not match its declared type.
 */
export function validateFileContent(filename: string, buffer: ArrayBuffer): void {
  const bytes = new Uint8Array(buffer)
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''

  if (MAGIC_BYTES[ext] !== undefined) {
    const { offset, hex: expectedHex } = MAGIC_BYTES[ext]
    const slice = bytes.slice(offset, offset + expectedHex.length / 2)
    const actualHex = Array.from(slice, b => b.toString(16).padStart(2, '0')).join('')
    if (!actualHex.startsWith(expectedHex)) {
      throw new Error(
        `Invalid file: content does not match the .${ext} format. ` +
        `Expected magic bytes ${expectedHex}, got ${actualHex.slice(0, expectedHex.length)}.`
      )
    }
  } else if (TEXT_EXTENSIONS.has(ext)) {
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0x00) {
        throw new Error(
          `Invalid file: .${ext} files must not contain binary (null) bytes. ` +
          `Found null byte at offset ${i}.`
        )
      }
    }
  }
}

// ── Security #2: MIME type resolution ────────────────────────────────────────
// Preserves the MIME type through the encrypt→upload→download→decrypt cycle.
// Three-step fallback: server MIME → extension map → octet-stream.
// Never defaults to application/pdf unless the file actually is one.

const EXTENSION_TO_MIME: Record<string, string> = {
  '.pdf':  'application/pdf',
  '.ppt':  'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.txt':  'text/plain',
  '.md':   'text/markdown',
  '.json': 'application/json',
  '.js':   'text/javascript',
  '.py':   'text/x-python',
  '.html': 'text/html',
  '.css':  'text/css',
  '.csv':  'text/csv',
  '.log':  'text/plain',
}

const GENERIC_MIME = 'application/octet-stream'

/**
 * Resolves the MIME type for a decrypted file using a three-step fallback:
 *   1. Use the server-supplied MIME type (stored at upload time, from X-Mime-Type header).
 *   2. Derive from file extension.
 *   3. Fall back to application/octet-stream.
 */
export function resolveMimeType(serverMimeType: string | null | undefined, filename = ''): string {
  const server = serverMimeType?.trim()
  if (server && server !== GENERIC_MIME) return server
  const dotIndex = filename.lastIndexOf('.')
  if (dotIndex !== -1) {
    const mapped = EXTENSION_TO_MIME[filename.slice(dotIndex).toLowerCase()]
    if (mapped) return mapped
  }
  return GENERIC_MIME
}

// ── Key generation / import / export ─────────────────────────────────────────

export async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  )
}

export async function exportKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key)
  return bufferToBase64url(raw)
}

export async function importKey(keyBase64: string): Promise<CryptoKey> {
  const raw = base64urlToBuffer(keyBase64)
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['decrypt']
  )
}

// ── Key Derivation & Wrapping (Secure Key Wrapping Architecture) ──────────────

/**
 * Derives a 256-bit AES-GCM Key Encryption Key (KEK) from a passphrase/password
 * using PBKDF2-HMAC-SHA-256 with a strong iteration count (default: 600,000).
 *
 * @param password   User share passphrase/password
 * @param salt       Cryptographically secure random salt (at least 16 bytes)
 * @param iterations Number of PBKDF2 iterations (default: 600,000)
 */
export async function deriveKEK(
  password: string,
  salt: Uint8Array,
  iterations = DEFAULT_KDF_ITERATIONS
): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as ArrayBuffer,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']
  )
}

/**
 * Wraps (encrypts) the File Encryption Key (FEK) using the Key Encryption Key (KEK).
 * Uses authenticated encryption (AES-256-GCM) with a fresh 12-byte random nonce.
 *
 * @param fek FEK CryptoKey or base64url string
 * @param kek KEK CryptoKey derived from the share passphrase
 * @returns Base64url wrapped FEK ciphertext and hex wrapping IV
 */
export async function wrapFEK(
  fek: CryptoKey | string,
  kek: CryptoKey
): Promise<{ wrappedFekBase64: string; wrappingIvHex: string }> {
  const fekKey = typeof fek === 'string'
    ? await crypto.subtle.importKey('raw', base64urlToBuffer(fek), { name: ALGORITHM, length: KEY_LENGTH }, true, ['encrypt', 'decrypt'])
    : fek

  const wrappingIv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const wrappedBuffer = await crypto.subtle.wrapKey(
    'raw',
    fekKey,
    kek,
    { name: ALGORITHM, iv: wrappingIv as unknown as ArrayBuffer }
  )

  return {
    wrappedFekBase64: bufferToBase64url(wrappedBuffer),
    wrappingIvHex: bytesToHex(wrappingIv),
  }
}

/**
 * Unwraps (decrypts) the wrapped FEK using the KEK.
 * If the passphrase is incorrect or ciphertext/tag is tampered with,
 * authenticated decryption fails and this function throws an error.
 *
 * @param wrappedFekBase64 Base64url wrapped FEK
 * @param kek              KEK CryptoKey derived from recipient's passphrase
 * @param wrappingIvHex    12-byte wrapping IV in hex
 * @returns Unwrapped FEK CryptoKey ready for file decryption
 */
export async function unwrapFEK(
  wrappedFekBase64: string,
  kek: CryptoKey,
  wrappingIvHex: string
): Promise<CryptoKey> {
  const wrappedBuffer = base64urlToBuffer(wrappedFekBase64)
  const wrappingIv = hexToBytes(wrappingIvHex)

  return crypto.subtle.unwrapKey(
    'raw',
    wrappedBuffer,
    kek,
    { name: ALGORITHM, iv: wrappingIv as unknown as ArrayBuffer },
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['decrypt']
  )
}

// ── Encrypt ───────────────────────────────────────────────────────────────────

/**
 * Encrypts a file ArrayBuffer with AES-256-GCM.
 * Runs validateFileContent BEFORE generating the key — bad input is rejected
 * before any cryptographic work is done.
 *
 * @param data     Raw file bytes (ArrayBuffer)
 * @param filename Original filename — used for magic-byte / null-byte validation.
 */
export async function encryptFile(data: ArrayBuffer, filename = ''): Promise<EncryptedPayload> {
  // Security #1: validate content matches declared file type before key gen
  validateFileContent(filename, data)

  const key = await generateKey()
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: iv as unknown as ArrayBuffer },
    key,
    data
  )

  const keyBase64 = await exportKey(key)
  return { ciphertext, iv, key, keyBase64 }
}

// ── Decrypt ───────────────────────────────────────────────────────────────────

/**
 * Decrypts an AES-256-GCM ciphertext using an unwrapped CryptoKey directly.
 * The plaintext key is never converted to a string or exposed.
 *
 * @param ciphertext     Raw ciphertext ArrayBuffer (no prepended IV)
 * @param iv             12-byte IV (from X-IV-Hex response header)
 * @param key            Unwrapped FEK CryptoKey
 * @param serverMimeType MIME type from X-Mime-Type header (may be null/empty)
 * @param filename       Original filename for extension-based MIME fallback
 */
export async function decryptFileWithKey(
  ciphertext: ArrayBuffer,
  iv: Uint8Array,
  key: CryptoKey,
  serverMimeType?: string | null,
  filename = ''
): Promise<Blob> {
  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: iv as unknown as ArrayBuffer },
    key,
    ciphertext
  )
  return new Blob([plaintext], { type: resolveMimeType(serverMimeType, filename) })
}

/**
 * Decrypts an AES-256-GCM ciphertext from a base64url string key.
 * Kept for isolated legacy support.
 *
 * @param ciphertext     Raw ciphertext ArrayBuffer (no prepended IV)
 * @param iv             12-byte IV (from X-IV-Hex response header)
 * @param keyBase64      base64url encryption key
 * @param serverMimeType MIME type from X-Mime-Type header (may be null/empty)
 * @param filename       Original filename for extension-based MIME fallback
 */
export async function decryptFile(
  ciphertext: ArrayBuffer,
  iv: Uint8Array,
  keyBase64: string,
  serverMimeType?: string | null,
  filename = ''
): Promise<Blob> {
  const key = await importKey(keyBase64)
  return decryptFileWithKey(ciphertext, iv, key, serverMimeType, filename)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  bytes.forEach(b => binary += String.fromCharCode(b))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  return bytes
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Generates a cryptographically secure random salt.
 */
export function generateSalt(byteLength = 16): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(byteLength))
}

export function generateSaltHex(byteLength = 16): string {
  return bytesToHex(generateSalt(byteLength))
}

/**
 * Generate a strong, memorable random passphrase for share protection.
 */
export function generateSecurePassphrase(): string {
  const words = [
    'amber', 'anchor', 'beacon', 'breeze', 'canyon', 'cedar', 'cliff', 'coral',
    'crest', 'crystal', 'delta', 'drift', 'falcon', 'flint', 'forest', 'fossil',
    'glacier', 'granite', 'harbor', 'haven', 'horizon', 'island', 'jaguar', 'lagoon',
    'meadow', 'meteor', 'nebula', 'oasis', 'orbit', 'peak', 'pinnacle', 'quartz',
    'ridge', 'river', 'shadow', 'sierra', 'silver', 'summit', 'timber', 'valiant',
    'valley', 'vortex', 'whisper', 'zenith'
  ]
  const randomIndices = new Uint32Array(4)
  crypto.getRandomValues(randomIndices)
  const chosenWords = Array.from(randomIndices).map(idx => words[idx % words.length])
  const randomNum = 100 + (crypto.getRandomValues(new Uint16Array(1))[0] % 900)
  return `${chosenWords.join('-')}-${randomNum}`
}

/**
 * Hash a share password with PBKDF2 (100k iterations, SHA-256) for backend auth.
 * Password is never sent or stored raw on the backend.
 */
export async function hashSharePassword(password: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const salt = hexToBytes(saltHex)
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as unknown as ArrayBuffer, iterations: 100_000 },
    keyMaterial,
    256
  )
  return bufferToBase64url(bits)
}

