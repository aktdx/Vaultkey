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
  keyBase64: string // base64url-encoded raw key bytes
}

// ── Security #1: File-content validation before encryption ───────────────────
// Added: magic-byte validation for binary types, null-byte check for text types.
// Validation runs BEFORE key generation so bad input is rejected cheaply.

/**
 * Magic-byte signatures for binary file types.
 * Each entry: byte offset + expected hex prefix.
 */
const MAGIC_BYTES: Record<string, { offset: number; hex: string }> = {
  pdf:  { offset: 0, hex: '25504446' },   // %PDF
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
function validateFileContent(filename: string, buffer: ArrayBuffer): void {
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
  return { ciphertext, iv, keyBase64 }
}

// ── Decrypt ───────────────────────────────────────────────────────────────────

/**
 * Decrypts an AES-256-GCM ciphertext and returns a typed Blob.
 * Security #2: MIME type is resolved via resolveMimeType() so the correct
 * content-type is set on the blob — never defaults to application/pdf.
 *
 * @param ciphertext     Raw ciphertext ArrayBuffer (no prepended IV)
 * @param iv             12-byte IV (from X-IV-Hex response header)
 * @param keyBase64      base64url encryption key (from URL fragment #key=)
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
  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: iv as unknown as ArrayBuffer },
    key,
    ciphertext
  )
  return new Blob([plaintext], { type: resolveMimeType(serverMimeType, filename) })
}

// ── Helpers (internal) ────────────────────────────────────────────────────────

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  bytes.forEach(b => binary += String.fromCharCode(b))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  return bytes
}

/**
 * Hash a share password with PBKDF2 (100k iterations, SHA-256).
 * Password is never stored raw.
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

export function generateSaltHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

// ponytail: packEncryptedBlob/unpackEncryptedBlob removed — backend stores raw
// ciphertext with IV as a separate DB column (X-IV-Hex header). Packing IV into
// the blob would corrupt decryption since the backend streams the full stored
// object as ciphertext.
