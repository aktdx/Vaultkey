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
import { decryptFile } from './crypto'

export type { ApiShareDetail as ShareRecord }

// ── Create share ──────────────────────────────────────────────────────────────

export interface CreateShareOptions {
  fileId: string
  expiresInHours?: number | null
  maxDownloads?: number
  accessMode?: 'download' | 'view_only'
  password?: string | null
  label?: string | null
}

export interface CreateShareResult {
  shareId: string
  token: string
  shareUrl: string  // /s/{token} — caller appends #key= fragment
}

export async function createShare(opts: CreateShareOptions): Promise<CreateShareResult> {
  const payload: CreateSharePayload = {
    file_id: opts.fileId,
    expiration_hours: opts.expiresInHours ?? null,
    max_downloads: opts.maxDownloads ?? 5,
    access_mode: opts.accessMode ?? 'download',
    password: opts.password ?? null,
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

export async function authorizePassword(token: string, password: string): Promise<void> {
  return apiAuthorizePassword(token, password)
}

// ── Public: download + decrypt ────────────────────────────────────────────────

/**
 * Downloads and decrypts a DOWNLOAD-mode share, then triggers a browser save.
 * Security #2: mimeType and originalFilename are passed through to decryptFile
 * so resolveMimeType() sets the correct content-type on the saved Blob.
 */
export async function downloadAndDecrypt(
  token: string,
  encryptionKey: string,
  password?: string
): Promise<void> {
  const { blob, ivHex, originalFilename, mimeType } = await apiDownloadFile(token, password)

  const arrayBuffer = await blob.arrayBuffer()
  const ivBytes = new Uint8Array(ivHex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  // decryptFile returns a Blob with the correct MIME type resolved from
  // serverMimeType (X-Mime-Type header) → extension fallback → octet-stream
  const decrypted = await decryptFile(arrayBuffer, ivBytes, encryptionKey, mimeType, originalFilename)

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
 * Security #2: mimeType preservation via resolveMimeType inside decryptFile.
 */
export async function viewAndDecrypt(
  token: string,
  encryptionKey: string,
  password?: string
): Promise<{ decryptedBlob: Blob; mimeType: string; fileName: string }> {
  const { blob, ivHex, originalFilename, mimeType } = await apiViewFile(token, password)

  const arrayBuffer = await blob.arrayBuffer()
  const ivBytes = new Uint8Array(ivHex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  const decryptedBlob = await decryptFile(arrayBuffer, ivBytes, encryptionKey, mimeType, originalFilename)

  return { decryptedBlob, mimeType: decryptedBlob.type, fileName: originalFilename }
}

// ── Activity log stub ─────────────────────────────────────────────────────────

export async function logActivity(_args: unknown): Promise<void> {
  // Activity is logged server-side. No client-side logging needed.
}
