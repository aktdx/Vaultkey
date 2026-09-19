/**
 * VaultKey — Files API (FastAPI backend)
 *
 * Upload flow: encrypt in browser → POST raw ciphertext + ivHex to /api/files.
 * The IV is stored as a separate DB column (iv_hex); the R2 object contains
 * ONLY the raw ciphertext. Do NOT pack IV into the blob — the backend streams
 * the stored object verbatim and returns the IV via the X-IV-Hex header.
 */
import { encryptFile } from './crypto'
import { apiUploadEncryptedFile, apiListFiles, apiDeleteFile, type ApiFile } from './api'

export type { ApiFile as FileRecord }

export interface UploadResult {
  fileId: string
  encryptionKey: string   // base64url — embed in share URL fragment #key=
  ivHex: string
  storagePath: string     // r2_object_key (for reference only — equals fileId)
}

export async function uploadFile(
  file: File,
  _userId: string,
  onProgress?: (pct: number, stage: string) => void
): Promise<UploadResult> {
  onProgress?.(10, 'Reading file')
  const buffer = await file.arrayBuffer()

  onProgress?.(25, 'Encrypting')
  // Security #1: validateFileContent runs inside encryptFile before key gen
  const encrypted = await encryptFile(buffer, file.name)

  onProgress?.(55, 'Preparing upload')
  // Send raw ciphertext only — IV is sent separately as ivHex form field.
  // Do NOT pack IV into the blob; the backend stores what it receives and
  // streams it back verbatim. Packing would make decryption impossible.
  const encBlob = new Blob([encrypted.ciphertext], { type: 'application/octet-stream' })
  const ivHex = Array.from(encrypted.iv, b => b.toString(16).padStart(2, '0')).join('')

  onProgress?.(65, 'Uploading')
  const fileRecord = await apiUploadEncryptedFile(
    encBlob,
    file.name,
    ivHex,
    (xhrPct) => {
      onProgress?.(65 + Math.round(xhrPct * 0.30), 'Uploading')
    }
  )

  onProgress?.(100, 'Complete')

  return {
    fileId: fileRecord.id,
    encryptionKey: encrypted.keyBase64,
    ivHex,
    storagePath: fileRecord.id,
  }
}

export async function listFiles(): Promise<ApiFile[]> {
  return apiListFiles()
}

export async function deleteFile(fileId: string, _storagePath: string): Promise<void> {
  return apiDeleteFile(fileId)
}
