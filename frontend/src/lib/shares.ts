/**
 * VaultKey — Shares API (FastAPI backend)
 */
import {
  apiCreateShare,
  apiListShares,
  apiRevokeShare,
  apiCheckAccess,
  apiAuthorizePassword,
  apiDownloadFile,
  apiViewFile,
  type ApiShareDetail,
  type ApiAccessCheck,
  type CreateSharePayload,
} from './api'
import {
  decryptFile,
  decryptFileWithKey,
  deriveKEK,
  unwrapFEK,
  hexToBytes,
  DEFAULT_KDF_ITERATIONS,
} from './crypto'

export type { ApiShareDetail as ShareRecord }

// ── Create share ──────────────────────────────────────────────────────────────

export interface CreateShareOptions {
  fileId: string
  expiresInHours?: number | null
  maxDownloads?: number
  accessMode?: 'download' | 'view_only'
  password?: string | null
  passwordHash?: string | null
  label?: string | null
  wrappedFek?: string | null
  kdfSalt?: string | null
  kdfIterations?: number | null
  kdfAlgorithm?: string | null
  wrappingIv?: string | null
}

export interface CreateShareResult {
  shareId: string
  token: string
  shareUrl: string  // /s/{token} — clean URL without secret fragments
}

export async function createShare(opts: CreateShareOptions): Promise<CreateShareResult> {
  const payload: CreateSharePayload = {
    file_id: opts.fileId,
    expiration_hours: opts.expiresInHours ?? null,
    max_downloads: opts.maxDownloads ?? 5,
    access_mode: opts.accessMode ?? 'download',
    password: opts.password ?? null,
    password_hash: opts.passwordHash ?? null,
    wrapped_fek: opts.wrappedFek ?? null,
    kdf_salt: opts.kdfSalt ?? null,
    kdf_iterations: opts.kdfIterations ?? null,
    kdf_algorithm: opts.kdfAlgorithm ?? null,
    wrapping_iv: opts.wrappingIv ?? null,
  }
  const res = await apiCreateShare(payload)
  return {
    shareId: res.share_id,
    token: res.token,
    shareUrl: `/s/${res.token}`,
  }
}

// ── List / revoke shares ──────────────────────────────────────────────────────

export async function listShares(fileId?: string): Promise<ApiShareDetail[]> {
  return apiListShares(fileId)
}

export async function revokeShare(shareId: string, _userId: string): Promise<void> {
  return apiRevokeShare(shareId)
}

// ── Public: check access ──────────────────────────────────────────────────────

export type { ApiAccessCheck as PublicShareInfo }

export async function getShareByToken(token: string): Promise<ApiAccessCheck | null> {
  try {
    return await apiCheckAccess(token)
  } catch {
    return null
  }
}

// ── Public: verify password ───────────────────────────────────────────────────

export async function authorizePassword(
  token: string,
  password?: string,
  passwordHash?: string
): Promise<void> {
  return apiAuthorizePassword(token, password, passwordHash)
}

// ── Unwrapping helper ────────────────────────────────────────────────────────

/**
 * Unwraps the FEK for a share using the recipient's passphrase and share metadata.
 */
export async function unwrapShareFEK(
  access: ApiAccessCheck,
  passphrase: string
): Promise<CryptoKey> {
  if (!access.wrapped_fek || !access.kdf_salt || !access.wrapping_iv) {
    throw new Error('This share is missing key wrapping metadata.')
  }
  const salt = hexToBytes(access.kdf_salt)
  const iterations = access.kdf_iterations ?? DEFAULT_KDF_ITERATIONS
  const kek = await deriveKEK(passphrase, salt, iterations)
  return unwrapFEK(access.wrapped_fek, kek, access.wrapping_iv)
}

// ── Public: download + decrypt ────────────────────────────────────────────────

/**
 * Downloads and decrypts a DOWNLOAD-mode share, then triggers a browser save.
 * Supports unwrapped CryptoKey directly or string key for legacy compatibility.
 */
export async function downloadAndDecrypt(
  token: string,
  keyOrFek: CryptoKey | string,
  password?: string,
  passwordHash?: string
): Promise<void> {
  const { blob, ivHex, originalFilename, mimeType } = await apiDownloadFile(token, password, passwordHash)

  const arrayBuffer = await blob.arrayBuffer()
  const ivBytes = new Uint8Array(ivHex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  
  const decrypted = typeof keyOrFek === 'string'
    ? await decryptFile(arrayBuffer, ivBytes, keyOrFek, mimeType, originalFilename)
    : await decryptFileWithKey(arrayBuffer, ivBytes, keyOrFek, mimeType, originalFilename)

  const url = URL.createObjectURL(decrypted)
  const a = document.createElement('a')
  a.href = url
  a.download = originalFilename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Public: view-only fetch + decrypt ─────────────────────────────────────────

/**
 * Fetches and decrypts a VIEW_ONLY share for in-browser rendering.
 * Returns a Blob (with correct MIME type) + metadata for ViewOnlyViewer.
 */
export async function viewAndDecrypt(
  token: string,
  keyOrFek: CryptoKey | string,
  password?: string,
  passwordHash?: string
): Promise<{ decryptedBlob: Blob; mimeType: string; fileName: string }> {
  const { blob, ivHex, originalFilename, mimeType } = await apiViewFile(token, password, passwordHash)

  const arrayBuffer = await blob.arrayBuffer()
  const ivBytes = new Uint8Array(ivHex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  const decryptedBlob = typeof keyOrFek === 'string'
    ? await decryptFile(arrayBuffer, ivBytes, keyOrFek, mimeType, originalFilename)
    : await decryptFileWithKey(arrayBuffer, ivBytes, keyOrFek, mimeType, originalFilename)

  return { decryptedBlob, mimeType: decryptedBlob.type, fileName: originalFilename }
}

export async function secureViewAndDecrypt(
  shareId: string,
  keyOrFek: CryptoKey | string,
  password?: string,
  passwordHash?: string
): Promise<{ decryptedBlob: Blob; mimeType: string; fileName: string }> {
  const access = await apiCheckAccess(shareId)
  if (!access.valid) throw new Error(`Share is ${access.status.toLowerCase()}.`)

  const response = access.access_mode === 'view_only'
    ? await apiViewFile(shareId, password, passwordHash)
    : await apiDownloadFile(shareId, password, passwordHash)

  const ivBytes = new Uint8Array(response.ivHex.match(/.{2}/g)?.map(byte => parseInt(byte, 16)) ?? [])
  if (ivBytes.length !== 12) throw new Error('Encrypted document metadata is invalid.')
  
  const decryptedBlob = typeof keyOrFek === 'string'
    ? await decryptFile(await response.blob.arrayBuffer(), ivBytes, keyOrFek, response.mimeType, response.originalFilename)
    : await decryptFileWithKey(await response.blob.arrayBuffer(), ivBytes, keyOrFek, response.mimeType, response.originalFilename)

  return { decryptedBlob, mimeType: decryptedBlob.type, fileName: response.originalFilename }
}

// ── Activity log stub ─────────────────────────────────────────────────────────

export async function logActivity(_args: unknown): Promise<void> {
  // Activity is logged server-side. No client-side logging needed.
}
